-- Migration 030 — Atomic field-service order commands
--
-- Closes the field-service half of INT-004:
--   * order creation, engineer assignments, sequence allocation, and audit
--     attribution commit together;
--   * order updates and complete assignment replacement commit together;
--   * active actor, tenant lifecycle, ticket/site containment, engineer
--     identity, and DATE-only contracts are enforced in the database command;
--   * response hydration remains outside the mutation transaction.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'field_service_orders_schedule_bounds'
      AND conrelid =
        'public.field_service_orders'::pg_catalog.regclass
  ) THEN
    ALTER TABLE public.field_service_orders
      ADD CONSTRAINT field_service_orders_schedule_bounds
      CHECK (
        scheduled_date IS NULL
        OR scheduled_end_date IS NULL
        OR scheduled_end_date >= scheduled_date
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'field_service_orders_hour_bounds'
      AND conrelid =
        'public.field_service_orders'::pg_catalog.regclass
  ) THEN
    ALTER TABLE public.field_service_orders
      ADD CONSTRAINT field_service_orders_hour_bounds
      CHECK (
        (
          estimated_hours IS NULL
          OR (estimated_hours >= 0 AND estimated_hours <= 9999.9)
        )
        AND (
          actual_hours IS NULL
          OR (actual_hours >= 0 AND actual_hours <= 9999.9)
        )
      )
      NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_field_service_order_atomic(
  p_actor_id uuid,
  p_input jsonb,
  p_engineers jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_site_id uuid;
  v_ticket_id uuid;
  v_ticket_site_id uuid;
  v_service_type text;
  v_priority text;
  v_title text;
  v_description text;
  v_scheduled_date date;
  v_scheduled_end_date date;
  v_estimated_hours numeric;
  v_travel_required boolean;
  v_travel_from text;
  v_order_id uuid;
  v_order_no text;
  v_engineer record;
  v_engineer_count integer;
BEGIN
  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
  THEN
    RAISE EXCEPTION 'Field service order input must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_engineers IS NULL
    OR pg_catalog.jsonb_typeof(p_engineers) <> 'array'
  THEN
    RAISE EXCEPTION 'Engineer assignments must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  v_engineer_count := pg_catalog.jsonb_array_length(p_engineers);
  IF v_engineer_count > 20 THEN
    RAISE EXCEPTION 'At most 20 engineers may be assigned'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE supplied.key NOT IN (
      'ticket_id',
      'site_id',
      'service_type',
      'priority',
      'title',
      'description',
      'scheduled_date',
      'scheduled_end_date',
      'estimated_hours',
      'travel_required',
      'travel_from'
    )
  ) THEN
    RAISE EXCEPTION 'Field service order input contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_engineers) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Every engineer assignment must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_engineers) AS item(value)
    CROSS JOIN LATERAL
      pg_catalog.jsonb_object_keys(item.value) AS supplied(key)
    WHERE supplied.key NOT IN ('engineer_id', 'role')
  ) THEN
    RAISE EXCEPTION 'Engineer assignment contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.role
  INTO v_actor_email, v_actor_role
  FROM public.users AS u
  WHERE u.id = p_actor_id
    AND u.status = 'active'
    AND u.role IN ('admin', 'engineer')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active internal account required'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_site_id := (p_input ->> 'site_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'A valid site id is required'
        USING ERRCODE = '22023';
  END;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'A valid site id is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.sites AS s
  JOIN public.customers AS c ON c.id = s.customer_id
  WHERE s.id = v_site_id
    AND s.status = 'active'
    AND c.status IN ('active', 'trial')
  FOR SHARE OF s, c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active site and customer are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_input ? 'ticket_id'
    AND p_input -> 'ticket_id' <> 'null'::jsonb
  THEN
    BEGIN
      v_ticket_id := (p_input ->> 'ticket_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Ticket id must be a UUID'
          USING ERRCODE = '22023';
    END;

    IF v_ticket_id IS NULL THEN
      RAISE EXCEPTION 'Ticket id must be a UUID or null'
        USING ERRCODE = '22023';
    END IF;

    SELECT t.site_id
    INTO v_ticket_site_id
    FROM public.tickets AS t
    WHERE t.id = v_ticket_id
    FOR SHARE;

    IF NOT FOUND OR v_ticket_site_id IS DISTINCT FROM v_site_id THEN
      RAISE EXCEPTION 'Ticket must belong to the selected site'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_service_type := p_input ->> 'service_type';
  IF v_service_type IS NULL OR v_service_type NOT IN (
    'repair',
    'installation',
    'inspection',
    'commissioning',
    'training',
    'emergency',
    'maintenance'
  ) THEN
    RAISE EXCEPTION 'Unsupported field service type'
      USING ERRCODE = '22023';
  END IF;

  v_priority := pg_catalog.coalesce(p_input ->> 'priority', 'normal');
  IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Unsupported field service priority'
      USING ERRCODE = '22023';
  END IF;

  v_title := pg_catalog.btrim(p_input ->> 'title');
  IF v_title IS NULL
    OR v_title = ''
    OR pg_catalog.char_length(v_title) > 200
  THEN
    RAISE EXCEPTION 'Field service title is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_input ? 'description'
    AND p_input -> 'description' <> 'null'::jsonb
  THEN
    v_description := p_input ->> 'description';
    IF pg_catalog.char_length(v_description) > 5000 THEN
      RAISE EXCEPTION 'Field service description is too long'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_input ? 'scheduled_date'
    AND p_input -> 'scheduled_date' <> 'null'::jsonb
  THEN
    IF (p_input ->> 'scheduled_date')
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN
      RAISE EXCEPTION 'Scheduled date must use YYYY-MM-DD'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_scheduled_date := (p_input ->> 'scheduled_date')::date;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Scheduled date must be a real calendar date'
          USING ERRCODE = '22023';
    END;
  END IF;

  IF p_input ? 'scheduled_end_date'
    AND p_input -> 'scheduled_end_date' <> 'null'::jsonb
  THEN
    IF (p_input ->> 'scheduled_end_date')
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN
      RAISE EXCEPTION 'Scheduled end date must use YYYY-MM-DD'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_scheduled_end_date :=
        (p_input ->> 'scheduled_end_date')::date;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Scheduled end date must be a real calendar date'
          USING ERRCODE = '22023';
    END;
  END IF;

  IF v_scheduled_date IS NOT NULL
    AND v_scheduled_end_date IS NOT NULL
    AND v_scheduled_end_date < v_scheduled_date
  THEN
    RAISE EXCEPTION 'Scheduled end date cannot precede start date'
      USING ERRCODE = '22023';
  END IF;

  IF p_input ? 'estimated_hours'
    AND p_input -> 'estimated_hours' <> 'null'::jsonb
  THEN
    BEGIN
      v_estimated_hours := (p_input ->> 'estimated_hours')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Estimated hours must be numeric'
          USING ERRCODE = '22023';
    END;
    IF v_estimated_hours < 0 OR v_estimated_hours > 9999.9 THEN
      RAISE EXCEPTION 'Estimated hours are outside the supported range'
        USING ERRCODE = '22023';
    END IF;
    IF v_estimated_hours IS DISTINCT FROM
      pg_catalog.round(v_estimated_hours, 1)
    THEN
      RAISE EXCEPTION 'Estimated hours support one decimal place'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_input ? 'travel_required' THEN
    IF p_input -> 'travel_required' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Travel required must be a boolean'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_travel_required := (p_input ->> 'travel_required')::boolean;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Travel required must be a boolean'
          USING ERRCODE = '22023';
    END;
  ELSE
    v_travel_required := true;
  END IF;

  IF p_input ? 'travel_from'
    AND p_input -> 'travel_from' <> 'null'::jsonb
  THEN
    v_travel_from := p_input ->> 'travel_from';
    IF pg_catalog.char_length(v_travel_from) > 200 THEN
      RAISE EXCEPTION 'Travel origin is too long'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_engineers)
      AS supplied(engineer_id uuid, role text)
    GROUP BY supplied.engineer_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate engineer assignment'
      USING ERRCODE = '22023';
  END IF;

  FOR v_engineer IN
    SELECT
      supplied.engineer_id,
      pg_catalog.coalesce(supplied.role, 'engineer') AS role
    FROM pg_catalog.jsonb_to_recordset(p_engineers)
      AS supplied(engineer_id uuid, role text)
    ORDER BY supplied.engineer_id
  LOOP
    IF v_engineer.engineer_id IS NULL
      OR v_engineer.role NOT IN ('lead', 'engineer', 'assistant')
    THEN
      RAISE EXCEPTION 'Engineer assignment is invalid'
        USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.users AS u
    WHERE u.id = v_engineer.engineer_id
      AND u.status = 'active'
      AND u.role = 'engineer'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Every assignee must be an active engineer'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_order_no := public.next_order_no();

  INSERT INTO public.field_service_orders (
    order_no,
    ticket_id,
    site_id,
    service_type,
    status,
    priority,
    title,
    description,
    scheduled_date,
    scheduled_end_date,
    estimated_hours,
    travel_required,
    travel_from,
    requested_by
  )
  VALUES (
    v_order_no,
    v_ticket_id,
    v_site_id,
    v_service_type,
    'scheduled',
    v_priority,
    v_title,
    v_description,
    v_scheduled_date,
    v_scheduled_end_date,
    v_estimated_hours,
    v_travel_required,
    v_travel_from,
    p_actor_id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.field_service_engineers (
    order_id,
    engineer_id,
    role
  )
  SELECT
    v_order_id,
    supplied.engineer_id,
    pg_catalog.coalesce(supplied.role, 'engineer')
  FROM pg_catalog.jsonb_to_recordset(p_engineers)
    AS supplied(engineer_id uuid, role text)
  ORDER BY supplied.engineer_id;

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
    'field_service_order',
    v_order_id,
    'created',
    v_order_no,
    pg_catalog.jsonb_build_object(
      'site_id', v_site_id,
      'ticket_id', v_ticket_id,
      'service_type', v_service_type,
      'priority', v_priority,
      'scheduled_date', v_scheduled_date,
      'engineer_count', v_engineer_count,
      'command', 'create_field_service_order_atomic'
    )
  );

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_field_service_order_patch(
  p_order_id uuid,
  p_actor_id uuid,
  p_patch jsonb,
  p_engineers jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.field_service_orders%ROWTYPE;
  v_after public.field_service_orders%ROWTYPE;
  v_actor_email text;
  v_actor_role text;
  v_occurred_at timestamptz;
  v_new_status text;
  v_new_title text;
  v_new_description text;
  v_new_service_type text;
  v_new_priority text;
  v_new_scheduled_date date;
  v_new_scheduled_end_date date;
  v_new_estimated_hours numeric;
  v_new_actual_hours numeric;
  v_new_travel_required boolean;
  v_new_travel_from text;
  v_new_completion_report text;
  v_new_completion_notes text;
  v_new_completed_by uuid;
  v_new_completed_at timestamptz;
  v_engineer record;
  v_old_engineers jsonb;
  v_new_engineers jsonb;
BEGIN
  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
  THEN
    RAISE EXCEPTION 'Field service order patch must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_engineers IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_engineers) <> 'array'
  THEN
    RAISE EXCEPTION 'Engineer assignments must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch = '{}'::jsonb AND p_engineers IS NULL THEN
    RAISE EXCEPTION 'Field service order update must contain a change'
      USING ERRCODE = '22023';
  END IF;

  IF p_engineers IS NOT NULL
    AND pg_catalog.jsonb_array_length(p_engineers) > 20
  THEN
    RAISE EXCEPTION 'At most 20 engineers may be assigned'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN (
      'status',
      'title',
      'description',
      'service_type',
      'priority',
      'scheduled_date',
      'scheduled_end_date',
      'estimated_hours',
      'actual_hours',
      'travel_required',
      'travel_from',
      'completion_report',
      'completion_notes'
    )
  ) THEN
    RAISE EXCEPTION 'Field service order patch contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF p_engineers IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_engineers) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Every engineer assignment must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_engineers IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_engineers) AS item(value)
    CROSS JOIN LATERAL
      pg_catalog.jsonb_object_keys(item.value) AS supplied(key)
    WHERE supplied.key NOT IN ('engineer_id', 'role')
  ) THEN
    RAISE EXCEPTION 'Engineer assignment contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.role
  INTO v_actor_email, v_actor_role
  FROM public.users AS u
  WHERE u.id = p_actor_id
    AND u.status = 'active'
    AND u.role IN ('admin', 'engineer')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active internal account required'
      USING ERRCODE = '42501';
  END IF;

  SELECT fso.*
  INTO v_order
  FROM public.field_service_orders AS fso
  WHERE fso.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field service order not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_occurred_at := pg_catalog.clock_timestamp();
  v_new_status := CASE
    WHEN p_patch ? 'status' THEN p_patch ->> 'status'
    ELSE v_order.status
  END;
  IF v_new_status IS NULL OR v_new_status NOT IN (
    'scheduled',
    'in_progress',
    'completed',
    'cancelled'
  ) THEN
    RAISE EXCEPTION 'Unsupported field service status'
      USING ERRCODE = '22023';
  END IF;

  v_new_service_type := CASE
    WHEN p_patch ? 'service_type' THEN p_patch ->> 'service_type'
    ELSE v_order.service_type
  END;
  IF v_new_service_type IS NULL OR v_new_service_type NOT IN (
    'repair',
    'installation',
    'inspection',
    'commissioning',
    'training',
    'emergency',
    'maintenance'
  ) THEN
    RAISE EXCEPTION 'Unsupported field service type'
      USING ERRCODE = '22023';
  END IF;

  v_new_priority := CASE
    WHEN p_patch ? 'priority' THEN p_patch ->> 'priority'
    ELSE v_order.priority
  END;
  IF v_new_priority IS NULL
    OR v_new_priority NOT IN ('low', 'normal', 'high', 'urgent')
  THEN
    RAISE EXCEPTION 'Unsupported field service priority'
      USING ERRCODE = '22023';
  END IF;

  v_new_title := CASE
    WHEN p_patch ? 'title' THEN pg_catalog.btrim(p_patch ->> 'title')
    ELSE v_order.title
  END;
  IF v_new_title IS NULL
    OR v_new_title = ''
    OR pg_catalog.char_length(v_new_title) > 200
  THEN
    RAISE EXCEPTION 'Field service title is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  v_new_description := CASE
    WHEN p_patch ? 'description' THEN p_patch ->> 'description'
    ELSE v_order.description
  END;
  IF v_new_description IS NOT NULL
    AND pg_catalog.char_length(v_new_description) > 5000
  THEN
    RAISE EXCEPTION 'Field service description is too long'
      USING ERRCODE = '22023';
  END IF;

  v_new_scheduled_date := v_order.scheduled_date;
  IF p_patch ? 'scheduled_date' THEN
    IF p_patch -> 'scheduled_date' = 'null'::jsonb THEN
      v_new_scheduled_date := NULL;
    ELSE
      IF (p_patch ->> 'scheduled_date')
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN
        RAISE EXCEPTION 'Scheduled date must use YYYY-MM-DD'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_new_scheduled_date := (p_patch ->> 'scheduled_date')::date;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          RAISE EXCEPTION 'Scheduled date must be a real calendar date'
            USING ERRCODE = '22023';
      END;
    END IF;
  END IF;

  v_new_scheduled_end_date := v_order.scheduled_end_date;
  IF p_patch ? 'scheduled_end_date' THEN
    IF p_patch -> 'scheduled_end_date' = 'null'::jsonb THEN
      v_new_scheduled_end_date := NULL;
    ELSE
      IF (p_patch ->> 'scheduled_end_date')
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN
        RAISE EXCEPTION 'Scheduled end date must use YYYY-MM-DD'
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_new_scheduled_end_date :=
          (p_patch ->> 'scheduled_end_date')::date;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          RAISE EXCEPTION 'Scheduled end date must be a real calendar date'
            USING ERRCODE = '22023';
      END;
    END IF;
  END IF;

  IF v_new_scheduled_date IS NOT NULL
    AND v_new_scheduled_end_date IS NOT NULL
    AND v_new_scheduled_end_date < v_new_scheduled_date
  THEN
    RAISE EXCEPTION 'Scheduled end date cannot precede start date'
      USING ERRCODE = '22023';
  END IF;

  v_new_estimated_hours := v_order.estimated_hours;
  IF p_patch ? 'estimated_hours' THEN
    IF p_patch -> 'estimated_hours' = 'null'::jsonb THEN
      v_new_estimated_hours := NULL;
    ELSE
      BEGIN
        v_new_estimated_hours :=
          (p_patch ->> 'estimated_hours')::numeric;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'Estimated hours must be numeric'
            USING ERRCODE = '22023';
      END;
      IF v_new_estimated_hours < 0 OR v_new_estimated_hours > 9999.9 THEN
        RAISE EXCEPTION 'Estimated hours are outside the supported range'
          USING ERRCODE = '22023';
      END IF;
      IF v_new_estimated_hours IS DISTINCT FROM
        pg_catalog.round(v_new_estimated_hours, 1)
      THEN
        RAISE EXCEPTION 'Estimated hours support one decimal place'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  v_new_actual_hours := v_order.actual_hours;
  IF p_patch ? 'actual_hours' THEN
    IF p_patch -> 'actual_hours' = 'null'::jsonb THEN
      v_new_actual_hours := NULL;
    ELSE
      BEGIN
        v_new_actual_hours := (p_patch ->> 'actual_hours')::numeric;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'Actual hours must be numeric'
            USING ERRCODE = '22023';
      END;
      IF v_new_actual_hours < 0 OR v_new_actual_hours > 9999.9 THEN
        RAISE EXCEPTION 'Actual hours are outside the supported range'
          USING ERRCODE = '22023';
      END IF;
      IF v_new_actual_hours IS DISTINCT FROM
        pg_catalog.round(v_new_actual_hours, 1)
      THEN
        RAISE EXCEPTION 'Actual hours support one decimal place'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  v_new_travel_required := v_order.travel_required;
  IF p_patch ? 'travel_required' THEN
    IF p_patch -> 'travel_required' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Travel required must be a boolean'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_new_travel_required :=
        (p_patch ->> 'travel_required')::boolean;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Travel required must be a boolean'
          USING ERRCODE = '22023';
    END;
  END IF;

  v_new_travel_from := CASE
    WHEN p_patch ? 'travel_from' THEN p_patch ->> 'travel_from'
    ELSE v_order.travel_from
  END;
  IF v_new_travel_from IS NOT NULL
    AND pg_catalog.char_length(v_new_travel_from) > 200
  THEN
    RAISE EXCEPTION 'Travel origin is too long'
      USING ERRCODE = '22023';
  END IF;

  v_new_completion_report := CASE
    WHEN p_patch ? 'completion_report'
      THEN p_patch ->> 'completion_report'
    ELSE v_order.completion_report
  END;
  IF v_new_completion_report IS NOT NULL
    AND pg_catalog.char_length(v_new_completion_report) > 20000
  THEN
    RAISE EXCEPTION 'Completion report is too long'
      USING ERRCODE = '22023';
  END IF;

  v_new_completion_notes := CASE
    WHEN p_patch ? 'completion_notes'
      THEN p_patch ->> 'completion_notes'
    ELSE v_order.completion_notes
  END;
  IF v_new_completion_notes IS NOT NULL
    AND pg_catalog.char_length(v_new_completion_notes) > 2000
  THEN
    RAISE EXCEPTION 'Completion notes are too long'
      USING ERRCODE = '22023';
  END IF;

  IF v_new_status = 'completed'
    AND v_order.status IS DISTINCT FROM 'completed'
  THEN
    v_new_completed_by := p_actor_id;
    v_new_completed_at := v_occurred_at;
  ELSIF v_new_status <> 'completed' AND v_order.status = 'completed' THEN
    v_new_completed_by := NULL;
    v_new_completed_at := NULL;
  ELSE
    v_new_completed_by := v_order.completed_by;
    v_new_completed_at := v_order.completed_at;
  END IF;

  IF p_engineers IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_engineers)
      AS supplied(engineer_id uuid, role text)
    GROUP BY supplied.engineer_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate engineer assignment'
      USING ERRCODE = '22023';
  END IF;

  IF p_engineers IS NOT NULL THEN
    FOR v_engineer IN
      SELECT
        supplied.engineer_id,
        pg_catalog.coalesce(supplied.role, 'engineer') AS role
      FROM pg_catalog.jsonb_to_recordset(p_engineers)
        AS supplied(engineer_id uuid, role text)
      ORDER BY supplied.engineer_id
    LOOP
      IF v_engineer.engineer_id IS NULL
        OR v_engineer.role NOT IN ('lead', 'engineer', 'assistant')
      THEN
        RAISE EXCEPTION 'Engineer assignment is invalid'
          USING ERRCODE = '22023';
      END IF;

      PERFORM 1
      FROM public.users AS u
      WHERE u.id = v_engineer.engineer_id
        AND u.status = 'active'
        AND u.role = 'engineer'
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Every assignee must be an active engineer'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    SELECT pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'engineer_id', fse.engineer_id,
          'role', fse.role
        )
        ORDER BY fse.engineer_id
      ),
      '[]'::jsonb
    )
    INTO v_old_engineers
    FROM public.field_service_engineers AS fse
    WHERE fse.order_id = p_order_id;

    SELECT pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'engineer_id', supplied.engineer_id,
          'role', pg_catalog.coalesce(supplied.role, 'engineer')
        )
        ORDER BY supplied.engineer_id
      ),
      '[]'::jsonb
    )
    INTO v_new_engineers
    FROM pg_catalog.jsonb_to_recordset(p_engineers)
      AS supplied(engineer_id uuid, role text);
  END IF;

  UPDATE public.field_service_orders AS fso
  SET
    status = v_new_status,
    title = v_new_title,
    description = v_new_description,
    service_type = v_new_service_type,
    priority = v_new_priority,
    scheduled_date = v_new_scheduled_date,
    scheduled_end_date = v_new_scheduled_end_date,
    estimated_hours = v_new_estimated_hours,
    actual_hours = v_new_actual_hours,
    travel_required = v_new_travel_required,
    travel_from = v_new_travel_from,
    completion_report = v_new_completion_report,
    completion_notes = v_new_completion_notes,
    completed_by = v_new_completed_by,
    completed_at = v_new_completed_at,
    updated_at = v_occurred_at
  WHERE fso.id = p_order_id
  RETURNING fso.* INTO v_after;

  IF p_engineers IS NOT NULL
    AND v_old_engineers IS DISTINCT FROM v_new_engineers
  THEN
    DELETE FROM public.field_service_engineers AS fse
    WHERE fse.order_id = p_order_id;

    INSERT INTO public.field_service_engineers (
      order_id,
      engineer_id,
      role
    )
    SELECT
      p_order_id,
      supplied.engineer_id,
      pg_catalog.coalesce(supplied.role, 'engineer')
    FROM pg_catalog.jsonb_to_recordset(p_engineers)
      AS supplied(engineer_id uuid, role text)
    ORDER BY supplied.engineer_id;
  END IF;

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
    'field_service_order',
    p_order_id,
    'updated',
    changed.field_name,
    changed.old_value,
    changed.new_value,
    pg_catalog.jsonb_build_object(
      'order_no', v_order.order_no,
      'command', 'apply_field_service_order_patch'
    )
  FROM (
    VALUES
      ('status', v_order.status::text, v_after.status::text),
      ('title', v_order.title, v_after.title),
      ('description', v_order.description, v_after.description),
      (
        'service_type',
        v_order.service_type::text,
        v_after.service_type::text
      ),
      ('priority', v_order.priority::text, v_after.priority::text),
      (
        'scheduled_date',
        v_order.scheduled_date::text,
        v_after.scheduled_date::text
      ),
      (
        'scheduled_end_date',
        v_order.scheduled_end_date::text,
        v_after.scheduled_end_date::text
      ),
      (
        'estimated_hours',
        v_order.estimated_hours::text,
        v_after.estimated_hours::text
      ),
      (
        'actual_hours',
        v_order.actual_hours::text,
        v_after.actual_hours::text
      ),
      (
        'travel_required',
        v_order.travel_required::text,
        v_after.travel_required::text
      ),
      ('travel_from', v_order.travel_from, v_after.travel_from),
      (
        'completion_report',
        v_order.completion_report,
        v_after.completion_report
      ),
      (
        'completion_notes',
        v_order.completion_notes,
        v_after.completion_notes
      ),
      (
        'completed_by',
        v_order.completed_by::text,
        v_after.completed_by::text
      ),
      (
        'completed_at',
        v_order.completed_at::text,
        v_after.completed_at::text
      )
  ) AS changed(field_name, old_value, new_value)
  WHERE changed.old_value IS DISTINCT FROM changed.new_value;

  IF p_engineers IS NOT NULL
    AND v_old_engineers IS DISTINCT FROM v_new_engineers
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
      'field_service_order',
      p_order_id,
      'updated',
      'engineers',
      v_old_engineers::text,
      v_new_engineers::text,
      pg_catalog.jsonb_build_object(
        'order_no', v_order.order_no,
        'command', 'apply_field_service_order_patch'
      )
    );
  END IF;

  RETURN p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_field_service_order_atomic(
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_field_service_order_atomic(
  uuid,
  jsonb,
  jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.apply_field_service_order_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_field_service_order_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) TO service_role;

COMMENT ON FUNCTION public.create_field_service_order_atomic(
  uuid,
  jsonb,
  jsonb
) IS
  'Atomically creates a field-service order, validated engineer assignments,
   and its audit row with tenant containment and DATE-only validation.';

COMMENT ON FUNCTION public.apply_field_service_order_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) IS
  'Atomically updates a row-locked field-service order and optionally replaces
   its validated engineer assignment set with transaction-local audit rows.';

COMMIT;
