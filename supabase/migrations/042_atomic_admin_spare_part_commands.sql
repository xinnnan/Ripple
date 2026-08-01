-- Migration 042 — Atomic admin spare-part catalog commands
--
-- Catalog creation and PATCH previously committed the spare_parts row before
-- a best-effort audit write. Part-number uniqueness was case-sensitive and a
-- direct database caller could store a negative price. Existing catalog data
-- was audited before rollout: all 13 rows satisfy the normalized identity,
-- category, unit, text-length, model-array, price, and case-folded uniqueness
-- invariants added below.

BEGIN;

ALTER TABLE public.spare_parts
  ALTER COLUMN category SET NOT NULL,
  ADD CONSTRAINT spare_parts_part_number_shape
    CHECK (
      part_number = pg_catalog.btrim(part_number)
      AND pg_catalog.char_length(part_number) BETWEEN 1 AND 100
    ),
  ADD CONSTRAINT spare_parts_part_name_shape
    CHECK (
      part_name = pg_catalog.btrim(part_name)
      AND pg_catalog.char_length(part_name) BETWEEN 1 AND 200
    ),
  ADD CONSTRAINT spare_parts_description_length
    CHECK (
      description IS NULL OR pg_catalog.char_length(description) <= 2000
    ),
  ADD CONSTRAINT spare_parts_compatible_models_count
    CHECK (
      compatible_models IS NULL
      OR pg_catalog.cardinality(compatible_models) <= 50
    ),
  ADD CONSTRAINT spare_parts_image_url_length
    CHECK (image_url IS NULL OR pg_catalog.char_length(image_url) <= 2000),
  ADD CONSTRAINT spare_parts_unit_price_nonnegative
  CHECK (unit_price IS NULL OR unit_price >= 0);

CREATE UNIQUE INDEX spare_parts_part_number_casefold_unique
  ON public.spare_parts (pg_catalog.lower(pg_catalog.btrim(part_number)));

CREATE OR REPLACE FUNCTION public.create_admin_spare_part_atomic(
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
  v_part_number text;
  v_part_name text;
  v_description text;
  v_category text;
  v_unit text;
  v_unit_price numeric(10, 2);
  v_compatible_models text[];
  v_image_url text;
  v_part public.spare_parts%ROWTYPE;
  v_allowed_fields constant text[] := ARRAY[
    'part_number', 'part_name', 'description', 'category', 'unit',
    'unit_price', 'compatible_models', 'image_url'
  ];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618042001::bigint);

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
    RAISE EXCEPTION 'Spare-part create input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_input -> 'part_number') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'part_name') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'category') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'unit') <> 'string'
  THEN
    RAISE EXCEPTION 'Spare-part required field type is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_input -> 'description' <> 'null'::jsonb
    AND pg_catalog.jsonb_typeof(p_input -> 'description') <> 'string'
  THEN
    RAISE EXCEPTION 'Spare-part description must be a string or null'
      USING ERRCODE = '22023';
  END IF;

  IF p_input -> 'unit_price' <> 'null'::jsonb
    AND pg_catalog.jsonb_typeof(p_input -> 'unit_price') <> 'number'
  THEN
    RAISE EXCEPTION 'Spare-part price must be a number or null'
      USING ERRCODE = '22023';
  END IF;

  IF p_input -> 'compatible_models' <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_input -> 'compatible_models') <> 'array'
      OR pg_catalog.jsonb_array_length(p_input -> 'compatible_models') > 50
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
          p_input -> 'compatible_models'
        ) AS model(value)
        WHERE pg_catalog.jsonb_typeof(model.value) <> 'string'
          OR pg_catalog.btrim(model.value #>> '{}') = ''
          OR pg_catalog.char_length(
            pg_catalog.btrim(model.value #>> '{}')
          ) > 100
      )
    THEN
      RAISE EXCEPTION 'Compatible models must be up to 50 non-empty strings'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_input -> 'image_url' <> 'null'::jsonb
    AND pg_catalog.jsonb_typeof(p_input -> 'image_url') <> 'string'
  THEN
    RAISE EXCEPTION 'Spare-part image URL must be a string or null'
      USING ERRCODE = '22023';
  END IF;

  v_part_number := pg_catalog.btrim(p_input ->> 'part_number');
  v_part_name := pg_catalog.btrim(p_input ->> 'part_name');
  v_description := CASE
    WHEN p_input -> 'description' = 'null'::jsonb THEN NULL
    ELSE p_input ->> 'description'
  END;
  v_category := p_input ->> 'category';
  v_unit := p_input ->> 'unit';
  v_unit_price := CASE
    WHEN p_input -> 'unit_price' = 'null'::jsonb THEN NULL
    ELSE (p_input ->> 'unit_price')::numeric(10, 2)
  END;
  v_image_url := CASE
    WHEN p_input -> 'image_url' = 'null'::jsonb THEN NULL
    ELSE p_input ->> 'image_url'
  END;

  IF p_input -> 'compatible_models' = 'null'::jsonb THEN
    v_compatible_models := NULL;
  ELSE
    SELECT COALESCE(
      pg_catalog.array_agg(
        pg_catalog.btrim(model.value)
        ORDER BY model.ordinality
      ),
      ARRAY[]::text[]
    )
    INTO v_compatible_models
    FROM pg_catalog.jsonb_array_elements_text(
      p_input -> 'compatible_models'
    ) WITH ORDINALITY AS model(value, ordinality);
  END IF;

  IF v_part_number = ''
    OR pg_catalog.char_length(v_part_number) > 100
    OR v_part_name = ''
    OR pg_catalog.char_length(v_part_name) > 200
    OR (v_description IS NOT NULL
      AND pg_catalog.char_length(v_description) > 2000)
    OR v_category NOT IN (
      'sensor', 'motor', 'controller', 'belt', 'roller', 'cable',
      'connector', 'battery', 'pcb', 'mechanical', 'safety', 'tool', 'other'
    )
    OR v_unit NOT IN ('piece', 'set', 'meter', 'kg', 'liter', 'roll')
    OR (v_unit_price IS NOT NULL AND v_unit_price < 0)
    OR (v_image_url IS NOT NULL
      AND pg_catalog.char_length(v_image_url) > 2000)
  THEN
    RAISE EXCEPTION 'Spare-part values are invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.spare_parts (
    part_number,
    part_name,
    description,
    category,
    unit,
    unit_price,
    compatible_models,
    image_url,
    is_active
  )
  VALUES (
    v_part_number,
    v_part_name,
    v_description,
    v_category,
    v_unit,
    v_unit_price,
    v_compatible_models,
    v_image_url,
    true
  )
  RETURNING * INTO v_part;

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
    'spare_part',
    v_part.id,
    'created',
    v_part.part_number,
    pg_catalog.jsonb_build_object(
      'command', 'create_admin_spare_part_atomic',
      'part_name', v_part.part_name,
      'category', v_part.category,
      'unit', v_part.unit,
      'unit_price', v_part.unit_price
    )
  );

  RETURN pg_catalog.to_jsonb(v_part);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_spare_part_patch(
  p_actor_id uuid,
  p_spare_part_id uuid,
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
  v_before public.spare_parts%ROWTYPE;
  v_after public.spare_parts%ROWTYPE;
  v_before_json jsonb;
  v_candidate_json jsonb;
  v_after_json jsonb;
  v_part_number text;
  v_part_name text;
  v_description text;
  v_category text;
  v_unit text;
  v_unit_price numeric(10, 2);
  v_compatible_models text[];
  v_image_url text;
  v_is_active boolean;
  v_field text;
  v_has_changes boolean := false;
  v_allowed_fields constant text[] := ARRAY[
    'part_number', 'part_name', 'description', 'category', 'unit',
    'unit_price', 'compatible_models', 'image_url', 'is_active'
  ];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618042001::bigint);

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

  IF p_spare_part_id IS NULL THEN
    RAISE EXCEPTION 'Spare-part id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
    OR (p_patch - v_allowed_fields) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Spare-part patch is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT part.*
  INTO v_before
  FROM public.spare_parts AS part
  WHERE part.id = p_spare_part_id
  FOR UPDATE OF part;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spare part not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_part_number := v_before.part_number;
  v_part_name := v_before.part_name;
  v_description := v_before.description;
  v_category := v_before.category;
  v_unit := v_before.unit;
  v_unit_price := v_before.unit_price;
  v_compatible_models := v_before.compatible_models;
  v_image_url := v_before.image_url;
  v_is_active := v_before.is_active;

  IF p_patch ? 'part_number' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'part_number') <> 'string' THEN
      RAISE EXCEPTION 'Part number must be a string'
        USING ERRCODE = '22023';
    END IF;
    v_part_number := pg_catalog.btrim(p_patch ->> 'part_number');
  END IF;

  IF p_patch ? 'part_name' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'part_name') <> 'string' THEN
      RAISE EXCEPTION 'Part name must be a string'
        USING ERRCODE = '22023';
    END IF;
    v_part_name := pg_catalog.btrim(p_patch ->> 'part_name');
  END IF;

  IF p_patch ? 'description' THEN
    IF p_patch -> 'description' <> 'null'::jsonb
      AND pg_catalog.jsonb_typeof(p_patch -> 'description') <> 'string'
    THEN
      RAISE EXCEPTION 'Description must be a string or null'
        USING ERRCODE = '22023';
    END IF;
    v_description := CASE
      WHEN p_patch -> 'description' = 'null'::jsonb THEN NULL
      ELSE p_patch ->> 'description'
    END;
  END IF;

  IF p_patch ? 'category' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'category') <> 'string' THEN
      RAISE EXCEPTION 'Category must be a string'
        USING ERRCODE = '22023';
    END IF;
    v_category := p_patch ->> 'category';
  END IF;

  IF p_patch ? 'unit' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'unit') <> 'string' THEN
      RAISE EXCEPTION 'Unit must be a string'
        USING ERRCODE = '22023';
    END IF;
    v_unit := p_patch ->> 'unit';
  END IF;

  IF p_patch ? 'unit_price' THEN
    IF p_patch -> 'unit_price' <> 'null'::jsonb
      AND pg_catalog.jsonb_typeof(p_patch -> 'unit_price') <> 'number'
    THEN
      RAISE EXCEPTION 'Unit price must be a number or null'
        USING ERRCODE = '22023';
    END IF;
    v_unit_price := CASE
      WHEN p_patch -> 'unit_price' = 'null'::jsonb THEN NULL
      ELSE (p_patch ->> 'unit_price')::numeric(10, 2)
    END;
  END IF;

  IF p_patch ? 'compatible_models' THEN
    IF p_patch -> 'compatible_models' = 'null'::jsonb THEN
      v_compatible_models := NULL;
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'compatible_models') <> 'array'
        OR pg_catalog.jsonb_array_length(
          p_patch -> 'compatible_models'
        ) > 50
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(
            p_patch -> 'compatible_models'
          ) AS model(value)
          WHERE pg_catalog.jsonb_typeof(model.value) <> 'string'
            OR pg_catalog.btrim(model.value #>> '{}') = ''
            OR pg_catalog.char_length(
              pg_catalog.btrim(model.value #>> '{}')
            ) > 100
        )
      THEN
        RAISE EXCEPTION 'Compatible models must be up to 50 non-empty strings'
          USING ERRCODE = '22023';
      END IF;

      SELECT COALESCE(
        pg_catalog.array_agg(
          pg_catalog.btrim(model.value)
          ORDER BY model.ordinality
        ),
        ARRAY[]::text[]
      )
      INTO v_compatible_models
      FROM pg_catalog.jsonb_array_elements_text(
        p_patch -> 'compatible_models'
      ) WITH ORDINALITY AS model(value, ordinality);
    END IF;
  END IF;

  IF p_patch ? 'image_url' THEN
    IF p_patch -> 'image_url' <> 'null'::jsonb
      AND pg_catalog.jsonb_typeof(p_patch -> 'image_url') <> 'string'
    THEN
      RAISE EXCEPTION 'Image URL must be a string or null'
        USING ERRCODE = '22023';
    END IF;
    v_image_url := CASE
      WHEN p_patch -> 'image_url' = 'null'::jsonb THEN NULL
      ELSE p_patch ->> 'image_url'
    END;
  END IF;

  IF p_patch ? 'is_active' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'is_active') <> 'boolean' THEN
      RAISE EXCEPTION 'Active state must be boolean'
        USING ERRCODE = '22023';
    END IF;
    v_is_active := (p_patch ->> 'is_active')::boolean;
  END IF;

  IF v_part_number = ''
    OR pg_catalog.char_length(v_part_number) > 100
    OR v_part_name = ''
    OR pg_catalog.char_length(v_part_name) > 200
    OR (v_description IS NOT NULL
      AND pg_catalog.char_length(v_description) > 2000)
    OR v_category NOT IN (
      'sensor', 'motor', 'controller', 'belt', 'roller', 'cable',
      'connector', 'battery', 'pcb', 'mechanical', 'safety', 'tool', 'other'
    )
    OR v_unit NOT IN ('piece', 'set', 'meter', 'kg', 'liter', 'roll')
    OR (v_unit_price IS NOT NULL AND v_unit_price < 0)
    OR (v_image_url IS NOT NULL
      AND pg_catalog.char_length(v_image_url) > 2000)
  THEN
    RAISE EXCEPTION 'Spare-part values are invalid'
      USING ERRCODE = '22023';
  END IF;

  v_before_json := pg_catalog.to_jsonb(v_before);
  v_candidate_json := pg_catalog.jsonb_build_object(
    'part_number', v_part_number,
    'part_name', v_part_name,
    'description', v_description,
    'category', v_category,
    'unit', v_unit,
    'unit_price', v_unit_price,
    'compatible_models', v_compatible_models,
    'image_url', v_image_url,
    'is_active', v_is_active
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
    RETURN v_before_json;
  END IF;

  UPDATE public.spare_parts AS part
  SET
    part_number = v_part_number,
    part_name = v_part_name,
    description = v_description,
    category = v_category,
    unit = v_unit,
    unit_price = v_unit_price,
    compatible_models = v_compatible_models,
    image_url = v_image_url,
    is_active = v_is_active,
    updated_at = pg_catalog.now()
  WHERE part.id = p_spare_part_id
  RETURNING part.* INTO v_after;

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
        'spare_part',
        p_spare_part_id,
        'updated',
        v_field,
        v_before_json ->> v_field,
        v_after_json ->> v_field,
        pg_catalog.jsonb_build_object(
          'command', 'apply_admin_spare_part_patch'
        )
      );
    END IF;
  END LOOP;

  RETURN v_after_json;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_spare_part_atomic(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_spare_part_patch(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_admin_spare_part_atomic(uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_spare_part_patch(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.create_admin_spare_part_atomic(uuid, jsonb) IS
  'Creates one normalized active catalog part and its audit evidence atomically.';
COMMENT ON FUNCTION public.apply_admin_spare_part_patch(uuid, uuid, jsonb) IS
  'Updates exact spare-part catalog fields and audit evidence atomically; no-op patches do not touch the row.';

COMMIT;
