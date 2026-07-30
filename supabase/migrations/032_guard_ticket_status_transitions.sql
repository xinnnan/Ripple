-- Migration: 032_guard_ticket_status_transitions
-- Description: Enforce the current ticket state machine and entry invariants
--              below every application transport.
--
-- Compatibility note:
-- PRD v1.1 defines additional states (TRIAGE, WAITING_THIRD_PARTY,
-- PENDING_ONSITE_WORK, DUPLICATE, REJECTED, CANCELLED). Ripple's current
-- schema has eight states. This migration maps the PRD transition rules onto
-- those eight states without introducing a second, incompatible lifecycle.

BEGIN;

CREATE OR REPLACE FUNCTION public.ticket_status_transition_allowed(
  p_current_status text,
  p_next_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT
    p_current_status = p_next_status
    OR CASE p_current_status
      WHEN 'new' THEN
        p_next_status IN ('assigned')
      WHEN 'assigned' THEN
        p_next_status IN (
          'in_progress',
          'waiting_customer',
          'waiting_droplet',
          'resolved'
        )
      WHEN 'in_progress' THEN
        p_next_status IN (
          'assigned',
          'waiting_customer',
          'waiting_droplet',
          'resolved'
        )
      WHEN 'waiting_customer' THEN
        p_next_status IN ('assigned', 'in_progress', 'resolved')
      WHEN 'waiting_droplet' THEN
        p_next_status IN ('in_progress', 'resolved')
      WHEN 'resolved' THEN
        p_next_status IN ('closed', 'reopened')
      WHEN 'closed' THEN
        p_next_status IN ('reopened')
      WHEN 'reopened' THEN
        p_next_status IN ('assigned', 'in_progress')
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_ticket_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
    AND NOT public.ticket_status_transition_allowed(OLD.status, NEW.status)
  THEN
    RAISE EXCEPTION 'Invalid ticket status transition: % -> %',
      OLD.status,
      NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- With no queue entity in the compatibility schema, active ownership is
  -- required when entering or remaining in work-bearing states. Do not block
  -- unrelated updates to historical inconsistent rows, but reject a new
  -- transition into the state or removal of the existing owner.
  IF NEW.status IN ('assigned', 'in_progress')
    AND NEW.owner_id IS NULL
    AND (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.owner_id IS DISTINCT FROM NEW.owner_id
    )
  THEN
    RAISE EXCEPTION
      'Assigned and in-progress tickets require an owner'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'resolved'
    AND (
      NEW.customer_visible_summary IS NULL
      OR pg_catalog.length(
        pg_catalog.btrim(NEW.customer_visible_summary)
      ) = 0
    )
    AND (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.customer_visible_summary
        IS DISTINCT FROM NEW.customer_visible_summary
    )
  THEN
    RAISE EXCEPTION
      'Resolved tickets require a customer-visible summary'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_ticket_status_transition
  ON public.tickets;

CREATE TRIGGER enforce_ticket_status_transition
BEFORE UPDATE OF status, owner_id, customer_visible_summary
ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ticket_status_transition();

REVOKE ALL ON FUNCTION public.ticket_status_transition_allowed(
  text,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_ticket_status_transition()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ticket_status_transition_allowed(
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_ticket_status_transition()
  TO service_role;

COMMENT ON FUNCTION public.ticket_status_transition_allowed(text, text) IS
  'Immutable compatibility truth table for Ripple ticket status transitions.
   Migration 032 mirrors src/lib/tickets/status.ts.';

COMMENT ON FUNCTION public.enforce_ticket_status_transition() IS
  'Rejects invalid ticket status jumps, ownerless assigned/in-progress
   mutations, and resolution without a customer-visible summary.';

COMMIT;
