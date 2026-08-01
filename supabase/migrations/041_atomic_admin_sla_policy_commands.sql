-- Migration 041 — Atomic admin SLA policy commands
--
-- SLA policy creation and updates previously committed contractual timing
-- state before best-effort audit writes, while deletion emitted no audit at
-- all. Scope/default semantics were implied by UI copy rather than enforced:
-- a default could be customer-scoped and a non-default could have no tenant.
-- These commands make policy, validation, lifecycle, and audit one serialized
-- database action. Existing policy data was audited before rollout.

BEGIN;

ALTER TABLE public.sla_policies
  ADD CONSTRAINT sla_policies_scope_shape
  CHECK (
    (is_default = true AND customer_id IS NULL)
    OR (is_default = false AND customer_id IS NOT NULL)
  );

ALTER TABLE public.sla_policies
  ADD CONSTRAINT sla_policies_target_order
  CHECK (
    p1_response_minutes <= p1_resolution_minutes
    AND p2_response_minutes <= p2_resolution_minutes
    AND p3_response_minutes <= p3_resolution_minutes
    AND p4_response_minutes <= p4_resolution_minutes
  );

CREATE OR REPLACE FUNCTION public.create_admin_sla_policy_atomic(
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
  v_customer_id uuid;
  v_is_default boolean;
  v_p1_response integer;
  v_p1_resolution integer;
  v_p2_response integer;
  v_p2_resolution integer;
  v_p3_response integer;
  v_p3_resolution integer;
  v_p4_response integer;
  v_p4_resolution integer;
  v_field text;
  v_policy public.sla_policies%ROWTYPE;
  v_target_fields constant text[] := ARRAY[
    'p1_response_minutes', 'p1_resolution_minutes',
    'p2_response_minutes', 'p2_resolution_minutes',
    'p3_response_minutes', 'p3_resolution_minutes',
    'p4_response_minutes', 'p4_resolution_minutes'
  ];
  v_allowed_fields constant text[] := ARRAY[
    'name', 'customer_id', 'is_default',
    'p1_response_minutes', 'p1_resolution_minutes',
    'p2_response_minutes', 'p2_resolution_minutes',
    'p3_response_minutes', 'p3_resolution_minutes',
    'p4_response_minutes', 'p4_resolution_minutes'
  ];
BEGIN
  -- Serialize scope uniqueness and delete/reference checks across all SLA
  -- administration commands. The table is intentionally small.
  PERFORM pg_catalog.pg_advisory_xact_lock(71618041001::bigint);

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
    OR NOT (p_input ?& v_allowed_fields)
    OR (p_input - v_allowed_fields) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'SLA policy create input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_input -> 'name') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'is_default') <> 'boolean'
  THEN
    RAISE EXCEPTION 'SLA policy name or scope type is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_input -> 'customer_id' <> 'null'::jsonb
    AND pg_catalog.jsonb_typeof(p_input -> 'customer_id') <> 'string'
  THEN
    RAISE EXCEPTION 'SLA policy customer id must be a UUID or null'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_field IN ARRAY v_target_fields
  LOOP
    IF pg_catalog.jsonb_typeof(p_input -> v_field) <> 'number' THEN
      RAISE EXCEPTION 'SLA policy target % must be an integer', v_field
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_name := pg_catalog.btrim(p_input ->> 'name');
  v_is_default := (p_input ->> 'is_default')::boolean;

  IF p_input -> 'customer_id' = 'null'::jsonb THEN
    v_customer_id := NULL;
  ELSE
    BEGIN
      v_customer_id := (p_input ->> 'customer_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'SLA policy customer id must be a UUID'
          USING ERRCODE = '22023';
    END;
  END IF;

  v_p1_response := (p_input ->> 'p1_response_minutes')::integer;
  v_p1_resolution := (p_input ->> 'p1_resolution_minutes')::integer;
  v_p2_response := (p_input ->> 'p2_response_minutes')::integer;
  v_p2_resolution := (p_input ->> 'p2_resolution_minutes')::integer;
  v_p3_response := (p_input ->> 'p3_response_minutes')::integer;
  v_p3_resolution := (p_input ->> 'p3_resolution_minutes')::integer;
  v_p4_response := (p_input ->> 'p4_response_minutes')::integer;
  v_p4_resolution := (p_input ->> 'p4_resolution_minutes')::integer;

  IF v_name IS NULL
    OR v_name = ''
    OR pg_catalog.char_length(v_name) > 200
  THEN
    RAISE EXCEPTION 'SLA policy name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_is_default IS DISTINCT FROM (v_customer_id IS NULL) THEN
    RAISE EXCEPTION 'Default scope must have no customer; customer scope must not be default'
      USING ERRCODE = '22023';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    PERFORM 1
    FROM public.customers AS customer
    WHERE customer.id = v_customer_id
      AND customer.status IN ('active', 'trial')
    FOR SHARE OF customer;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active or trial SLA policy customer not found'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF v_p1_response NOT BETWEEN 0 AND 525600
    OR v_p1_resolution NOT BETWEEN 0 AND 525600
    OR v_p2_response NOT BETWEEN 0 AND 525600
    OR v_p2_resolution NOT BETWEEN 0 AND 525600
    OR v_p3_response NOT BETWEEN 0 AND 525600
    OR v_p3_resolution NOT BETWEEN 0 AND 525600
    OR v_p4_response NOT BETWEEN 0 AND 525600
    OR v_p4_resolution NOT BETWEEN 0 AND 525600
  THEN
    RAISE EXCEPTION 'SLA policy targets must be between 0 and 525600 minutes'
      USING ERRCODE = '22023';
  END IF;

  IF v_p1_response > v_p1_resolution
    OR v_p2_response > v_p2_resolution
    OR v_p3_response > v_p3_resolution
    OR v_p4_response > v_p4_resolution
  THEN
    RAISE EXCEPTION 'SLA response target cannot exceed its resolution target'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sla_policies (
    name,
    customer_id,
    is_default,
    p1_response_minutes,
    p1_resolution_minutes,
    p2_response_minutes,
    p2_resolution_minutes,
    p3_response_minutes,
    p3_resolution_minutes,
    p4_response_minutes,
    p4_resolution_minutes
  )
  VALUES (
    v_name,
    v_customer_id,
    v_is_default,
    v_p1_response,
    v_p1_resolution,
    v_p2_response,
    v_p2_resolution,
    v_p3_response,
    v_p3_resolution,
    v_p4_response,
    v_p4_resolution
  )
  RETURNING * INTO v_policy;

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
    'sla_policy',
    v_policy.id,
    'created',
    v_policy.name,
    pg_catalog.jsonb_build_object(
      'command', 'create_admin_sla_policy_atomic',
      'customer_id', v_policy.customer_id,
      'is_default', v_policy.is_default,
      'targets', pg_catalog.jsonb_build_object(
        'p1_response_minutes', v_policy.p1_response_minutes,
        'p1_resolution_minutes', v_policy.p1_resolution_minutes,
        'p2_response_minutes', v_policy.p2_response_minutes,
        'p2_resolution_minutes', v_policy.p2_resolution_minutes,
        'p3_response_minutes', v_policy.p3_response_minutes,
        'p3_resolution_minutes', v_policy.p3_resolution_minutes,
        'p4_response_minutes', v_policy.p4_response_minutes,
        'p4_resolution_minutes', v_policy.p4_resolution_minutes
      )
    )
  );

  RETURN pg_catalog.to_jsonb(v_policy);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_sla_policy_patch(
  p_actor_id uuid,
  p_policy_id uuid,
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
  v_before public.sla_policies%ROWTYPE;
  v_after public.sla_policies%ROWTYPE;
  v_before_json jsonb;
  v_after_json jsonb;
  v_name text;
  v_p1_response integer;
  v_p1_resolution integer;
  v_p2_response integer;
  v_p2_resolution integer;
  v_p3_response integer;
  v_p3_resolution integer;
  v_p4_response integer;
  v_p4_resolution integer;
  v_field text;
  v_target_fields constant text[] := ARRAY[
    'p1_response_minutes', 'p1_resolution_minutes',
    'p2_response_minutes', 'p2_resolution_minutes',
    'p3_response_minutes', 'p3_resolution_minutes',
    'p4_response_minutes', 'p4_resolution_minutes'
  ];
  v_allowed_fields constant text[] := ARRAY[
    'name',
    'p1_response_minutes', 'p1_resolution_minutes',
    'p2_response_minutes', 'p2_resolution_minutes',
    'p3_response_minutes', 'p3_resolution_minutes',
    'p4_response_minutes', 'p4_resolution_minutes'
  ];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618041001::bigint);

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

  IF p_policy_id IS NULL THEN
    RAISE EXCEPTION 'SLA policy id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
    OR (p_patch - v_allowed_fields) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'SLA policy patch is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT policy.*
  INTO v_before
  FROM public.sla_policies AS policy
  WHERE policy.id = p_policy_id
  FOR UPDATE OF policy;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLA policy not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_name := v_before.name;
  v_p1_response := v_before.p1_response_minutes;
  v_p1_resolution := v_before.p1_resolution_minutes;
  v_p2_response := v_before.p2_response_minutes;
  v_p2_resolution := v_before.p2_resolution_minutes;
  v_p3_response := v_before.p3_response_minutes;
  v_p3_resolution := v_before.p3_resolution_minutes;
  v_p4_response := v_before.p4_response_minutes;
  v_p4_resolution := v_before.p4_resolution_minutes;

  IF p_patch ? 'name' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'name') <> 'string' THEN
      RAISE EXCEPTION 'SLA policy name must be a string'
        USING ERRCODE = '22023';
    END IF;
    v_name := pg_catalog.btrim(p_patch ->> 'name');
  END IF;

  FOREACH v_field IN ARRAY v_target_fields
  LOOP
    IF p_patch ? v_field
      AND pg_catalog.jsonb_typeof(p_patch -> v_field) <> 'number'
    THEN
      RAISE EXCEPTION 'SLA policy target % must be an integer', v_field
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_patch ? 'p1_response_minutes' THEN
    v_p1_response := (p_patch ->> 'p1_response_minutes')::integer;
  END IF;
  IF p_patch ? 'p1_resolution_minutes' THEN
    v_p1_resolution := (p_patch ->> 'p1_resolution_minutes')::integer;
  END IF;
  IF p_patch ? 'p2_response_minutes' THEN
    v_p2_response := (p_patch ->> 'p2_response_minutes')::integer;
  END IF;
  IF p_patch ? 'p2_resolution_minutes' THEN
    v_p2_resolution := (p_patch ->> 'p2_resolution_minutes')::integer;
  END IF;
  IF p_patch ? 'p3_response_minutes' THEN
    v_p3_response := (p_patch ->> 'p3_response_minutes')::integer;
  END IF;
  IF p_patch ? 'p3_resolution_minutes' THEN
    v_p3_resolution := (p_patch ->> 'p3_resolution_minutes')::integer;
  END IF;
  IF p_patch ? 'p4_response_minutes' THEN
    v_p4_response := (p_patch ->> 'p4_response_minutes')::integer;
  END IF;
  IF p_patch ? 'p4_resolution_minutes' THEN
    v_p4_resolution := (p_patch ->> 'p4_resolution_minutes')::integer;
  END IF;

  IF v_name IS NULL
    OR v_name = ''
    OR pg_catalog.char_length(v_name) > 200
  THEN
    RAISE EXCEPTION 'SLA policy name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_p1_response NOT BETWEEN 0 AND 525600
    OR v_p1_resolution NOT BETWEEN 0 AND 525600
    OR v_p2_response NOT BETWEEN 0 AND 525600
    OR v_p2_resolution NOT BETWEEN 0 AND 525600
    OR v_p3_response NOT BETWEEN 0 AND 525600
    OR v_p3_resolution NOT BETWEEN 0 AND 525600
    OR v_p4_response NOT BETWEEN 0 AND 525600
    OR v_p4_resolution NOT BETWEEN 0 AND 525600
  THEN
    RAISE EXCEPTION 'SLA policy targets must be between 0 and 525600 minutes'
      USING ERRCODE = '22023';
  END IF;

  IF v_p1_response > v_p1_resolution
    OR v_p2_response > v_p2_resolution
    OR v_p3_response > v_p3_resolution
    OR v_p4_response > v_p4_resolution
  THEN
    RAISE EXCEPTION 'SLA response target cannot exceed its resolution target'
      USING ERRCODE = '22023';
  END IF;

  IF ROW(
    v_before.name,
    v_before.p1_response_minutes, v_before.p1_resolution_minutes,
    v_before.p2_response_minutes, v_before.p2_resolution_minutes,
    v_before.p3_response_minutes, v_before.p3_resolution_minutes,
    v_before.p4_response_minutes, v_before.p4_resolution_minutes
  ) IS NOT DISTINCT FROM ROW(
    v_name,
    v_p1_response, v_p1_resolution,
    v_p2_response, v_p2_resolution,
    v_p3_response, v_p3_resolution,
    v_p4_response, v_p4_resolution
  ) THEN
    RETURN pg_catalog.to_jsonb(v_before);
  END IF;

  UPDATE public.sla_policies AS policy
  SET
    name = v_name,
    p1_response_minutes = v_p1_response,
    p1_resolution_minutes = v_p1_resolution,
    p2_response_minutes = v_p2_response,
    p2_resolution_minutes = v_p2_resolution,
    p3_response_minutes = v_p3_response,
    p3_resolution_minutes = v_p3_resolution,
    p4_response_minutes = v_p4_response,
    p4_resolution_minutes = v_p4_resolution
  WHERE policy.id = p_policy_id
  RETURNING policy.* INTO v_after;

  v_before_json := pg_catalog.to_jsonb(v_before);
  v_after_json := pg_catalog.to_jsonb(v_after);

  FOREACH v_field IN ARRAY v_allowed_fields
  LOOP
    IF (v_before_json -> v_field) IS DISTINCT FROM (v_after_json -> v_field) THEN
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
        'sla_policy',
        p_policy_id,
        'updated',
        v_field,
        v_before_json ->> v_field,
        v_after_json ->> v_field,
        pg_catalog.jsonb_build_object(
          'command', 'apply_admin_sla_policy_patch'
        )
      );
    END IF;
  END LOOP;

  RETURN v_after_json;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_admin_sla_policy_atomic(
  p_actor_id uuid,
  p_policy_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_policy public.sla_policies%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618041001::bigint);

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

  IF p_policy_id IS NULL THEN
    RAISE EXCEPTION 'SLA policy id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM public.sla_policies AS policy
  WHERE policy.id = p_policy_id
  FOR UPDATE OF policy;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLA policy not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_policy.is_default THEN
    RAISE EXCEPTION 'Default SLA policy cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.tickets AS ticket
  WHERE ticket.sla_policy_id = p_policy_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Referenced SLA policy cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.sla_policies AS policy
  WHERE policy.id = p_policy_id;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    action,
    old_value,
    metadata
  )
  VALUES (
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'sla_policy',
    p_policy_id,
    'deleted',
    v_policy.name,
    pg_catalog.jsonb_build_object(
      'command', 'delete_admin_sla_policy_atomic',
      'customer_id', v_policy.customer_id,
      'is_default', v_policy.is_default
    )
  );

  RETURN pg_catalog.to_jsonb(v_policy);
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_sla_policy_atomic(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_sla_policy_patch(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_admin_sla_policy_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_admin_sla_policy_atomic(uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_sla_policy_patch(uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_admin_sla_policy_atomic(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.create_admin_sla_policy_atomic(uuid, jsonb) IS
  'Creates one default or active-tenant SLA policy and its audit evidence atomically.';
COMMENT ON FUNCTION public.apply_admin_sla_policy_patch(uuid, uuid, jsonb) IS
  'Updates SLA targets/name and exact changed-field audit evidence atomically; scope is immutable.';
COMMENT ON FUNCTION public.delete_admin_sla_policy_atomic(uuid, uuid) IS
  'Deletes only an unreferenced non-default SLA policy and preserves attributable audit evidence atomically.';

COMMIT;
