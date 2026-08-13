-- Migration 053 — Replay-safe Slack ticket-thread capture
--
-- Human replies in a ticket's Slack thread were acknowledged by the Events
-- API but discarded. Capture them through a service-only request ledger and
-- the existing row-locked SLA/comment command. Unlike modal-authored updates,
-- these messages have already reached Slack and must not enqueue an echo.
--
-- The admin UI also stored the selected channel only on sites while Slack
-- delivery resolves a slack_channels row. Keep that operational mapping in
-- sync transactionally and make the raw Slack channel identity unambiguous.

BEGIN;

CREATE TABLE public.slack_event_comment_requests (
  idempotency_key text PRIMARY KEY
    CHECK (
      pg_catalog.length(idempotency_key) BETWEEN 16 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    ),
  comment_id uuid NOT NULL UNIQUE
    REFERENCES public.ticket_comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.slack_event_comment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_event_comment_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.slack_event_comment_requests
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_slack_event_comment_atomic(
  p_input jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed_keys constant text[] := ARRAY[
    'ticket_id',
    'actor_id',
    'body',
    'idempotency_key'
  ];
  v_ticket_id uuid;
  v_actor_id uuid;
  v_body text;
  v_idempotency_key text;
  v_comment_id uuid;
  v_comment public.ticket_comments%ROWTYPE;
BEGIN
  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
  THEN
    RAISE EXCEPTION 'Slack event comment input must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE NOT supplied.key = ANY (v_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'Slack event comment input contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_ticket_id := (p_input ->> 'ticket_id')::uuid;
    v_actor_id := (p_input ->> 'actor_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Slack event comment contains an invalid identifier'
        USING ERRCODE = '22023';
  END;

  IF v_ticket_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Slack event ticket and actor identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  v_body := pg_catalog.btrim(p_input ->> 'body');
  v_idempotency_key := pg_catalog.btrim(
    p_input ->> 'idempotency_key'
  );

  IF v_body IS NULL
    OR pg_catalog.length(v_body) NOT BETWEEN 1 AND 10000
  THEN
    RAISE EXCEPTION 'Slack event comment must contain 1 to 10000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
  THEN
    RAISE EXCEPTION 'A valid Slack event idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'slack-event-comment:' || v_idempotency_key,
      0
    )
  );

  SELECT request.comment_id
  INTO v_comment_id
  FROM public.slack_event_comment_requests AS request
  WHERE request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF FOUND THEN
    SELECT existing.*
    INTO v_comment
    FROM public.ticket_comments AS existing
    WHERE existing.id = v_comment_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Slack event comment receipt is inconsistent'
        USING ERRCODE = '55000';
    END IF;

    IF v_comment.ticket_id IS DISTINCT FROM v_ticket_id
      OR v_comment.author_id IS DISTINCT FROM v_actor_id
      OR v_comment.body IS DISTINCT FROM v_body
      OR v_comment.visibility IS DISTINCT FROM 'customer'
      OR v_comment.source IS DISTINCT FROM 'slack'
      OR v_comment.is_automated IS DISTINCT FROM false
    THEN
      RAISE EXCEPTION
        'Slack event idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- The provider has already delivered this human message. Call the base
    -- atomic comment/SLA command directly and intentionally create no Slack
    -- outbox event, preventing a reply echo/event loop.
    v_comment_id := public.record_ticket_comment_with_sla(
      v_ticket_id,
      v_actor_id,
      v_body,
      'customer',
      'slack',
      false
    );

    INSERT INTO public.slack_event_comment_requests (
      idempotency_key,
      comment_id
    )
    VALUES (
      v_idempotency_key,
      v_comment_id
    );
  END IF;

  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_slack_event_comment_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_slack_event_comment_atomic(jsonb)
  TO service_role;

COMMENT ON TABLE public.slack_event_comment_requests IS
  'Service-only replay ledger for human ticket-thread messages already delivered by Slack.';

COMMENT ON FUNCTION public.record_slack_event_comment_atomic(jsonb) IS
  'Exactly-once Slack thread capture using the atomic comment/SLA command without enqueuing an echo reply.';

-- Refuse ambiguous cross-site mappings. Silently picking a tenant would turn
-- a configuration defect into a customer-data boundary defect.
DO $$
BEGIN
  IF EXISTS (
    SELECT site.slack_channel_id
    FROM public.sites AS site
    WHERE site.slack_channel_id IS NOT NULL
    GROUP BY site.slack_channel_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A Slack channel is linked to more than one site'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT app_user.slack_user_id
    FROM public.users AS app_user
    WHERE app_user.slack_user_id IS NOT NULL
    GROUP BY app_user.slack_user_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A Slack user identity is linked to more than one user'
      USING ERRCODE = '23505';
  END IF;

END;
$$;

-- Same-site duplicate mapping rows are equivalent. Repoint historical
-- receipts before removing duplicates so delivery evidence is preserved.
WITH ranked AS (
  SELECT
    channel.id,
    pg_catalog.first_value(channel.id) OVER (
      PARTITION BY channel.site_id, channel.channel_id
      ORDER BY channel.created_at, channel.id
    ) AS keeper_id,
    pg_catalog.row_number() OVER (
      PARTITION BY channel.site_id, channel.channel_id
      ORDER BY channel.created_at, channel.id
    ) AS row_number
  FROM public.slack_channels AS channel
), duplicates AS (
  SELECT id, keeper_id
  FROM ranked
  WHERE row_number > 1
)
UPDATE public.slack_messages AS message
SET slack_channel_id = duplicate.keeper_id
FROM duplicates AS duplicate
WHERE message.slack_channel_id = duplicate.id;

WITH ranked AS (
  SELECT
    channel.id,
    pg_catalog.row_number() OVER (
      PARTITION BY channel.site_id, channel.channel_id
      ORDER BY channel.created_at, channel.id
    ) AS row_number
  FROM public.slack_channels AS channel
)
DELETE FROM public.slack_channels AS channel
USING ranked
WHERE channel.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX slack_channels_site_channel_unique
  ON public.slack_channels (site_id, channel_id);
CREATE UNIQUE INDEX sites_slack_channel_id_unique
  ON public.sites (slack_channel_id)
  WHERE slack_channel_id IS NOT NULL;
CREATE UNIQUE INDEX users_slack_user_id_unique
  ON public.users (slack_user_id)
  WHERE slack_user_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_users_slack_user_id;

CREATE OR REPLACE FUNCTION public.sync_site_slack_channel_mapping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.slack_channel_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Keep old per-site mapping rows as historical delivery evidence. Current
  -- ownership is uniquely enforced on sites.slack_channel_id; ingress and
  -- delivery independently require that canonical selection before using a
  -- site/channel mapping row.
  INSERT INTO public.slack_channels (
    site_id,
    channel_id,
    channel_name,
    channel_type
  )
  VALUES (
    NEW.id,
    NEW.slack_channel_id,
    NEW.slack_channel_id,
    'site_support'
  )
  ON CONFLICT (site_id, channel_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_site_slack_channel_mapping
  ON public.sites;
CREATE TRIGGER sync_site_slack_channel_mapping
AFTER INSERT OR UPDATE OF slack_channel_id
ON public.sites
FOR EACH ROW
WHEN (NEW.slack_channel_id IS NOT NULL)
EXECUTE FUNCTION public.sync_site_slack_channel_mapping();

-- Backfill the derived operational map for every channel already selected in
-- the canonical sites table. Existing rows retain their known channel name.
INSERT INTO public.slack_channels (
  site_id,
  channel_id,
  channel_name,
  channel_type
)
SELECT
  site.id,
  site.slack_channel_id,
  site.slack_channel_id,
  'site_support'
FROM public.sites AS site
WHERE site.slack_channel_id IS NOT NULL
ON CONFLICT (site_id, channel_id) DO NOTHING;

REVOKE ALL ON FUNCTION public.sync_site_slack_channel_mapping()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_site_slack_channel_mapping() IS
  'Transactionally materializes the canonical sites.slack_channel_id selection for Slack delivery and ingress.';

COMMIT;
