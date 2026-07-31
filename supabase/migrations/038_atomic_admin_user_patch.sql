-- Migration 038 — Atomic admin user profile and authorization patch
--
-- A user role and status are authorization state. The previous admin route
-- updated public.users before best-effort audit writes, logged role changes
-- twice, and allowed internal/customer role-family changes without reconciling
-- customer ownership or site memberships.
--
-- This opt-in service-role command serializes authorization edits, re-checks
-- the active admin inside the transaction, locks the target, keeps deactivation
-- and reactivation in dedicated lifecycle workflows, rejects cross-family role
-- transfers, validates external tenant containment, and commits one audit row
-- per changed field with the profile update.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_admin_user_patch(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_patch jsonb
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
  v_after public.users%ROWTYPE;
  v_new_full_name text;
  v_new_role text;
  v_new_status text;
  v_before_is_internal boolean;
  v_after_is_internal boolean;
BEGIN
  -- Serialize global role/status decisions before taking user row locks. This
  -- prevents two administrators from concurrently authorizing changes based
  -- on stale actor roles.
  PERFORM pg_catalog.pg_advisory_xact_lock(71618038001::bigint);

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

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'User patch must be a non-empty object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN ('full_name', 'role', 'status')
  ) THEN
    RAISE EXCEPTION 'User patch contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_patch) AS supplied(key, value)
    WHERE pg_catalog.jsonb_typeof(supplied.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'User patch fields must be strings'
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
    RAISE EXCEPTION 'Inactive users require a dedicated reactivation workflow'
      USING ERRCODE = '55000';
  END IF;

  v_new_full_name := CASE
    WHEN p_patch ? 'full_name'
      THEN pg_catalog.btrim(p_patch ->> 'full_name')
    ELSE v_before.full_name
  END;
  v_new_role := CASE
    WHEN p_patch ? 'role' THEN p_patch ->> 'role'
    ELSE v_before.role
  END;
  v_new_status := CASE
    WHEN p_patch ? 'status' THEN p_patch ->> 'status'
    ELSE v_before.status
  END;

  IF v_new_full_name IS NULL
    OR v_new_full_name = ''
    OR pg_catalog.char_length(v_new_full_name) > 200
  THEN
    RAISE EXCEPTION 'User name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_new_role NOT IN (
    'admin',
    'engineer',
    'customer_manager',
    'customer'
  ) THEN
    RAISE EXCEPTION 'Unsupported user role'
      USING ERRCODE = '22023';
  END IF;

  IF v_new_status = 'inactive' THEN
    RAISE EXCEPTION 'Use the deactivation workflow to make a user inactive'
      USING ERRCODE = '55000';
  END IF;

  IF v_new_status NOT IN ('active', 'invited', 'suspended') THEN
    RAISE EXCEPTION 'Unsupported user status'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id = p_actor_id
    AND (
      v_new_role <> 'admin'
      OR v_new_status <> 'active'
    )
  THEN
    RAISE EXCEPTION 'An administrator cannot demote or suspend their own account'
      USING ERRCODE = '22023';
  END IF;

  v_before_is_internal := v_before.role IN ('admin', 'engineer');
  v_after_is_internal := v_new_role IN ('admin', 'engineer');

  IF v_before_is_internal IS DISTINCT FROM v_after_is_internal THEN
    RAISE EXCEPTION
      'Internal and customer role transfers require a dedicated workflow'
      USING ERRCODE = '55000';
  END IF;

  IF NOT v_after_is_internal THEN
    IF v_new_role = 'customer_manager'
      AND v_before.customer_id IS NULL
    THEN
      RAISE EXCEPTION 'Customer managers require a customer organization'
        USING ERRCODE = '55000';
    END IF;

    IF v_before.customer_id IS NOT NULL
      AND v_new_status IN ('active', 'invited')
    THEN
      PERFORM 1
      FROM public.customers AS customer
      WHERE customer.id = v_before.customer_id
        AND customer.status IN ('active', 'trial')
      FOR SHARE OF customer;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Active external users require an active customer'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.site_members AS membership
      JOIN public.sites AS site ON site.id = membership.site_id
      WHERE membership.user_id = p_target_user_id
        AND (
          v_before.customer_id IS NULL
          OR site.customer_id IS DISTINCT FROM v_before.customer_id
        )
    ) THEN
      RAISE EXCEPTION 'User site access is not contained in one customer'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.users AS target
  SET
    full_name = v_new_full_name,
    role = v_new_role,
    status = v_new_status
  WHERE target.id = p_target_user_id
  RETURNING target.* INTO v_after;

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
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'user',
    p_target_user_id,
    CASE
      WHEN changed.field_name = 'role' THEN 'role_changed'
      WHEN changed.field_name = 'status' THEN 'status_changed'
      ELSE 'updated'
    END,
    changed.field_name,
    changed.old_value,
    changed.new_value,
    pg_catalog.jsonb_build_object(
      'command', 'apply_admin_user_patch',
      'target_email', v_before.email,
      'customer_id', v_before.customer_id
    )
  FROM (
    VALUES
      ('full_name', v_before.full_name, v_after.full_name),
      ('role', v_before.role, v_after.role),
      ('status', v_before.status, v_after.status)
  ) AS changed(field_name, old_value, new_value)
  WHERE changed.old_value IS DISTINCT FROM changed.new_value;

  RETURN p_target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_users(
  p_ids uuid[],
  p_actor_id uuid
)
RETURNS TABLE(users_changed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_missing_ids uuid[];
  v_actor_email text;
  v_actor_role text;
  v_users_changed integer := 0;
BEGIN
  -- Share the authorization serialization boundary with normal user patches.
  PERFORM pg_catalog.pg_advisory_xact_lock(71618038001::bigint);

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

  SELECT COALESCE(
    pg_catalog.array_agg(requested.id ORDER BY requested.id),
    ARRAY[]::uuid[]
  )
  INTO v_ids
  FROM (
    SELECT DISTINCT supplied.id
    FROM pg_catalog.unnest(p_ids) AS supplied(id)
  ) AS requested;

  IF pg_catalog.cardinality(v_ids) < 1
    OR pg_catalog.cardinality(v_ids) > 200
  THEN
    RAISE EXCEPTION 'Deactivation batch must contain 1 to 200 unique ids'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_id = ANY(v_ids) THEN
    RAISE EXCEPTION 'An administrator cannot deactivate their own account'
      USING ERRCODE = '22023';
  END IF;

  -- Stable locks coordinate deactivation with profile/role changes and ensure
  -- the following before-state remains valid through update and audit.
  PERFORM 1
  FROM public.users AS target
  WHERE target.id = ANY(v_ids)
  ORDER BY target.id
  FOR UPDATE OF target;

  SELECT pg_catalog.array_agg(
    requested.requested_id
    ORDER BY requested.requested_id
  )
  INTO v_missing_ids
  FROM pg_catalog.unnest(v_ids) AS requested(requested_id)
  LEFT JOIN public.users AS target
    ON target.id = requested.requested_id
  WHERE target.id IS NULL;

  IF v_missing_ids IS NOT NULL THEN
    RAISE EXCEPTION 'One or more users no longer exist'
      USING ERRCODE = 'P0002';
  END IF;

  WITH previous AS MATERIALIZED (
    SELECT target.id, target.status AS old_status
    FROM public.users AS target
    WHERE target.id = ANY(v_ids)
      AND target.status <> 'inactive'
  ),
  updated AS (
    UPDATE public.users AS target
    SET status = 'inactive'
    FROM previous
    WHERE target.id = previous.id
    RETURNING target.id, previous.old_status
  ),
  logged AS (
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
      p_actor_id,
      v_actor_email,
      v_actor_role,
      'user',
      updated.id,
      'deactivated',
      'status',
      updated.old_status,
      'inactive',
      pg_catalog.jsonb_build_object(
        'source', 'bulk-deactivate',
        'command', 'deactivate_users'
      )
    FROM updated
    RETURNING id
  )
  SELECT pg_catalog.count(*)::integer
  INTO v_users_changed
  FROM logged;

  RETURN QUERY SELECT v_users_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_admin_user_patch(
  uuid,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_users(
  uuid[],
  uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_admin_user_patch(
  uuid,
  uuid,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_users(
  uuid[],
  uuid
) TO service_role;

COMMENT ON FUNCTION public.apply_admin_user_patch(
  uuid,
  uuid,
  jsonb
) IS
  'Atomically applies same-role-family admin user edits with tenant and lifecycle guards plus audit evidence.';
COMMENT ON FUNCTION public.deactivate_users(
  uuid[],
  uuid
) IS
  'Atomically deactivates users under the serialized admin authorization boundary while preserving history and audit evidence.';

COMMIT;
