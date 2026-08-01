-- Migration 040 — Atomic admin customer create/update commands
--
-- Customer creation and ordinary updates previously committed tenant state
-- before best-effort audit writes. PATCH also reported success for a missing
-- row and could expose database messages. Keep archive/deactivation in the
-- dedicated migration 025 command; this migration owns only active/trial
-- creation and editable-customer profile/status changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_admin_customer_atomic(
  p_actor_id uuid,
  p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_name text;
  v_domain text;
  v_status text;
  v_customer public.customers%ROWTYPE;
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
    OR NOT (p_input ? 'name')
    OR (p_input - ARRAY['name', 'domain', 'status']::text[]) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Customer create input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_input -> 'name') <> 'string' THEN
    RAISE EXCEPTION 'Customer name must be a string'
      USING ERRCODE = '22023';
  END IF;

  IF p_input ? 'domain'
    AND p_input -> 'domain' <> 'null'::jsonb
    AND pg_catalog.jsonb_typeof(p_input -> 'domain') <> 'string'
  THEN
    RAISE EXCEPTION 'Customer domain must be a string or null'
      USING ERRCODE = '22023';
  END IF;

  IF p_input ? 'status'
    AND pg_catalog.jsonb_typeof(p_input -> 'status') <> 'string'
  THEN
    RAISE EXCEPTION 'Customer status must be a string'
      USING ERRCODE = '22023';
  END IF;

  v_name := pg_catalog.btrim(p_input ->> 'name');
  v_domain := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_input ->> 'domain')),
    ''
  );
  v_status := COALESCE(
    NULLIF(pg_catalog.btrim(p_input ->> 'status'), ''),
    'active'
  );

  IF v_name IS NULL
    OR v_name = ''
    OR pg_catalog.char_length(v_name) > 200
  THEN
    RAISE EXCEPTION 'Customer name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_domain IS NOT NULL
    AND (
      pg_catalog.char_length(v_domain) > 253
      OR v_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
    )
  THEN
    RAISE EXCEPTION 'Customer domain must be a valid hostname'
      USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('active', 'trial') THEN
    RAISE EXCEPTION 'New customers must be active or trial'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customers (
    name,
    domain,
    status
  )
  VALUES (
    v_name,
    v_domain,
    v_status
  )
  RETURNING * INTO v_customer;

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
    'customer',
    v_customer.id,
    'created',
    v_customer.name,
    pg_catalog.jsonb_build_object(
      'command', 'create_admin_customer_atomic',
      'status', v_customer.status,
      'domain', v_customer.domain
    )
  );

  RETURN pg_catalog.to_jsonb(v_customer);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_customer_patch(
  p_actor_id uuid,
  p_customer_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_before public.customers%ROWTYPE;
  v_after public.customers%ROWTYPE;
  v_name text;
  v_domain text;
  v_status text;
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

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
    OR (p_patch - ARRAY['name', 'domain', 'status']::text[]) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Customer patch is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT customer.*
  INTO v_before
  FROM public.customers AS customer
  WHERE customer.id = p_customer_id
  FOR UPDATE OF customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_before.status = 'inactive' THEN
    RAISE EXCEPTION 'Archived customers are read-only'
      USING ERRCODE = '55000';
  END IF;

  v_name := v_before.name;
  v_domain := v_before.domain;
  v_status := v_before.status;

  IF p_patch ? 'name' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'name') <> 'string' THEN
      RAISE EXCEPTION 'Customer name must be a string'
        USING ERRCODE = '22023';
    END IF;
    v_name := pg_catalog.btrim(p_patch ->> 'name');
    IF v_name = '' OR pg_catalog.char_length(v_name) > 200 THEN
      RAISE EXCEPTION 'Customer name is required and must fit 200 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'domain' THEN
    IF p_patch -> 'domain' <> 'null'::jsonb
      AND pg_catalog.jsonb_typeof(p_patch -> 'domain') <> 'string'
    THEN
      RAISE EXCEPTION 'Customer domain must be a string or null'
        USING ERRCODE = '22023';
    END IF;
    v_domain := NULLIF(
      pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'domain')),
      ''
    );
    IF v_domain IS NOT NULL
      AND (
        pg_catalog.char_length(v_domain) > 253
        OR v_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
      )
    THEN
      RAISE EXCEPTION 'Customer domain must be a valid hostname'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'status' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'status') <> 'string' THEN
      RAISE EXCEPTION 'Customer status must be a string'
        USING ERRCODE = '22023';
    END IF;
    v_status := pg_catalog.btrim(p_patch ->> 'status');
    IF v_status = 'inactive' THEN
      RAISE EXCEPTION 'Use the archive workflow to make a customer inactive'
        USING ERRCODE = '55000';
    END IF;
    IF v_status NOT IN ('active', 'trial') THEN
      RAISE EXCEPTION 'Customer status must be active or trial'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.customers AS customer
  SET
    name = v_name,
    domain = v_domain,
    status = v_status
  WHERE customer.id = p_customer_id
  RETURNING customer.* INTO v_after;

  IF v_before.name IS DISTINCT FROM v_after.name THEN
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    ) VALUES (
      p_actor_id, v_actor_email, v_actor_role, 'customer', p_customer_id,
      'updated', 'name', v_before.name, v_after.name,
      pg_catalog.jsonb_build_object('command', 'apply_admin_customer_patch')
    );
  END IF;

  IF v_before.domain IS DISTINCT FROM v_after.domain THEN
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    ) VALUES (
      p_actor_id, v_actor_email, v_actor_role, 'customer', p_customer_id,
      'updated', 'domain', v_before.domain, v_after.domain,
      pg_catalog.jsonb_build_object('command', 'apply_admin_customer_patch')
    );
  END IF;

  IF v_before.status IS DISTINCT FROM v_after.status THEN
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    ) VALUES (
      p_actor_id, v_actor_email, v_actor_role, 'customer', p_customer_id,
      'updated', 'status', v_before.status, v_after.status,
      pg_catalog.jsonb_build_object('command', 'apply_admin_customer_patch')
    );
  END IF;

  RETURN pg_catalog.to_jsonb(v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_customer_atomic(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_customer_patch(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_admin_customer_atomic(uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_customer_patch(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.create_admin_customer_atomic(uuid, jsonb) IS
  'Creates an active/trial customer and its attributable audit evidence in one transaction.';
COMMENT ON FUNCTION public.apply_admin_customer_patch(uuid, uuid, jsonb) IS
  'Updates an editable customer and changed-field audit evidence atomically; archive remains a dedicated workflow.';

COMMIT;
