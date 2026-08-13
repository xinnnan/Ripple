-- Migration 048 — Replay-safe ticket comments and durable Slack replies
--
-- Migration 026 makes one comment command atomic, but HTTP response loss or a
-- retried Slack view submission can still execute that command twice. Slack
-- customer updates also post to the thread after the database commit, outside
-- the durable integration outbox.
--
-- Add a service-only request ledger and wrapper around migration 026's
-- command. Exact retries return the first comment, altered reuse fails closed,
-- and every customer-visible comment enqueues one Slack thread reply in the
-- same transaction as the comment, timeline, audit, and SLA evidence.

BEGIN;

ALTER TABLE public.integration_outbox
  DROP CONSTRAINT IF EXISTS integration_outbox_event_type;

ALTER TABLE public.integration_outbox
  ADD CONSTRAINT integration_outbox_event_type
  CHECK (
    event_type IN (
      'ticket.slack_master_create',
      'ticket.email_confirmation',
      'ticket.slack_master_sync',
      'ticket.slack_comment_reply',
      'ticket.slack_resolution_reply',
      'ticket.email_resolution'
    )
  );

CREATE TABLE public.ticket_comment_requests (
  source text NOT NULL
    CHECK (source IN ('slack', 'web', 'email')),
  idempotency_key text NOT NULL
    CHECK (
      pg_catalog.length(idempotency_key) BETWEEN 16 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    ),
  comment_id uuid NOT NULL UNIQUE
    REFERENCES public.ticket_comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (source, idempotency_key)
);

ALTER TABLE public.ticket_comment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_comment_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ticket_comment_requests
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_ticket_comment_idempotent_atomic(
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
    'visibility',
    'source',
    'is_automated',
    'idempotency_key'
  ];
  v_ticket_id uuid;
  v_actor_id uuid;
  v_body text;
  v_visibility text;
  v_source text;
  v_is_automated boolean;
  v_idempotency_key text;
  v_comment_id uuid;
  v_comment public.ticket_comments%ROWTYPE;
  v_actor_role text;
BEGIN
  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
  THEN
    RAISE EXCEPTION 'Comment input must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE NOT supplied.key = ANY (v_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'Comment input contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_ticket_id := (p_input ->> 'ticket_id')::uuid;
    v_actor_id := (p_input ->> 'actor_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Comment input contains an invalid identifier'
        USING ERRCODE = '22023';
  END;

  IF v_ticket_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Comment ticket and actor identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  v_body := pg_catalog.btrim(p_input ->> 'body');
  v_visibility := p_input ->> 'visibility';
  v_source := p_input ->> 'source';
  v_idempotency_key := pg_catalog.btrim(
    p_input ->> 'idempotency_key'
  );

  IF p_input -> 'is_automated' IS NULL
    OR pg_catalog.jsonb_typeof(p_input -> 'is_automated') <> 'boolean'
  THEN
    RAISE EXCEPTION 'Comment automation flag must be boolean'
      USING ERRCODE = '22023';
  END IF;
  v_is_automated := (p_input ->> 'is_automated')::boolean;

  IF v_body IS NULL
    OR pg_catalog.length(v_body) NOT BETWEEN 1 AND 10000
  THEN
    RAISE EXCEPTION 'Comment body must contain 1 to 10000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_visibility IS NULL
    OR v_visibility NOT IN ('customer', 'internal')
  THEN
    RAISE EXCEPTION 'Unsupported comment visibility'
      USING ERRCODE = '22023';
  END IF;

  IF v_source IS NULL OR v_source NOT IN ('slack', 'web', 'email') THEN
    RAISE EXCEPTION 'Unsupported comment source'
      USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
  THEN
    RAISE EXCEPTION 'A valid comment idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize one source/key without exposing a half-written reservation row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ticket-comment:' || v_source || ':' || v_idempotency_key,
      0
    )
  );

  SELECT request.comment_id
  INTO v_comment_id
  FROM public.ticket_comment_requests AS request
  WHERE request.source = v_source
    AND request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF FOUND THEN
    SELECT existing.*
    INTO v_comment
    FROM public.ticket_comments AS existing
    WHERE existing.id = v_comment_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Comment idempotency record is inconsistent'
        USING ERRCODE = '55000';
    END IF;

    IF v_comment.ticket_id IS DISTINCT FROM v_ticket_id
      OR v_comment.author_id IS DISTINCT FROM v_actor_id
      OR v_comment.body IS DISTINCT FROM v_body
      OR v_comment.visibility IS DISTINCT FROM v_visibility
      OR v_comment.source IS DISTINCT FROM v_source
      OR v_comment.is_automated IS DISTINCT FROM v_is_automated
    THEN
      RAISE EXCEPTION
        'Comment idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_comment_id := public.record_ticket_comment_with_sla(
      v_ticket_id,
      v_actor_id,
      v_body,
      v_visibility,
      v_source,
      v_is_automated
    );

    INSERT INTO public.ticket_comment_requests (
      source,
      idempotency_key,
      comment_id
    )
    VALUES (
      v_source,
      v_idempotency_key,
      v_comment_id
    );

    IF v_visibility = 'customer' THEN
      SELECT u.role
      INTO v_actor_role
      FROM public.users AS u
      WHERE u.id = v_actor_id;

      INSERT INTO public.integration_outbox (
        aggregate_type,
        aggregate_id,
        event_type,
        idempotency_key,
        payload
      )
      VALUES (
        'ticket',
        v_ticket_id,
        'ticket.slack_comment_reply',
        'ticket-comment:' || v_comment_id::text || ':slack-reply',
        pg_catalog.jsonb_build_object(
          'comment_id', v_comment_id,
          'message_text',
            CASE
              WHEN v_actor_role IN ('admin', 'engineer')
                THEN E'💬 Customer Update\n\n' || v_body
              ELSE E'💬 Customer Reply\n\n' || v_body
            END
        )
      );
    END IF;
  END IF;

  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ticket_comment_idempotent_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ticket_comment_idempotent_atomic(jsonb)
  TO service_role;

COMMENT ON TABLE public.ticket_comment_requests IS
  'Service-only replay ledger for atomic ticket comment request keys.';

COMMENT ON FUNCTION public.record_ticket_comment_idempotent_atomic(jsonb) IS
  'Serializes ticket comments by source/request key, returns the first comment
   for an exact replay, rejects altered reuse, and atomically enqueues one Slack
   reply for each customer-visible comment.';

COMMIT;
