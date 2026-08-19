-- Migration 054 — Atomic administrator-managed Slack identities
--
-- Migration 053 makes a non-null users.slack_user_id unique and requires an
-- active linked identity before signed thread replies or internal Slack
-- actions can be attributed. The product previously exposed no supported way
-- to establish or clear that mapping.
--
-- Add one service-only command that rechecks the administrator, serializes
-- mapping decisions, validates the provider identifier, locks the target, and
-- commits the profile change plus exact audit evidence in one transaction.

BEGIN;

-- Invalid legacy values cannot resolve to a Slack member and are therefore
-- not operational identities. Quarantine them to NULL with one audit row per
-- user instead of blocking the migration or silently inventing a mapping.
WITH invalid_before AS MATERIALIZED (
  SELECT
    app_user.id,
    app_user.email,
    app_user.slack_user_id AS old_value
  FROM public.users AS app_user
  WHERE app_user.slack_user_id IS NOT NULL
    AND (
      pg_catalog.char_length(
        pg_catalog.upper(pg_catalog.btrim(app_user.slack_user_id))
      ) NOT BETWEEN 9 AND 50
      OR pg_catalog.upper(pg_catalog.btrim(app_user.slack_user_id))
        !~ '^[UW][A-Z0-9]{8,49}$'
    )
), quarantined AS (
  UPDATE public.users AS target
  SET slack_user_id = NULL
  FROM invalid_before
  WHERE target.id = invalid_before.id
  RETURNING target.id
)
INSERT INTO public.audit_logs (
  actor_id,
  actor_email,
  actor_role,
  entity_type,
  entity_id,
  action,
  field_name,
  old_value,
  new_value,
  metadata
)
SELECT
  NULL,
  NULL,
  'system',
  'user',
  invalid_before.id,
  'updated',
  'slack_user_id',
  invalid_before.old_value,
  NULL,
  pg_catalog.jsonb_build_object(
    'command', 'migration_054_quarantine_invalid_slack_identity',
    'reason', 'invalid_provider_id_shape',
    'target_email', invalid_before.email
  )
FROM invalid_before
JOIN quarantined ON quarantined.id = invalid_before.id;

-- Valid provider identities may be safely trimmed and case-normalized, but
-- two rows that collapse to the same identity require operator resolution.
DO $$
BEGIN
  IF EXISTS (
    SELECT pg_catalog.upper(pg_catalog.btrim(app_user.slack_user_id))
    FROM public.users AS app_user
    WHERE app_user.slack_user_id IS NOT NULL
    GROUP BY pg_catalog.upper(pg_catalog.btrim(app_user.slack_user_id))
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing Slack user identities become ambiguous after normalization'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

WITH before AS MATERIALIZED (
  SELECT
    app_user.id,
    app_user.email,
    app_user.slack_user_id AS old_value,
    pg_catalog.upper(
      pg_catalog.btrim(app_user.slack_user_id)
    ) AS new_value
  FROM public.users AS app_user
  WHERE app_user.slack_user_id IS NOT NULL
    AND app_user.slack_user_id IS DISTINCT FROM
      pg_catalog.upper(pg_catalog.btrim(app_user.slack_user_id))
), updated AS (
  UPDATE public.users AS target
  SET slack_user_id = before.new_value
  FROM before
  WHERE target.id = before.id
  RETURNING target.id
)
INSERT INTO public.audit_logs (
  actor_id,
  actor_email,
  actor_role,
  entity_type,
  entity_id,
  action,
  field_name,
  old_value,
  new_value,
  metadata
)
SELECT
  NULL,
  NULL,
  'system',
  'user',
  before.id,
  'updated',
  'slack_user_id',
  before.old_value,
  before.new_value,
  pg_catalog.jsonb_build_object(
    'command', 'migration_054_normalize_slack_identity',
    'target_email', before.email
  )
FROM before
JOIN updated ON updated.id = before.id;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_slack_user_id_shape;
ALTER TABLE public.users
  ADD CONSTRAINT users_slack_user_id_shape
  CHECK (
    slack_user_id IS NULL
    OR (
      pg_catalog.char_length(slack_user_id) BETWEEN 9 AND 50
      AND slack_user_id ~ '^[UW][A-Z0-9]{8,49}$'
    )
  );

CREATE OR REPLACE FUNCTION public.apply_admin_user_slack_identity(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_slack_user_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_before public.users%ROWTYPE;
  v_slack_user_id text;
BEGIN
  -- Share the administrator mutation serialization boundary and add a
  -- provider-identity namespace lock. This gives every uniqueness decision a
  -- stable before-state even when two administrators map users concurrently.
  PERFORM pg_catalog.pg_advisory_xact_lock(71618038001::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(71618054001::bigint);

  SELECT actor.email, actor.role
  INTO v_actor_email, v_actor_role
  FROM public.users AS actor
  WHERE actor.id = p_actor_id
    AND actor.role = 'admin'
    AND actor.status = 'active'
  FOR SHARE OF actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active admin account required'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user id is required'
      USING ERRCODE = '22023';
  END IF;

  v_slack_user_id := CASE
    WHEN p_slack_user_id IS NULL THEN NULL
    ELSE NULLIF(pg_catalog.upper(pg_catalog.btrim(p_slack_user_id)), '')
  END;

  IF v_slack_user_id IS NOT NULL
    AND (
      pg_catalog.char_length(v_slack_user_id) NOT BETWEEN 9 AND 50
      OR v_slack_user_id !~ '^[UW][A-Z0-9]{8,49}$'
    )
  THEN
    RAISE EXCEPTION 'Slack user id must start with U or W and use letters and digits only'
      USING ERRCODE = '22023';
  END IF;

  SELECT target.*
  INTO v_before
  FROM public.users AS target
  WHERE target.id = p_target_user_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_before.status = 'inactive' THEN
    RAISE EXCEPTION 'Inactive users cannot change Slack identity'
      USING ERRCODE = '55000';
  END IF;

  IF v_slack_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users AS existing
      WHERE existing.slack_user_id = v_slack_user_id
        AND existing.id <> p_target_user_id
    )
  THEN
    RAISE EXCEPTION 'Slack user identity is already linked'
      USING ERRCODE = '23505';
  END IF;

  IF v_before.slack_user_id IS NOT DISTINCT FROM v_slack_user_id THEN
    RETURN p_target_user_id;
  END IF;

  UPDATE public.users AS target
  SET slack_user_id = v_slack_user_id
  WHERE target.id = p_target_user_id;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    action,
    field_name,
    old_value,
    new_value,
    metadata
  )
  VALUES (
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'user',
    p_target_user_id,
    'updated',
    'slack_user_id',
    v_before.slack_user_id,
    v_slack_user_id,
    pg_catalog.jsonb_build_object(
      'command', 'apply_admin_user_slack_identity',
      'target_email', v_before.email
    )
  );

  RETURN p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_admin_user_slack_identity(
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_admin_user_slack_identity(
  uuid,
  uuid,
  text
) TO service_role;

COMMENT ON FUNCTION public.apply_admin_user_slack_identity(
  uuid,
  uuid,
  text
) IS
  'Atomically sets or clears one unique Slack actor identity for a non-inactive Ripple user with exact administrator audit evidence.';

COMMIT;
