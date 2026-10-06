-- Migration 057 — Guarded spare part request workflow and admin approval
--
-- Migration 028 made request updates atomic but accepted any status change:
-- a request could jump from requested straight to shipped or delivered,
-- skipping approval, and cancelled or delivered requests could be revived.
-- Engineers now work part requests from the internal Operations pages, and
-- approval commits spend, so approval is reserved for administrators.
--
-- The guard is a BEFORE UPDATE trigger so every caller (the atomic command,
-- future commands, and direct service-role writes) is held to one truth
-- table. Migration 028 stamps approved_by with the acting user when a request
-- enters approved, which lets the trigger verify that actor is an active
-- administrator without trusting caller-supplied role data.
--
-- The guard is non-retroactive: existing rows keep their current status and
-- only new transitions are checked.

BEGIN;

CREATE OR REPLACE FUNCTION public.spare_part_request_transition_allowed(
  p_current_status text,
  p_next_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_current_status IS NOT DISTINCT FROM p_next_status
    OR CASE p_current_status
      WHEN 'requested' THEN p_next_status IN ('approved', 'cancelled')
      WHEN 'approved' THEN p_next_status IN ('shipped', 'cancelled')
      WHEN 'shipped' THEN p_next_status IN ('delivered')
      ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.spare_part_request_transition_allowed(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spare_part_request_transition_allowed(text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_spare_part_request_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT public.spare_part_request_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'Invalid spare part request status transition: % -> %',
      OLD.status,
      NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'approved' AND NOT EXISTS (
    SELECT 1
    FROM public.users AS approver
    WHERE approver.id = NEW.approved_by
      AND approver.status = 'active'
      AND approver.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Spare part request approval requires an administrator'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_spare_part_request_workflow()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_spare_part_request_workflow
  ON public.spare_part_requests;

CREATE TRIGGER enforce_spare_part_request_workflow
  BEFORE UPDATE OF status ON public.spare_part_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_spare_part_request_workflow();

COMMENT ON FUNCTION public.spare_part_request_transition_allowed(text, text) IS
  'Spare part request workflow truth table shared by the guard trigger.';

COMMENT ON FUNCTION public.enforce_spare_part_request_workflow() IS
  'Rejects out-of-order part request status changes and non-administrator
   approval for every writer.';

COMMIT;
