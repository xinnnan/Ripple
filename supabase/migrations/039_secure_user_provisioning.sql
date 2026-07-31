-- Migration 039 — Secure and atomic user provisioning
--
-- The auth.users mirror trigger previously trusted raw_user_meta_data.role.
-- With public email signup enabled, a caller could request role=admin and the
-- trigger would create an active public administrator before email
-- confirmation. The admin/team creation routes also committed Auth creation,
-- profile/tenant changes, memberships, and audit as separate unchecked writes.
--
-- This migration makes the trigger fail closed for privileged role metadata
-- and adds two service-role-only finalization commands. The commands recheck
-- the actor, lock the new profile and tenant resources, require a fresh safe
-- customer profile, then commit authorization state, memberships, and audit
-- evidence together. The application compensates the Auth/profile identity if
-- finalization fails.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requested_role text;
  v_full_name text;
  v_status text;
BEGIN
  v_requested_role := NEW.raw_user_meta_data ->> 'role';

  -- raw_user_meta_data is caller-controlled on public signup. Legitimate
  -- server provisioning also starts as customer and is elevated only by one
  -- of the actor-checked commands below.
  IF v_requested_role IS NOT NULL
    AND v_requested_role <> 'customer'
  THEN
    RAISE EXCEPTION 'Role assignment requires server-side finalization'
      USING ERRCODE = '42501';
  END IF;

  v_full_name := pg_catalog.left(
    COALESCE(
      NULLIF(
        pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name'),
        ''
      ),
      NULLIF(pg_catalog.split_part(NEW.email, '@', 1), ''),
      'New user'
    ),
    200
  );

  -- Preserve current server-created customer behavior during rollout while
  -- ensuring an unconfirmed public signup has no active application account.
  v_status := CASE
    WHEN NEW.email_confirmed_at IS NULL THEN 'invited'
    ELSE 'active'
  END;

  INSERT INTO public.users (
    id,
    email,
    full_name,
    role,
    status
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    'customer',
    v_status
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_admin_user_creation(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_full_name text,
  p_role text,
  p_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_target public.users%ROWTYPE;
  v_full_name text;
  v_phone text;
BEGIN
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
    RAISE EXCEPTION 'Target user is required'
      USING ERRCODE = '22023';
  END IF;

  v_full_name := pg_catalog.btrim(p_full_name);
  v_phone := NULLIF(pg_catalog.btrim(p_phone), '');

  IF v_full_name IS NULL
    OR v_full_name = ''
    OR pg_catalog.char_length(v_full_name) > 200
  THEN
    RAISE EXCEPTION 'User name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_role NOT IN ('admin', 'engineer') THEN
    RAISE EXCEPTION 'Admin provisioning creates internal users only'
      USING ERRCODE = '22023';
  END IF;

  IF v_phone IS NOT NULL
    AND pg_catalog.char_length(v_phone) > 50
  THEN
    RAISE EXCEPTION 'Phone must fit 50 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT target.*
  INTO v_target
  FROM public.users AS target
  WHERE target.id = p_target_user_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisional user not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target.created_at < pg_catalog.clock_timestamp() - INTERVAL '30 minutes'
    OR v_target.role <> 'customer'
    OR v_target.status NOT IN ('active', 'invited')
    OR v_target.customer_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.site_members AS membership
      WHERE membership.user_id = p_target_user_id
    )
  THEN
    RAISE EXCEPTION 'Target is not a fresh provisional user'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.users AS target
  SET
    full_name = v_full_name,
    phone = v_phone,
    role = p_role,
    status = 'active'
  WHERE target.id = p_target_user_id;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    action,
    new_value,
    metadata
  )
  VALUES (
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'user',
    p_target_user_id,
    'created',
    v_target.email,
    pg_catalog.jsonb_build_object(
      'command', 'finalize_admin_user_creation',
      'role', p_role,
      'full_name', v_full_name
    )
  );

  RETURN p_target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_team_user_creation(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_full_name text,
  p_phone text DEFAULT NULL,
  p_site_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_actor_customer_id uuid;
  v_target public.users%ROWTYPE;
  v_full_name text;
  v_phone text;
  v_site_ids uuid[];
  v_valid_site_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618038001::bigint);

  SELECT actor.email, actor.role, actor.customer_id
  INTO v_actor_email, v_actor_role, v_actor_customer_id
  FROM public.users AS actor
  WHERE actor.id = p_actor_id
    AND actor.role = 'customer_manager'
    AND actor.status = 'active'
    AND actor.customer_id IS NOT NULL
  FOR SHARE OF actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active customer manager account required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.customers AS customer
  WHERE customer.id = v_actor_customer_id
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active customer organization required'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required'
      USING ERRCODE = '22023';
  END IF;

  v_full_name := pg_catalog.btrim(p_full_name);
  v_phone := NULLIF(pg_catalog.btrim(p_phone), '');

  IF v_full_name IS NULL
    OR v_full_name = ''
    OR pg_catalog.char_length(v_full_name) > 200
  THEN
    RAISE EXCEPTION 'User name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_phone IS NOT NULL
    AND pg_catalog.char_length(v_phone) > 50
  THEN
    RAISE EXCEPTION 'Phone must fit 50 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(requested.id ORDER BY requested.id),
    ARRAY[]::uuid[]
  )
  INTO v_site_ids
  FROM (
    SELECT DISTINCT supplied.id
    FROM pg_catalog.unnest(
      COALESCE(p_site_ids, ARRAY[]::uuid[])
    ) AS supplied(id)
  ) AS requested;

  IF pg_catalog.cardinality(v_site_ids) > 200 THEN
    RAISE EXCEPTION 'Site assignment is limited to 200 sites'
      USING ERRCODE = '22023';
  END IF;

  SELECT target.*
  INTO v_target
  FROM public.users AS target
  WHERE target.id = p_target_user_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisional user not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target.created_at < pg_catalog.clock_timestamp() - INTERVAL '30 minutes'
    OR v_target.role <> 'customer'
    OR v_target.status NOT IN ('active', 'invited')
    OR v_target.customer_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.site_members AS membership
      WHERE membership.user_id = p_target_user_id
    )
  THEN
    RAISE EXCEPTION 'Target is not a fresh provisional user'
      USING ERRCODE = '55000';
  END IF;

  -- Lock every supplied site in stable order before checking the complete set.
  PERFORM site.id
  FROM public.sites AS site
  WHERE site.id = ANY(v_site_ids)
  ORDER BY site.id
  FOR SHARE OF site;

  SELECT pg_catalog.count(*)::integer
  INTO v_valid_site_count
  FROM public.sites AS site
  WHERE site.id = ANY(v_site_ids)
    AND site.customer_id = v_actor_customer_id
    AND site.status = 'active';

  IF v_valid_site_count <> pg_catalog.cardinality(v_site_ids) THEN
    RAISE EXCEPTION 'Every assigned site must be active and in the manager tenant'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.users AS target
  SET
    full_name = v_full_name,
    phone = v_phone,
    role = 'customer',
    status = 'active',
    customer_id = v_actor_customer_id
  WHERE target.id = p_target_user_id;

  INSERT INTO public.site_members (
    user_id,
    site_id,
    role
  )
  SELECT
    p_target_user_id,
    assigned.site_id,
    'member'
  FROM pg_catalog.unnest(v_site_ids) AS assigned(site_id);

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    action,
    new_value,
    metadata
  )
  VALUES (
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'user',
    p_target_user_id,
    'created',
    v_target.email,
    pg_catalog.jsonb_build_object(
      'command', 'finalize_team_user_creation',
      'role', 'customer',
      'full_name', v_full_name,
      'customer_id', v_actor_customer_id,
      'site_ids', pg_catalog.to_jsonb(v_site_ids)
    )
  );

  RETURN p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_admin_user_creation(
  uuid,
  uuid,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_team_user_creation(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_admin_user_creation(
  uuid,
  uuid,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_team_user_creation(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) TO service_role;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Mirrors auth users into a safe customer profile and rejects caller-controlled privileged role metadata.';
COMMENT ON FUNCTION public.finalize_admin_user_creation(
  uuid,
  uuid,
  text,
  text,
  text
) IS
  'Atomically finalizes a fresh Auth profile as an internal user with audit evidence.';
COMMENT ON FUNCTION public.finalize_team_user_creation(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) IS
  'Atomically finalizes a fresh customer user with tenant-contained site access and audit evidence.';

COMMIT;
