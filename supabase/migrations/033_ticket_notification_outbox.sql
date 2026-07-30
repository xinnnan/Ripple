-- Migration: 033_ticket_notification_outbox
-- Description: Persist ticket notification work in the same transaction as
--              ticket mutations, then expose lease-based worker commands.

BEGIN;

CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lock_token uuid,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  delivery_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_outbox_aggregate_type
    CHECK (aggregate_type IN ('ticket')),
  CONSTRAINT integration_outbox_event_type
    CHECK (
      event_type IN (
        'ticket.slack_master_sync',
        'ticket.slack_resolution_reply',
        'ticket.email_resolution'
      )
    ),
  CONSTRAINT integration_outbox_status
    CHECK (
      status IN ('pending', 'processing', 'delivered', 'dead_letter')
    ),
  CONSTRAINT integration_outbox_attempt_bounds
    CHECK (
      attempts >= 0
      AND max_attempts BETWEEN 1 AND 20
      AND attempts <= max_attempts
    )
);

CREATE INDEX IF NOT EXISTS idx_integration_outbox_dispatch
  ON public.integration_outbox (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_integration_outbox_stale_leases
  ON public.integration_outbox (locked_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_integration_outbox_aggregate
  ON public.integration_outbox (
    aggregate_type,
    aggregate_id,
    created_at DESC
  );

ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.slack_messages
  ADD COLUMN IF NOT EXISTS outbox_event_id uuid
  REFERENCES public.integration_outbox(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_messages_outbox_event
  ON public.slack_messages (outbox_event_id)
  WHERE outbox_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enqueue_ticket_notification_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transaction_key text;
  v_resolution_key text;
BEGIN
  IF NOT (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.severity IS DISTINCT FROM NEW.severity
    OR OLD.owner_id IS DISTINCT FROM NEW.owner_id
    OR OLD.customer_visible_summary
      IS DISTINCT FROM NEW.customer_visible_summary
    OR OLD.internal_summary IS DISTINCT FROM NEW.internal_summary
    OR OLD.root_cause_category IS DISTINCT FROM NEW.root_cause_category
    OR OLD.follow_up_needed IS DISTINCT FROM NEW.follow_up_needed
  ) THEN
    RETURN NEW;
  END IF;

  v_transaction_key :=
    'ticket:' || NEW.id::text ||
    ':mutation:' || pg_catalog.txid_current()::text;

  INSERT INTO public.integration_outbox (
    aggregate_type,
    aggregate_id,
    event_type,
    idempotency_key,
    payload
  )
  VALUES (
    'ticket',
    NEW.id,
    'ticket.slack_master_sync',
    v_transaction_key || ':slack-master',
    pg_catalog.jsonb_build_object(
      'previous_status', OLD.status,
      'current_status', NEW.status
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NEW.status = 'resolved'
    AND OLD.status IS DISTINCT FROM 'resolved'
  THEN
    v_resolution_key :=
      'ticket:' || NEW.id::text ||
      ':resolution:' || COALESCE(
        NEW.resolved_at,
        NEW.updated_at,
        pg_catalog.clock_timestamp()
      )::text;

    INSERT INTO public.integration_outbox (
      aggregate_type,
      aggregate_id,
      event_type,
      idempotency_key,
      payload
    )
    VALUES (
      'ticket',
      NEW.id,
      'ticket.slack_resolution_reply',
      v_resolution_key || ':slack-reply',
      pg_catalog.jsonb_build_object(
        'previous_status', OLD.status,
        'current_status', NEW.status
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    IF NEW.submitter_email IS NOT NULL
      AND pg_catalog.length(pg_catalog.btrim(NEW.submitter_email)) > 0
    THEN
      INSERT INTO public.integration_outbox (
        aggregate_type,
        aggregate_id,
        event_type,
        idempotency_key,
        payload
      )
      VALUES (
        'ticket',
        NEW.id,
        'ticket.email_resolution',
        v_resolution_key || ':email',
        pg_catalog.jsonb_build_object(
          'previous_status', OLD.status,
          'current_status', NEW.status
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_ticket_notification_outbox
  ON public.tickets;

CREATE TRIGGER enqueue_ticket_notification_outbox
AFTER UPDATE OF
  status,
  severity,
  owner_id,
  customer_visible_summary,
  internal_summary,
  root_cause_category,
  follow_up_needed
ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_ticket_notification_outbox();

CREATE OR REPLACE FUNCTION public.claim_integration_outbox(
  p_limit integer DEFAULT 20,
  p_aggregate_type text DEFAULT NULL,
  p_aggregate_id uuid DEFAULT NULL
)
RETURNS SETOF public.integration_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Outbox claim limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  IF p_aggregate_type IS NOT NULL
    AND p_aggregate_type <> 'ticket'
  THEN
    RAISE EXCEPTION 'Unsupported outbox aggregate type'
      USING ERRCODE = '22023';
  END IF;

  -- A worker can die after its final claim. Move that exhausted stale lease
  -- to the dead-letter state instead of leaving it permanently processing.
  UPDATE public.integration_outbox AS exhausted
  SET
    status = 'dead_letter',
    locked_at = NULL,
    lock_token = NULL,
    dead_lettered_at = pg_catalog.clock_timestamp(),
    last_error = COALESCE(
      exhausted.last_error,
      'Worker lease expired after the final delivery attempt'
    ),
    updated_at = pg_catalog.clock_timestamp()
  WHERE exhausted.status = 'processing'
    AND exhausted.attempts >= exhausted.max_attempts
    AND exhausted.locked_at
      < pg_catalog.clock_timestamp() - interval '5 minutes';

  RETURN QUERY
  WITH candidates AS (
    SELECT candidate.id
    FROM public.integration_outbox AS candidate
    WHERE (
      (
        candidate.status = 'pending'
        AND candidate.available_at <= pg_catalog.clock_timestamp()
      )
      OR (
        candidate.status = 'processing'
        AND candidate.locked_at
          < pg_catalog.clock_timestamp() - interval '5 minutes'
      )
    )
      AND candidate.attempts < candidate.max_attempts
      AND (
        p_aggregate_type IS NULL
        OR candidate.aggregate_type = p_aggregate_type
      )
      AND (
        p_aggregate_id IS NULL
        OR candidate.aggregate_id = p_aggregate_id
      )
    ORDER BY candidate.available_at, candidate.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.integration_outbox AS claimed
  SET
    status = 'processing',
    attempts = claimed.attempts + 1,
    locked_at = pg_catalog.clock_timestamp(),
    lock_token = pg_catalog.gen_random_uuid(),
    updated_at = pg_catalog.clock_timestamp()
  FROM candidates
  WHERE claimed.id = candidates.id
  RETURNING claimed.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_integration_outbox_delivered(
  p_event_id uuid,
  p_lock_token uuid,
  p_delivery_result jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated_count integer;
BEGIN
  UPDATE public.integration_outbox AS event
  SET
    status = 'delivered',
    delivered_at = pg_catalog.clock_timestamp(),
    locked_at = NULL,
    lock_token = NULL,
    last_error = NULL,
    delivery_result = COALESCE(p_delivery_result, '{}'::jsonb),
    updated_at = pg_catalog.clock_timestamp()
  WHERE event.id = p_event_id
    AND event.status = 'processing'
    AND event.lock_token = p_lock_token;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_integration_outbox_failed(
  p_event_id uuid,
  p_lock_token uuid,
  p_error text,
  p_retryable boolean DEFAULT true,
  p_delivery_result jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated_count integer;
BEGIN
  UPDATE public.integration_outbox AS event
  SET
    status = CASE
      WHEN NOT p_retryable OR event.attempts >= event.max_attempts
        THEN 'dead_letter'
      ELSE 'pending'
    END,
    available_at = CASE
      WHEN NOT p_retryable OR event.attempts >= event.max_attempts
        THEN event.available_at
      ELSE
        pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(
            secs => LEAST(
              3600,
              30 * pg_catalog.power(
                2::numeric,
                GREATEST(event.attempts - 1, 0)
              )::integer
            )
          )
    END,
    locked_at = NULL,
    lock_token = NULL,
    dead_lettered_at = CASE
      WHEN NOT p_retryable OR event.attempts >= event.max_attempts
        THEN pg_catalog.clock_timestamp()
      ELSE NULL
    END,
    last_error = pg_catalog.left(
      COALESCE(p_error, 'Unknown delivery failure'),
      2000
    ),
    delivery_result = COALESCE(p_delivery_result, '{}'::jsonb),
    updated_at = pg_catalog.clock_timestamp()
  WHERE event.id = p_event_id
    AND event.status = 'processing'
    AND event.lock_token = p_lock_token;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count = 1;
END;
$$;

REVOKE ALL ON TABLE public.integration_outbox
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_ticket_notification_outbox()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_integration_outbox(
  integer,
  text,
  uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_integration_outbox_delivered(
  uuid,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_integration_outbox_failed(
  uuid,
  uuid,
  text,
  boolean,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_integration_outbox(
  integer,
  text,
  uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_integration_outbox_delivered(
  uuid,
  uuid,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_integration_outbox_failed(
  uuid,
  uuid,
  text,
  boolean,
  jsonb
) TO service_role;

COMMENT ON TABLE public.integration_outbox IS
  'Durable external-delivery queue. Business transactions enqueue unique
   events; service-role workers claim leases, retry with exponential backoff,
   and retain exhausted events as dead letters.';

COMMENT ON FUNCTION public.claim_integration_outbox(
  integer,
  text,
  uuid
) IS
  'Claims ready outbox events with SKIP LOCKED and a five-minute lease.';

COMMENT ON FUNCTION public.mark_integration_outbox_failed(
  uuid,
  uuid,
  text,
  boolean,
  jsonb
) IS
  'Requeues a failed lease with exponential backoff or dead-letters it.';

COMMIT;
