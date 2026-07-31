-- Migration 036 — Atomic admin site commands
--
-- Site ownership is a tenant boundary. The previous PATCH route allowed an
-- established site to be reassigned to another customer, which also moved its
-- historical tickets and related resources while retaining old memberships.
-- Site create/update and audit writes also committed separately.
--
-- These opt-in service-role commands:
--   * re-check an active admin inside the transaction;
--   * require active/trial customers and valid lifecycle/configuration data;
--   * make customer ownership immutable after site creation;
--   * prevent normal edits from restoring archived/decommissioned sites;
--   * commit site state and audit evidence together.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_admin_site_atomic(
  p_actor_id uuid,
  p_input jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_customer_id uuid;
  v_customer_name text;
  v_site_name text;
  v_site_code text;
  v_timezone text;
  v_address text;
  v_slack_channel_id text;
  v_default_owner_id uuid;
  v_status text;
  v_project_status text;
  v_site_id uuid;
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

  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
    OR p_input = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Site input must be a non-empty object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE supplied.key NOT IN (
      'customer_id',
      'site_name',
      'site_code',
      'timezone',
      'address',
      'slack_channel_id',
      'default_owner_id',
      'status',
      'project_status'
    )
  ) THEN
    RAISE EXCEPTION 'Site input contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_input) AS supplied(key, value)
    WHERE pg_catalog.jsonb_typeof(supplied.value) NOT IN ('string', 'null')
  ) THEN
    RAISE EXCEPTION 'Site input fields must be strings or null'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_customer_id := (p_input ->> 'customer_id')::uuid;
    IF p_input ? 'default_owner_id'
      AND p_input ->> 'default_owner_id' IS NOT NULL
    THEN
      v_default_owner_id := (p_input ->> 'default_owner_id')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Customer and owner identifiers must be UUIDs'
        USING ERRCODE = '22023';
  END;

  v_site_name := pg_catalog.btrim(p_input ->> 'site_name');
  v_site_code := pg_catalog.upper(
    pg_catalog.btrim(p_input ->> 'site_code')
  );
  v_timezone := pg_catalog.btrim(
    pg_catalog.coalesce(p_input ->> 'timezone', 'America/New_York')
  );
  v_address := pg_catalog.nullif(
    pg_catalog.btrim(p_input ->> 'address'),
    ''
  );
  v_slack_channel_id := pg_catalog.nullif(
    pg_catalog.btrim(p_input ->> 'slack_channel_id'),
    ''
  );
  v_status := pg_catalog.coalesce(p_input ->> 'status', 'active');
  v_project_status := pg_catalog.coalesce(
    p_input ->> 'project_status',
    'pre_signoff'
  );

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_site_name IS NULL
    OR v_site_name = ''
    OR pg_catalog.char_length(v_site_name) > 200
  THEN
    RAISE EXCEPTION 'Site name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_site_code IS NULL
    OR v_site_code !~ '^[A-Z0-9][A-Z0-9-]{0,49}$'
  THEN
    RAISE EXCEPTION
      'Site code must use 1-50 uppercase letters, numbers, or hyphens'
      USING ERRCODE = '22023';
  END IF;

  IF v_timezone IS NULL
    OR pg_catalog.char_length(v_timezone) > 100
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names AS timezone_name
      WHERE timezone_name.name = v_timezone
    )
  THEN
    RAISE EXCEPTION 'Timezone is not recognized'
      USING ERRCODE = '22023';
  END IF;

  IF v_address IS NOT NULL
    AND pg_catalog.char_length(v_address) > 500
  THEN
    RAISE EXCEPTION 'Address must fit 500 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_slack_channel_id IS NOT NULL
    AND pg_catalog.char_length(v_slack_channel_id) > 50
  THEN
    RAISE EXCEPTION 'Slack channel id must fit 50 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('active', 'commissioning') THEN
    RAISE EXCEPTION
      'New sites must be active or commissioning'
      USING ERRCODE = '22023';
  END IF;

  IF v_project_status NOT IN (
    'pre_signoff',
    'in_warranty',
    'full_coverage',
    'essential_coverage',
    'out_of_service'
  ) THEN
    RAISE EXCEPTION 'Unsupported project status'
      USING ERRCODE = '22023';
  END IF;

  SELECT customer.name
  INTO v_customer_name
  FROM public.customers AS customer
  WHERE customer.id = v_customer_id
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active or trial customer is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_default_owner_id IS NOT NULL THEN
    PERFORM 1
    FROM public.users AS owner
    WHERE owner.id = v_default_owner_id
      AND owner.status = 'active'
      AND owner.role IN ('admin', 'engineer')
    FOR SHARE OF owner;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Default owner must be an active internal user'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.sites (
    customer_id,
    site_name,
    site_code,
    timezone,
    address,
    slack_channel_id,
    default_owner_id,
    status,
    project_status
  )
  VALUES (
    v_customer_id,
    v_site_name,
    v_site_code,
    v_timezone,
    v_address,
    v_slack_channel_id,
    v_default_owner_id,
    v_status,
    v_project_status
  )
  RETURNING id INTO v_site_id;

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
    'site',
    v_site_id,
    'created',
    v_site_code,
    pg_catalog.jsonb_build_object(
      'command', 'create_admin_site_atomic',
      'site_name', v_site_name,
      'customer_id', v_customer_id,
      'customer_name', v_customer_name,
      'status', v_status,
      'project_status', v_project_status
    )
  );

  RETURN v_site_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_site_patch(
  p_actor_id uuid,
  p_site_id uuid,
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
  v_before public.sites%ROWTYPE;
  v_after public.sites%ROWTYPE;
  v_site_name text;
  v_site_code text;
  v_timezone text;
  v_address text;
  v_slack_channel_id text;
  v_status text;
  v_project_status text;
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

  IF p_site_id IS NULL THEN
    RAISE EXCEPTION 'Site id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Site patch must be a non-empty object'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'customer_id' THEN
    RAISE EXCEPTION
      'Site customer ownership is immutable after creation'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN (
      'site_name',
      'site_code',
      'timezone',
      'address',
      'project_status',
      'status',
      'slack_channel_id'
    )
  ) THEN
    RAISE EXCEPTION 'Site patch contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_patch) AS supplied(key, value)
    WHERE pg_catalog.jsonb_typeof(supplied.value) NOT IN ('string', 'null')
  ) THEN
    RAISE EXCEPTION 'Site patch fields must be strings or null'
      USING ERRCODE = '22023';
  END IF;

  SELECT site.*
  INTO v_before
  FROM public.sites AS site
  WHERE site.id = p_site_id
  FOR UPDATE OF site;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_before.status NOT IN ('active', 'commissioning') THEN
    RAISE EXCEPTION
      'Archived sites require a dedicated restore workflow'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.customers AS customer
  WHERE customer.id = v_before.customer_id
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site customer is not active'
      USING ERRCODE = '55000';
  END IF;

  v_site_name := CASE
    WHEN p_patch ? 'site_name'
      THEN pg_catalog.btrim(p_patch ->> 'site_name')
    ELSE v_before.site_name
  END;
  v_site_code := CASE
    WHEN p_patch ? 'site_code'
      THEN pg_catalog.upper(pg_catalog.btrim(p_patch ->> 'site_code'))
    ELSE v_before.site_code
  END;
  v_timezone := CASE
    WHEN p_patch ? 'timezone'
      THEN pg_catalog.btrim(p_patch ->> 'timezone')
    ELSE v_before.timezone
  END;
  v_address := CASE
    WHEN p_patch ? 'address'
      THEN pg_catalog.nullif(pg_catalog.btrim(p_patch ->> 'address'), '')
    ELSE v_before.address
  END;
  v_slack_channel_id := CASE
    WHEN p_patch ? 'slack_channel_id'
      THEN pg_catalog.nullif(
        pg_catalog.btrim(p_patch ->> 'slack_channel_id'),
        ''
      )
    ELSE v_before.slack_channel_id
  END;
  v_status := CASE
    WHEN p_patch ? 'status' THEN p_patch ->> 'status'
    ELSE v_before.status
  END;
  v_project_status := CASE
    WHEN p_patch ? 'project_status' THEN p_patch ->> 'project_status'
    ELSE v_before.project_status
  END;

  IF v_site_name IS NULL
    OR v_site_name = ''
    OR pg_catalog.char_length(v_site_name) > 200
  THEN
    RAISE EXCEPTION 'Site name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'site_code'
    AND (
      v_site_code IS NULL
      OR v_site_code !~ '^[A-Z0-9][A-Z0-9-]{0,49}$'
    )
  THEN
    RAISE EXCEPTION
      'Site code must use 1-50 uppercase letters, numbers, or hyphens'
      USING ERRCODE = '22023';
  END IF;

  IF v_timezone IS NULL
    OR pg_catalog.char_length(v_timezone) > 100
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names AS timezone_name
      WHERE timezone_name.name = v_timezone
    )
  THEN
    RAISE EXCEPTION 'Timezone is not recognized'
      USING ERRCODE = '22023';
  END IF;

  IF v_address IS NOT NULL
    AND pg_catalog.char_length(v_address) > 500
  THEN
    RAISE EXCEPTION 'Address must fit 500 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_slack_channel_id IS NOT NULL
    AND pg_catalog.char_length(v_slack_channel_id) > 50
  THEN
    RAISE EXCEPTION 'Slack channel id must fit 50 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('active', 'commissioning') THEN
    RAISE EXCEPTION
      'Use the archive workflow to retire a site'
      USING ERRCODE = '22023';
  END IF;

  IF v_project_status NOT IN (
    'pre_signoff',
    'in_warranty',
    'full_coverage',
    'essential_coverage',
    'out_of_service'
  ) THEN
    RAISE EXCEPTION 'Unsupported project status'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.sites AS site
  SET
    site_name = v_site_name,
    site_code = v_site_code,
    timezone = v_timezone,
    address = v_address,
    project_status = v_project_status,
    status = v_status,
    slack_channel_id = v_slack_channel_id
  WHERE site.id = p_site_id
  RETURNING site.* INTO v_after;

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
    'site',
    p_site_id,
    'updated',
    changed.field_name,
    changed.old_value,
    changed.new_value,
    pg_catalog.jsonb_build_object(
      'command', 'apply_admin_site_patch',
      'customer_id', v_before.customer_id
    )
  FROM (
    VALUES
      ('site_name', v_before.site_name, v_after.site_name),
      ('site_code', v_before.site_code, v_after.site_code),
      ('timezone', v_before.timezone, v_after.timezone),
      ('address', v_before.address, v_after.address),
      (
        'project_status',
        v_before.project_status,
        v_after.project_status
      ),
      ('status', v_before.status, v_after.status),
      (
        'slack_channel_id',
        v_before.slack_channel_id,
        v_after.slack_channel_id
      )
  ) AS changed(field_name, old_value, new_value)
  WHERE changed.old_value IS DISTINCT FROM changed.new_value;

  RETURN p_site_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_site_atomic(
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_site_patch(
  uuid,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_admin_site_atomic(
  uuid,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_site_patch(
  uuid,
  uuid,
  jsonb
) TO service_role;

COMMENT ON FUNCTION public.create_admin_site_atomic(
  uuid,
  jsonb
) IS
  'Creates an active-tenant site and its audit evidence atomically.';
COMMENT ON FUNCTION public.apply_admin_site_patch(
  uuid,
  uuid,
  jsonb
) IS
  'Updates mutable site fields and audit evidence atomically without tenant reassignment.';

COMMIT;
