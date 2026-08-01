-- Migration 043 — Atomic admin spare-part inventory commands
--
-- Inventory upsert/PATCH previously committed stock state before best-effort
-- audit writes. Parent lifecycle checks, final min/max relationships, and the
-- meaning of last_restocked_at were not enforced at the database boundary.
-- Existing inventory was audited before rollout: all eight rows satisfy the
-- nonnegative, ordered-bound, normalized-location, and active-parent
-- invariants added below.

BEGIN;

ALTER TABLE public.spare_part_inventory
  ADD CONSTRAINT spare_part_inventory_quantity_nonnegative
    CHECK (quantity >= 0),
  ADD CONSTRAINT spare_part_inventory_min_quantity_nonnegative
    CHECK (min_quantity >= 0),
  ADD CONSTRAINT spare_part_inventory_max_quantity_nonnegative
    CHECK (max_quantity IS NULL OR max_quantity >= 0),
  ADD CONSTRAINT spare_part_inventory_bounds_ordered
    CHECK (max_quantity IS NULL OR min_quantity <= max_quantity),
  ADD CONSTRAINT spare_part_inventory_quantity_within_maximum
    CHECK (max_quantity IS NULL OR quantity <= max_quantity),
  ADD CONSTRAINT spare_part_inventory_location_shape
    CHECK (
      location IS NULL
      OR (
        location = pg_catalog.btrim(location)
        AND pg_catalog.char_length(location) BETWEEN 1 AND 200
      )
    );

CREATE OR REPLACE FUNCTION public.upsert_admin_spare_part_inventory_atomic(
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
  v_spare_part_id uuid;
  v_site_id uuid;
  v_quantity_numeric numeric;
  v_min_quantity_numeric numeric;
  v_max_quantity_numeric numeric;
  v_quantity integer;
  v_min_quantity integer;
  v_max_quantity integer;
  v_location text;
  v_part_number text;
  v_part_name text;
  v_part_category text;
  v_site_name text;
  v_site_code text;
  v_before public.spare_part_inventory%ROWTYPE;
  v_after public.spare_part_inventory%ROWTYPE;
  v_before_json jsonb;
  v_candidate_json jsonb;
  v_after_json jsonb;
  v_field text;
  v_has_existing boolean := false;
  v_has_changes boolean := false;
  v_restocked boolean := false;
  v_allowed_fields constant text[] := ARRAY[
    'spare_part_id', 'site_id', 'quantity', 'min_quantity',
    'max_quantity', 'location'
  ];
  v_mutable_fields constant text[] := ARRAY[
    'quantity', 'min_quantity', 'max_quantity', 'location'
  ];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618043001::bigint);

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
    RAISE EXCEPTION 'Inventory input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_input -> 'spare_part_id') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'site_id') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'quantity') <> 'number'
    OR pg_catalog.jsonb_typeof(p_input -> 'min_quantity') <> 'number'
    OR (
      p_input -> 'max_quantity' <> 'null'::jsonb
      AND pg_catalog.jsonb_typeof(p_input -> 'max_quantity') <> 'number'
    )
    OR (
      p_input -> 'location' <> 'null'::jsonb
      AND pg_catalog.jsonb_typeof(p_input -> 'location') <> 'string'
    )
  THEN
    RAISE EXCEPTION 'Inventory field type is invalid'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_spare_part_id := (p_input ->> 'spare_part_id')::uuid;
    v_site_id := (p_input ->> 'site_id')::uuid;
    v_quantity_numeric := (p_input ->> 'quantity')::numeric;
    v_min_quantity_numeric := (p_input ->> 'min_quantity')::numeric;
    IF p_input -> 'max_quantity' <> 'null'::jsonb THEN
      v_max_quantity_numeric := (p_input ->> 'max_quantity')::numeric;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Inventory identifiers and quantities are invalid'
        USING ERRCODE = '22023';
  END;

  IF v_spare_part_id IS NULL
    OR v_site_id IS NULL
    OR v_quantity_numeric IS NULL
    OR v_quantity_numeric <> pg_catalog.trunc(v_quantity_numeric)
    OR v_quantity_numeric < 0
    OR v_quantity_numeric > 2147483647
    OR v_min_quantity_numeric IS NULL
    OR v_min_quantity_numeric <> pg_catalog.trunc(v_min_quantity_numeric)
    OR v_min_quantity_numeric < 0
    OR v_min_quantity_numeric > 2147483647
    OR (
      v_max_quantity_numeric IS NOT NULL
      AND (
        v_max_quantity_numeric <> pg_catalog.trunc(v_max_quantity_numeric)
        OR v_max_quantity_numeric < 0
        OR v_max_quantity_numeric > 2147483647
      )
    )
  THEN
    RAISE EXCEPTION 'Inventory quantities must be nonnegative integers'
      USING ERRCODE = '22023';
  END IF;

  v_quantity := v_quantity_numeric::integer;
  v_min_quantity := v_min_quantity_numeric::integer;
  v_max_quantity := v_max_quantity_numeric::integer;
  v_location := CASE
    WHEN p_input -> 'location' = 'null'::jsonb THEN NULL
    ELSE NULLIF(pg_catalog.btrim(p_input ->> 'location'), '')
  END;

  IF (v_max_quantity IS NOT NULL AND v_min_quantity > v_max_quantity)
    OR (v_max_quantity IS NOT NULL AND v_quantity > v_max_quantity)
    OR (
      v_location IS NOT NULL
      AND pg_catalog.char_length(v_location) > 200
    )
  THEN
    RAISE EXCEPTION 'Inventory values are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT part.part_number, part.part_name, part.category
  INTO v_part_number, v_part_name, v_part_category
  FROM public.spare_parts AS part
  WHERE part.id = v_spare_part_id
    AND part.is_active = true
  FOR SHARE OF part;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active spare part is required'
      USING ERRCODE = '55000';
  END IF;

  SELECT site.site_name, site.site_code
  INTO v_site_name, v_site_code
  FROM public.sites AS site
  JOIN public.customers AS customer ON customer.id = site.customer_id
  WHERE site.id = v_site_id
    AND site.status IN ('active', 'commissioning')
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF site, customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active site and customer are required'
      USING ERRCODE = '55000';
  END IF;

  SELECT inventory.*
  INTO v_before
  FROM public.spare_part_inventory AS inventory
  WHERE inventory.spare_part_id = v_spare_part_id
    AND inventory.site_id = v_site_id
  FOR UPDATE OF inventory;

  v_has_existing := FOUND;

  IF NOT v_has_existing THEN
    INSERT INTO public.spare_part_inventory (
      spare_part_id,
      site_id,
      quantity,
      min_quantity,
      max_quantity,
      location,
      last_restocked_at
    )
    VALUES (
      v_spare_part_id,
      v_site_id,
      v_quantity,
      v_min_quantity,
      v_max_quantity,
      v_location,
      CASE WHEN v_quantity > 0 THEN pg_catalog.now() ELSE NULL END
    )
    RETURNING * INTO v_after;

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
      'spare_part_inventory',
      v_after.id,
      'created',
      v_after.quantity::text,
      pg_catalog.jsonb_build_object(
        'command', 'upsert_admin_spare_part_inventory_atomic',
        'spare_part_id', v_spare_part_id,
        'part_number', v_part_number,
        'site_id', v_site_id,
        'site_code', v_site_code,
        'quantity', v_after.quantity,
        'min_quantity', v_after.min_quantity,
        'max_quantity', v_after.max_quantity,
        'location', v_after.location,
        'restocked', v_after.last_restocked_at IS NOT NULL
      )
    );
  ELSE
    v_before_json := pg_catalog.to_jsonb(v_before);
    v_candidate_json := pg_catalog.jsonb_build_object(
      'quantity', v_quantity,
      'min_quantity', v_min_quantity,
      'max_quantity', v_max_quantity,
      'location', v_location
    );

    FOREACH v_field IN ARRAY v_mutable_fields
    LOOP
      IF (v_before_json -> v_field) IS DISTINCT FROM
        (v_candidate_json -> v_field)
      THEN
        v_has_changes := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_has_changes THEN
      v_after := v_before;
    ELSE
      v_restocked := v_quantity > v_before.quantity;

      UPDATE public.spare_part_inventory AS inventory
      SET
        quantity = v_quantity,
        min_quantity = v_min_quantity,
        max_quantity = v_max_quantity,
        location = v_location,
        last_restocked_at = CASE
          WHEN v_restocked THEN pg_catalog.now()
          ELSE v_before.last_restocked_at
        END,
        updated_at = pg_catalog.now()
      WHERE inventory.id = v_before.id
      RETURNING inventory.* INTO v_after;

      v_after_json := pg_catalog.to_jsonb(v_after);

      FOREACH v_field IN ARRAY v_mutable_fields
      LOOP
        IF (v_before_json -> v_field) IS DISTINCT FROM
          (v_after_json -> v_field)
        THEN
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
            'spare_part_inventory',
            v_after.id,
            'updated',
            v_field,
            v_before_json ->> v_field,
            v_after_json ->> v_field,
            pg_catalog.jsonb_build_object(
              'command', 'upsert_admin_spare_part_inventory_atomic',
              'spare_part_id', v_spare_part_id,
              'site_id', v_site_id,
              'restocked', v_restocked
            )
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN pg_catalog.to_jsonb(v_after) || pg_catalog.jsonb_build_object(
    'spare_part', pg_catalog.jsonb_build_object(
      'id', v_spare_part_id,
      'part_number', v_part_number,
      'part_name', v_part_name,
      'category', v_part_category
    ),
    'site', pg_catalog.jsonb_build_object(
      'id', v_site_id,
      'site_name', v_site_name,
      'site_code', v_site_code
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_spare_part_inventory_patch(
  p_actor_id uuid,
  p_inventory_id uuid,
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
  v_before public.spare_part_inventory%ROWTYPE;
  v_after public.spare_part_inventory%ROWTYPE;
  v_before_json jsonb;
  v_candidate_json jsonb;
  v_after_json jsonb;
  v_quantity_numeric numeric;
  v_min_quantity_numeric numeric;
  v_max_quantity_numeric numeric;
  v_quantity integer;
  v_min_quantity integer;
  v_max_quantity integer;
  v_location text;
  v_part_number text;
  v_part_name text;
  v_part_category text;
  v_site_name text;
  v_site_code text;
  v_field text;
  v_has_changes boolean := false;
  v_restocked boolean := false;
  v_allowed_fields constant text[] := ARRAY[
    'quantity', 'min_quantity', 'max_quantity', 'location'
  ];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618043001::bigint);

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

  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'Inventory id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
    OR (p_patch - v_allowed_fields) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Inventory patch is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT inventory.*
  INTO v_before
  FROM public.spare_part_inventory AS inventory
  WHERE inventory.id = p_inventory_id
  FOR UPDATE OF inventory;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory record not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT part.part_number, part.part_name, part.category
  INTO v_part_number, v_part_name, v_part_category
  FROM public.spare_parts AS part
  WHERE part.id = v_before.spare_part_id
    AND part.is_active = true
  FOR SHARE OF part;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active spare part is required'
      USING ERRCODE = '55000';
  END IF;

  SELECT site.site_name, site.site_code
  INTO v_site_name, v_site_code
  FROM public.sites AS site
  JOIN public.customers AS customer ON customer.id = site.customer_id
  WHERE site.id = v_before.site_id
    AND site.status IN ('active', 'commissioning')
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF site, customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active site and customer are required'
      USING ERRCODE = '55000';
  END IF;

  v_quantity := v_before.quantity;
  v_min_quantity := v_before.min_quantity;
  v_max_quantity := v_before.max_quantity;
  v_location := v_before.location;

  IF p_patch ? 'quantity' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'quantity') <> 'number' THEN
      RAISE EXCEPTION 'Inventory quantity must be a number'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_quantity_numeric := (p_patch ->> 'quantity')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Inventory quantity is invalid'
          USING ERRCODE = '22023';
    END;
    IF v_quantity_numeric <> pg_catalog.trunc(v_quantity_numeric)
      OR v_quantity_numeric < 0
      OR v_quantity_numeric > 2147483647
    THEN
      RAISE EXCEPTION 'Inventory quantity must be a nonnegative integer'
        USING ERRCODE = '22023';
    END IF;
    v_quantity := v_quantity_numeric::integer;
  END IF;

  IF p_patch ? 'min_quantity' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'min_quantity') <> 'number' THEN
      RAISE EXCEPTION 'Minimum quantity must be a number'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_min_quantity_numeric := (p_patch ->> 'min_quantity')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Minimum quantity is invalid'
          USING ERRCODE = '22023';
    END;
    IF v_min_quantity_numeric <> pg_catalog.trunc(v_min_quantity_numeric)
      OR v_min_quantity_numeric < 0
      OR v_min_quantity_numeric > 2147483647
    THEN
      RAISE EXCEPTION 'Minimum quantity must be a nonnegative integer'
        USING ERRCODE = '22023';
    END IF;
    v_min_quantity := v_min_quantity_numeric::integer;
  END IF;

  IF p_patch ? 'max_quantity' THEN
    IF p_patch -> 'max_quantity' = 'null'::jsonb THEN
      v_max_quantity := NULL;
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'max_quantity') <> 'number' THEN
        RAISE EXCEPTION 'Maximum quantity must be a number or null'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_max_quantity_numeric := (p_patch ->> 'max_quantity')::numeric;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'Maximum quantity is invalid'
            USING ERRCODE = '22023';
      END;
      IF v_max_quantity_numeric <> pg_catalog.trunc(v_max_quantity_numeric)
        OR v_max_quantity_numeric < 0
        OR v_max_quantity_numeric > 2147483647
      THEN
        RAISE EXCEPTION 'Maximum quantity must be a nonnegative integer'
          USING ERRCODE = '22023';
      END IF;
      v_max_quantity := v_max_quantity_numeric::integer;
    END IF;
  END IF;

  IF p_patch ? 'location' THEN
    IF p_patch -> 'location' <> 'null'::jsonb
      AND pg_catalog.jsonb_typeof(p_patch -> 'location') <> 'string'
    THEN
      RAISE EXCEPTION 'Inventory location must be a string or null'
        USING ERRCODE = '22023';
    END IF;
    v_location := CASE
      WHEN p_patch -> 'location' = 'null'::jsonb THEN NULL
      ELSE NULLIF(pg_catalog.btrim(p_patch ->> 'location'), '')
    END;
  END IF;

  IF (v_max_quantity IS NOT NULL AND v_min_quantity > v_max_quantity)
    OR (v_max_quantity IS NOT NULL AND v_quantity > v_max_quantity)
    OR (
      v_location IS NOT NULL
      AND pg_catalog.char_length(v_location) > 200
    )
  THEN
    RAISE EXCEPTION 'Inventory values are invalid'
      USING ERRCODE = '22023';
  END IF;

  v_before_json := pg_catalog.to_jsonb(v_before);
  v_candidate_json := pg_catalog.jsonb_build_object(
    'quantity', v_quantity,
    'min_quantity', v_min_quantity,
    'max_quantity', v_max_quantity,
    'location', v_location
  );

  FOREACH v_field IN ARRAY v_allowed_fields
  LOOP
    IF (v_before_json -> v_field) IS DISTINCT FROM
      (v_candidate_json -> v_field)
    THEN
      v_has_changes := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT v_has_changes THEN
    v_after := v_before;
  ELSE
    v_restocked := v_quantity > v_before.quantity;

    UPDATE public.spare_part_inventory AS inventory
    SET
      quantity = v_quantity,
      min_quantity = v_min_quantity,
      max_quantity = v_max_quantity,
      location = v_location,
      last_restocked_at = CASE
        WHEN v_restocked THEN pg_catalog.now()
        ELSE v_before.last_restocked_at
      END,
      updated_at = pg_catalog.now()
    WHERE inventory.id = p_inventory_id
    RETURNING inventory.* INTO v_after;

    v_after_json := pg_catalog.to_jsonb(v_after);

    FOREACH v_field IN ARRAY v_allowed_fields
    LOOP
      IF (v_before_json -> v_field) IS DISTINCT FROM
        (v_after_json -> v_field)
      THEN
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
          'spare_part_inventory',
          p_inventory_id,
          'updated',
          v_field,
          v_before_json ->> v_field,
          v_after_json ->> v_field,
          pg_catalog.jsonb_build_object(
            'command', 'apply_admin_spare_part_inventory_patch',
            'spare_part_id', v_before.spare_part_id,
            'site_id', v_before.site_id,
            'restocked', v_restocked
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN pg_catalog.to_jsonb(v_after) || pg_catalog.jsonb_build_object(
    'spare_part', pg_catalog.jsonb_build_object(
      'id', v_before.spare_part_id,
      'part_number', v_part_number,
      'part_name', v_part_name,
      'category', v_part_category
    ),
    'site', pg_catalog.jsonb_build_object(
      'id', v_before.site_id,
      'site_name', v_site_name,
      'site_code', v_site_code
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_admin_spare_part_inventory_atomic(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_spare_part_inventory_patch(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_admin_spare_part_inventory_atomic(uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_spare_part_inventory_patch(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.upsert_admin_spare_part_inventory_atomic(uuid, jsonb) IS
  'Creates or replaces one active-site inventory row and its exact audit evidence atomically.';
COMMENT ON FUNCTION public.apply_admin_spare_part_inventory_patch(uuid, uuid, jsonb) IS
  'Updates one editable inventory row and its exact audit evidence atomically; only quantity increases count as restocks.';

COMMIT;
