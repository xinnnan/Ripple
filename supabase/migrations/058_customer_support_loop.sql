-- Migration 058 — Customer support loop
--
-- Closes four gaps in the customer conversation:
--
-- 1. A customer reply on a Waiting-on-Customer ticket left it parked there,
--    so the DropletAI queue never saw the answer. Customer-authored
--    customer-visible comments now return the ticket to In Progress (when it
--    has an owner, which that state requires) in the same transaction.
-- 2. Customers could only comment on a resolved ticket; it stayed resolved.
--    reopen_ticket_as_customer_atomic records the reason and reopens a
--    resolved ticket, or a closed one within 30 days.
-- 3. Guests (no account) could not answer at all. record_guest_ticket_reply_
--    atomic authorizes with the ticket share token and records a
--    customer-visible comment with no author, optionally reopening.
-- 4. Engineers' customer-visible updates never reached web submitters.
--    Human internal customer-visible comments on non-Slack tickets now
--    enqueue one ticket.email_customer_update outbox event beside the
--    comment. Slack-sourced tickets already converse in the thread.
--
-- Both comment entry points (web/Slack modal and signed Slack thread
-- capture) get the same effects.
--
-- close_stale_resolved_tickets_atomic closes resolved tickets after seven
-- days without customer activity; the protected outbox cron calls it.
--
-- Status changes go through the existing transition guard (migration 032)
-- and the notification outbox trigger (migration 033), so Slack master cards
-- stay in sync. Every command is service-role only with an empty search
-- path, serializes its replay key, and writes timeline plus audit evidence
-- atomically. The prior comment command keeps its exact signature behind a
-- wrapper (the migration 056 pattern) so existing callers are unchanged.

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
      'ticket.email_resolution',
      'ticket.email_customer_update'
    )
  );

CREATE TABLE public.ticket_customer_reply_requests (
  idempotency_key text PRIMARY KEY
    CHECK (
      pg_catalog.length(idempotency_key) BETWEEN 16 AND 180
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    ),
  channel text NOT NULL CHECK (channel IN ('guest', 'account')),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  comment_id uuid NOT NULL UNIQUE
    REFERENCES public.ticket_comments(id) ON DELETE CASCADE,
  reopen boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((channel = 'guest') = (actor_id IS NULL) OR channel = 'account')
);

ALTER TABLE public.ticket_customer_reply_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_customer_reply_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticket_customer_reply_requests
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared status effect for customer replies. Internal only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.apply_customer_reply_status_effect(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_actor_role text,
  p_reopen boolean,
  p_source_command text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_next_status text;
  v_occurred_at timestamptz;
BEGIN
  SELECT *
  INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
  END IF;

  v_occurred_at := pg_catalog.clock_timestamp();

  IF p_reopen THEN
    IF NOT (
      v_ticket.status = 'resolved'
      OR (
        v_ticket.status = 'closed'
        AND v_ticket.closed_at >= v_occurred_at - interval '30 days'
      )
    ) THEN
      RAISE EXCEPTION 'Ticket can no longer be reopened'
        USING ERRCODE = '23514';
    END IF;
    v_next_status := 'reopened';
  ELSIF v_ticket.status = 'waiting_customer'
    AND v_ticket.owner_id IS NOT NULL
  THEN
    v_next_status := 'in_progress';
  ELSE
    RETURN NULL;
  END IF;

  UPDATE public.tickets AS t
  SET status = v_next_status
  WHERE t.id = v_ticket.id;

  INSERT INTO public.ticket_events (
    ticket_id, event_type, old_value, new_value, actor_id, created_at
  )
  VALUES (
    v_ticket.id, 'status_changed', v_ticket.status, v_next_status,
    p_actor_id, v_occurred_at
  );

  INSERT INTO public.audit_logs (
    actor_id, actor_email, actor_role, entity_type, entity_id, action,
    field_name, old_value, new_value, metadata, created_at
  )
  VALUES (
    p_actor_id, p_actor_email, p_actor_role, 'ticket', v_ticket.id,
    'status_changed', 'status', v_ticket.status, v_next_status,
    pg_catalog.jsonb_build_object(
      'source', 'web',
      'command', p_source_command,
      'reason', CASE WHEN p_reopen THEN 'customer_reopen' ELSE 'customer_reply' END
    ),
    v_occurred_at
  );

  RETURN v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_customer_reply_status_effect(
  uuid, uuid, text, text, boolean, text
) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared effects of a newly recorded customer-visible comment. Internal only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.apply_new_comment_effects_058(
  p_comment_id uuid,
  p_source_command text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_comment public.ticket_comments%ROWTYPE;
  v_actor_role text;
  v_actor_email text;
  v_ticket_source text;
  v_submitter_email text;
BEGIN
  SELECT c.*
  INTO v_comment
  FROM public.ticket_comments AS c
  WHERE c.id = p_comment_id;

  IF NOT FOUND OR v_comment.visibility <> 'customer' THEN
    RETURN;
  END IF;

  SELECT u.role, u.email
  INTO v_actor_role, v_actor_email
  FROM public.users AS u
  WHERE u.id = v_comment.author_id;

  IF v_actor_role IN ('customer', 'customer_manager') THEN
    PERFORM public.apply_customer_reply_status_effect(
      v_comment.ticket_id,
      v_comment.author_id,
      v_actor_email,
      v_actor_role,
      false,
      p_source_command
    );
  ELSIF v_actor_role IN ('admin', 'engineer') AND NOT v_comment.is_automated THEN
    SELECT t.source, t.submitter_email
    INTO v_ticket_source, v_submitter_email
    FROM public.tickets AS t
    WHERE t.id = v_comment.ticket_id;

    IF v_ticket_source <> 'slack'
      AND v_submitter_email IS NOT NULL
      AND pg_catalog.length(pg_catalog.btrim(v_submitter_email)) > 0
    THEN
      INSERT INTO public.integration_outbox (
        aggregate_type, aggregate_id, event_type, idempotency_key, payload
      )
      VALUES (
        'ticket',
        v_comment.ticket_id,
        'ticket.email_customer_update',
        'ticket-comment:' || v_comment.id::text || ':email-update',
        pg_catalog.jsonb_build_object(
          'comment_id', v_comment.id,
          'body', v_comment.body
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_new_comment_effects_058(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Comment command wrapper: customer replies return tickets to the queue and
-- engineer updates email the submitter.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.record_ticket_comment_idempotent_atomic(jsonb)
  RENAME TO record_ticket_comment_idempotent_atomic_legacy_058;

REVOKE ALL ON FUNCTION public.record_ticket_comment_idempotent_atomic_legacy_058(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_ticket_comment_idempotent_atomic(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text;
  v_key text;
  v_is_replay boolean := false;
  v_comment_id uuid;
BEGIN
  IF p_input IS NOT NULL AND pg_catalog.jsonb_typeof(p_input) = 'object' THEN
    v_source := p_input ->> 'source';
    v_key := pg_catalog.btrim(p_input ->> 'idempotency_key');
  END IF;

  IF v_source IS NOT NULL AND v_key IS NOT NULL THEN
    -- Same lock the legacy command takes, so the replay check below cannot
    -- race a concurrent first attempt.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('ticket-comment:' || v_source || ':' || v_key, 0)
    );
    v_is_replay := EXISTS (
      SELECT 1
      FROM public.ticket_comment_requests AS request
      WHERE request.source = v_source
        AND request.idempotency_key = v_key
    );
  END IF;

  v_comment_id :=
    public.record_ticket_comment_idempotent_atomic_legacy_058(p_input);

  IF NOT v_is_replay THEN
    PERFORM public.apply_new_comment_effects_058(
      v_comment_id,
      'record_ticket_comment_idempotent_atomic'
    );
  END IF;

  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ticket_comment_idempotent_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ticket_comment_idempotent_atomic(jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Signed Slack thread capture wrapper (migration 053): same effects.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.record_slack_event_comment_atomic(jsonb)
  RENAME TO record_slack_event_comment_atomic_legacy_058;

REVOKE ALL ON FUNCTION public.record_slack_event_comment_atomic_legacy_058(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_slack_event_comment_atomic(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_is_replay boolean := false;
  v_comment_id uuid;
BEGIN
  IF p_input IS NOT NULL AND pg_catalog.jsonb_typeof(p_input) = 'object' THEN
    v_key := pg_catalog.btrim(p_input ->> 'idempotency_key');
  END IF;

  IF v_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('slack-event-comment:' || v_key, 0)
    );
    v_is_replay := EXISTS (
      SELECT 1
      FROM public.slack_event_comment_requests AS request
      WHERE request.idempotency_key = v_key
    );
  END IF;

  v_comment_id := public.record_slack_event_comment_atomic_legacy_058(p_input);

  IF NOT v_is_replay THEN
    PERFORM public.apply_new_comment_effects_058(
      v_comment_id,
      'record_slack_event_comment_atomic'
    );
  END IF;

  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_slack_event_comment_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_slack_event_comment_atomic(jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Shared input validation for customer reply commands.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.validate_customer_reply_input_058(
  p_input jsonb,
  p_allowed_keys text[]
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_body text;
  v_key text;
BEGIN
  IF p_input IS NULL OR pg_catalog.jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'Reply input must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE NOT supplied.key = ANY (p_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'Reply input contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  v_body := pg_catalog.btrim(p_input ->> 'body');
  IF v_body IS NULL OR pg_catalog.length(v_body) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Reply body must contain 1 to 10000 characters'
      USING ERRCODE = '22023';
  END IF;

  v_key := pg_catalog.btrim(p_input ->> 'idempotency_key');
  IF v_key IS NULL
    OR pg_catalog.length(v_key) NOT BETWEEN 16 AND 180
    OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
  THEN
    RAISE EXCEPTION 'A valid reply idempotency key is required'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_customer_reply_input_058(jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Signed-in customer reopen.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.reopen_ticket_as_customer_atomic(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket_id uuid;
  v_actor_id uuid;
  v_body text;
  v_key text;
  v_existing public.ticket_customer_reply_requests%ROWTYPE;
  v_existing_body text;
  v_actor_role text;
  v_actor_email text;
  v_comment_id uuid;
BEGIN
  PERFORM public.validate_customer_reply_input_058(
    p_input,
    ARRAY['ticket_id', 'actor_id', 'body', 'idempotency_key']
  );

  BEGIN
    v_ticket_id := (p_input ->> 'ticket_id')::uuid;
    v_actor_id := (p_input ->> 'actor_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Reply input contains an invalid identifier'
        USING ERRCODE = '22023';
  END;
  IF v_ticket_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Ticket and actor identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  v_body := pg_catalog.btrim(p_input ->> 'body');
  v_key := pg_catalog.btrim(p_input ->> 'idempotency_key');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('customer-reply:' || v_key, 0)
  );

  SELECT *
  INTO v_existing
  FROM public.ticket_customer_reply_requests
  WHERE idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT c.body INTO v_existing_body
    FROM public.ticket_comments AS c
    WHERE c.id = v_existing.comment_id;

    IF v_existing.channel <> 'account'
      OR v_existing.ticket_id IS DISTINCT FROM v_ticket_id
      OR v_existing.actor_id IS DISTINCT FROM v_actor_id
      OR v_existing.reopen IS DISTINCT FROM true
      OR v_existing_body IS DISTINCT FROM v_body
    THEN
      RAISE EXCEPTION 'Reply idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.comment_id;
  END IF;

  SELECT u.role, u.email
  INTO v_actor_role, v_actor_email
  FROM public.users AS u
  WHERE u.id = v_actor_id
    AND u.status = 'active';

  IF NOT FOUND OR v_actor_role NOT IN ('customer', 'customer_manager') THEN
    RAISE EXCEPTION 'An active customer account is required to reopen'
      USING ERRCODE = '42501';
  END IF;

  -- The legacy command enforces tenant/site scope, active lifecycle, and
  -- enqueues the Slack thread reply. Its key is derived so it cannot collide
  -- with ordinary comment keys.
  v_comment_id := public.record_ticket_comment_idempotent_atomic_legacy_058(
    pg_catalog.jsonb_build_object(
      'ticket_id', v_ticket_id,
      'actor_id', v_actor_id,
      'body', v_body,
      'visibility', 'customer',
      'source', 'web',
      'is_automated', false,
      'idempotency_key', 'reopen:' || v_key
    )
  );

  PERFORM public.apply_customer_reply_status_effect(
    v_ticket_id,
    v_actor_id,
    v_actor_email,
    v_actor_role,
    true,
    'reopen_ticket_as_customer_atomic'
  );

  INSERT INTO public.ticket_customer_reply_requests (
    idempotency_key, channel, ticket_id, actor_id, comment_id, reopen
  )
  VALUES (v_key, 'account', v_ticket_id, v_actor_id, v_comment_id, true);

  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_ticket_as_customer_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_ticket_as_customer_atomic(jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Guest reply authorized by the share token.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_guest_ticket_reply_atomic(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket_no text;
  v_token text;
  v_body text;
  v_key text;
  v_reopen boolean;
  v_ticket public.tickets%ROWTYPE;
  v_existing public.ticket_customer_reply_requests%ROWTYPE;
  v_existing_body text;
  v_comment_id uuid;
  v_occurred_at timestamptz;
BEGIN
  PERFORM public.validate_customer_reply_input_058(
    p_input,
    ARRAY['ticket_no', 'secure_token', 'body', 'reopen', 'idempotency_key']
  );

  v_ticket_no := p_input ->> 'ticket_no';
  v_token := p_input ->> 'secure_token';
  IF v_ticket_no IS NULL OR v_ticket_no !~ '^RPL-[0-9]{1,12}$'
    OR v_token IS NULL OR v_token !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'A valid ticket link is required' USING ERRCODE = '22023';
  END IF;

  IF p_input -> 'reopen' IS NULL
    OR pg_catalog.jsonb_typeof(p_input -> 'reopen') <> 'boolean'
  THEN
    RAISE EXCEPTION 'Reply reopen flag must be boolean' USING ERRCODE = '22023';
  END IF;
  v_reopen := (p_input ->> 'reopen')::boolean;

  v_body := pg_catalog.btrim(p_input ->> 'body');
  v_key := pg_catalog.btrim(p_input ->> 'idempotency_key');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('customer-reply:' || v_key, 0)
  );

  SELECT t.*
  INTO v_ticket
  FROM public.tickets AS t
  JOIN public.sites AS s ON s.id = t.site_id
  JOIN public.customers AS c ON c.id = t.customer_id
  WHERE t.ticket_no = v_ticket_no
    AND t.secure_token = v_token
    AND s.customer_id = t.customer_id
    AND s.status = 'active'
    AND c.status IN ('active', 'trial')
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.ticket_customer_reply_requests
  WHERE idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT c.body INTO v_existing_body
    FROM public.ticket_comments AS c
    WHERE c.id = v_existing.comment_id;

    IF v_existing.channel <> 'guest'
      OR v_existing.ticket_id IS DISTINCT FROM v_ticket.id
      OR v_existing.reopen IS DISTINCT FROM v_reopen
      OR v_existing_body IS DISTINCT FROM v_body
    THEN
      RAISE EXCEPTION 'Reply idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.comment_id;
  END IF;

  v_occurred_at := pg_catalog.clock_timestamp();

  INSERT INTO public.ticket_comments (
    ticket_id, author_id, body, visibility, source, is_automated, created_at
  )
  VALUES (v_ticket.id, NULL, v_body, 'customer', 'web', false, v_occurred_at)
  RETURNING id INTO v_comment_id;

  INSERT INTO public.ticket_events (
    ticket_id, event_type, old_value, new_value, actor_id, created_at
  )
  VALUES (v_ticket.id, 'comment_added', NULL, 'customer', NULL, v_occurred_at);

  INSERT INTO public.audit_logs (
    actor_id, actor_email, actor_role, entity_type, entity_id, action,
    field_name, old_value, new_value, metadata, created_at
  )
  VALUES (
    NULL, v_ticket.submitter_email, 'guest', 'comment', v_comment_id,
    'created', 'ticket_id', NULL, v_ticket.id::text,
    pg_catalog.jsonb_build_object(
      'source', 'web',
      'visibility', 'customer',
      'is_automated', false,
      'channel', 'share_link'
    ),
    v_occurred_at
  );

  INSERT INTO public.integration_outbox (
    aggregate_type, aggregate_id, event_type, idempotency_key, payload
  )
  VALUES (
    'ticket',
    v_ticket.id,
    'ticket.slack_comment_reply',
    'ticket-comment:' || v_comment_id::text || ':slack-reply',
    pg_catalog.jsonb_build_object(
      'comment_id', v_comment_id,
      'message_text', E'💬 Customer Reply (ticket link)\n\n' || v_body
    )
  );

  PERFORM public.apply_customer_reply_status_effect(
    v_ticket.id,
    NULL,
    v_ticket.submitter_email,
    'guest',
    v_reopen,
    'record_guest_ticket_reply_atomic'
  );

  INSERT INTO public.ticket_customer_reply_requests (
    idempotency_key, channel, ticket_id, actor_id, comment_id, reopen
  )
  VALUES (v_key, 'guest', v_ticket.id, NULL, v_comment_id, v_reopen);

  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_guest_ticket_reply_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_guest_ticket_reply_atomic(jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Auto-close resolved tickets after seven quiet days.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.close_stale_resolved_tickets_atomic(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket record;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cutoff timestamptz := pg_catalog.clock_timestamp() - interval '7 days';
  v_closed integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Auto-close limit must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  FOR v_ticket IN
    SELECT t.id, t.status
    FROM public.tickets AS t
    JOIN public.sites AS s ON s.id = t.site_id
    JOIN public.customers AS c ON c.id = t.customer_id
    WHERE t.status = 'resolved'
      AND t.resolved_at < v_cutoff
      AND s.status = 'active'
      AND c.status IN ('active', 'trial')
      AND NOT EXISTS (
        SELECT 1
        FROM public.ticket_comments AS tc
        LEFT JOIN public.users AS author ON author.id = tc.author_id
        WHERE tc.ticket_id = t.id
          AND tc.visibility = 'customer'
          AND tc.created_at >= v_cutoff
          AND (tc.author_id IS NULL
            OR author.role IN ('customer', 'customer_manager'))
      )
    ORDER BY t.resolved_at
    LIMIT p_limit
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    UPDATE public.tickets AS t
    SET status = 'closed', closed_at = v_now
    WHERE t.id = v_ticket.id;

    INSERT INTO public.ticket_events (
      ticket_id, event_type, old_value, new_value, actor_id, created_at
    )
    VALUES (v_ticket.id, 'status_changed', 'resolved', 'closed', NULL, v_now);

    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id, action,
      field_name, old_value, new_value, metadata, created_at
    )
    VALUES (
      NULL, NULL, 'system', 'ticket', v_ticket.id, 'status_changed',
      'status', 'resolved', 'closed',
      pg_catalog.jsonb_build_object(
        'source', 'internal',
        'command', 'close_stale_resolved_tickets_atomic',
        'quiet_days', 7
      ),
      v_now
    );

    v_closed := v_closed + 1;
  END LOOP;

  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_resolved_tickets_atomic(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_stale_resolved_tickets_atomic(integer)
  TO service_role;

COMMENT ON TABLE public.ticket_customer_reply_requests IS
  'Service-only replay ledger for guest replies and customer reopen requests.';
COMMENT ON FUNCTION public.record_ticket_comment_idempotent_atomic(jsonb) IS
  'Migration 048 comment command plus customer auto-return and submitter
   update email (non-Slack tickets), applied once per new comment.';
COMMENT ON FUNCTION public.record_slack_event_comment_atomic(jsonb) IS
  'Migration 053 Slack thread capture plus the same customer auto-return and
   submitter update email as web comments.';
COMMENT ON FUNCTION public.reopen_ticket_as_customer_atomic(jsonb) IS
  'Signed-in customer reopen with a required customer-visible reason.';
COMMENT ON FUNCTION public.record_guest_ticket_reply_atomic(jsonb) IS
  'Share-token guest reply with optional reopen, replay-safe.';
COMMENT ON FUNCTION public.close_stale_resolved_tickets_atomic(integer) IS
  'Closes resolved tickets after seven days without customer activity.';

COMMIT;
