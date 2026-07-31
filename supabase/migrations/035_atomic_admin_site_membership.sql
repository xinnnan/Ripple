-- Migration 035 — Atomic admin site-membership commands
--
-- Site memberships are authorization data. The previous admin route performed
-- membership and audit writes separately and did not require a customer user
-- to belong to the selected site's tenant. These service-role commands:
--   * re-check an active admin inside the transaction;
--   * row-lock the target user/membership;
--   * require an active site in an active/trial customer;
--   * prevent cross-tenant customer access;
--   * derive a legacy null users.customer_id from the first assigned site;
--   * commit the membership change and audit evidence together.

BEGIN;

CREATE OR REPLACE FUNCTION public.add_admin_site_membership_atomic(
  p_actor_id uuid,
  p_user_id uuid,
  p_site_id uuid,
  p_role text DEFAULT 'member'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_target_email text;
  v_target_role text;
  v_target_status text;
  v_target_customer_id uuid;
  v_site_customer_id uuid;
  v_membership_id uuid;
BEGIN
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

  IF p_user_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION 'User and site are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_role IS NULL
    OR p_role NOT IN ('owner', 'manager', 'member', 'viewer')
  THEN
    RAISE EXCEPTION 'Unsupported site membership role'
      USING ERRCODE = '22023';
  END IF;

  SELECT target.email, target.role, target.status, target.customer_id
  INTO
    v_target_email,
    v_target_role,
    v_target_status,
    v_target_customer_id
  FROM public.users AS target
  WHERE target.id = p_user_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_role <> 'customer'
    OR v_target_status NOT IN ('active', 'invited')
  THEN
    RAISE EXCEPTION
      'Site membership requires an active or invited customer user'
      USING ERRCODE = '22023';
  END IF;

  SELECT site.customer_id
  INTO v_site_customer_id
  FROM public.sites AS site
  JOIN public.customers AS customer
    ON customer.id = site.customer_id
  WHERE site.id = p_site_id
    AND site.status = 'active'
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF site, customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active site and customer are required'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the target's current access set and reject any attempt that would
  -- leave one customer identity spanning multiple customer organizations.
  PERFORM existing_membership.id
  FROM public.site_members AS existing_membership
  JOIN public.sites AS existing_site
    ON existing_site.id = existing_membership.site_id
  WHERE existing_membership.user_id = p_user_id
  ORDER BY existing_membership.site_id
  FOR SHARE OF existing_membership, existing_site;

  IF EXISTS (
    SELECT 1
    FROM public.site_members AS existing_membership
    JOIN public.sites AS existing_site
      ON existing_site.id = existing_membership.site_id
    WHERE existing_membership.user_id = p_user_id
      AND existing_site.customer_id IS DISTINCT FROM v_site_customer_id
  ) THEN
    RAISE EXCEPTION 'Existing site access belongs to another customer'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_customer_id IS NOT NULL
    AND v_target_customer_id IS DISTINCT FROM v_site_customer_id
  THEN
    RAISE EXCEPTION 'User and site must belong to the same customer'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_customer_id IS NULL THEN
    UPDATE public.users
    SET customer_id = v_site_customer_id
    WHERE id = p_user_id;

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
      p_user_id,
      'updated',
      'customer_id',
      NULL,
      v_site_customer_id::text,
      pg_catalog.jsonb_build_object(
        'source', 'admin-site-membership',
        'derived_from_site_id', p_site_id
      )
    );
  END IF;

  INSERT INTO public.site_members (
    user_id,
    site_id,
    role
  )
  VALUES (
    p_user_id,
    p_site_id,
    p_role
  )
  RETURNING id INTO v_membership_id;

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
    p_user_id,
    'joined',
    'site_membership',
    NULL,
    p_role,
    pg_catalog.jsonb_build_object(
      'source', 'admin-site-membership',
      'membership_id', v_membership_id,
      'user_id', p_user_id,
      'target_email', v_target_email,
      'site_id', p_site_id,
      'site_customer_id', v_site_customer_id
    )
  );

  RETURN v_membership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_admin_site_membership_atomic(
  p_actor_id uuid,
  p_membership_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_user_id uuid;
  v_site_id uuid;
  v_membership_role text;
BEGIN
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

  IF p_membership_id IS NULL THEN
    RAISE EXCEPTION 'Membership id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT membership.user_id, membership.site_id, membership.role
  INTO v_user_id, v_site_id, v_membership_role
  FROM public.site_members AS membership
  WHERE membership.id = p_membership_id
  FOR UPDATE OF membership;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found'
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.site_members
  WHERE id = p_membership_id;

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
    v_user_id,
    'left',
    'site_membership',
    v_membership_role,
    NULL,
    pg_catalog.jsonb_build_object(
      'source', 'admin-site-membership',
      'membership_id', p_membership_id,
      'user_id', v_user_id,
      'site_id', v_site_id
    )
  );

  RETURN p_membership_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_admin_site_membership_atomic(
  uuid,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_admin_site_membership_atomic(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_admin_site_membership_atomic(
  uuid,
  uuid,
  uuid,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_admin_site_membership_atomic(
  uuid,
  uuid
) TO service_role;

COMMENT ON FUNCTION public.add_admin_site_membership_atomic(
  uuid,
  uuid,
  uuid,
  text
) IS
  'Adds tenant-contained customer site access and audit evidence atomically.';
COMMENT ON FUNCTION public.remove_admin_site_membership_atomic(
  uuid,
  uuid
) IS
  'Removes site access and writes audit evidence atomically.';

COMMIT;
