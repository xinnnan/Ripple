-- Migration 050 — Durable Slack provider-attempt checkpoints
--
-- A Slack post can succeed while the worker loses its response or crashes
-- before recording the local message receipt. Persist the provider-attempt
-- boundary under the active outbox lease before network I/O so the next worker
-- can reconcile Slack metadata around the exact attempt time before reposting.

BEGIN;

ALTER TABLE public.integration_outbox
  ADD COLUMN provider_attempted_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_integration_outbox_provider_attempt(
  p_event_id uuid,
  p_lock_token uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempted_at timestamptz := pg_catalog.clock_timestamp();
  v_recorded_at timestamptz;
BEGIN
  UPDATE public.integration_outbox AS event
  SET
    provider_attempted_at = v_attempted_at,
    updated_at = v_attempted_at
  WHERE event.id = p_event_id
    AND event.status = 'processing'
    AND event.lock_token = p_lock_token
  RETURNING event.provider_attempted_at INTO v_recorded_at;

  RETURN v_recorded_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_integration_outbox_provider_attempt(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_integration_outbox_provider_attempt(
  uuid,
  uuid
) TO service_role;

COMMENT ON COLUMN public.integration_outbox.provider_attempted_at IS
  'Server timestamp committed under the active lease immediately before the
   latest external provider write; retained for ambiguous-delivery recovery.';

COMMENT ON FUNCTION public.record_integration_outbox_provider_attempt(
  uuid,
  uuid
) IS
  'Records the exact provider-write boundary only for the worker that still
   owns the active outbox lease and returns NULL for a stale lease.';

COMMIT;
