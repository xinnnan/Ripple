-- Migration 029 — Atomic spare-part request creation
--
-- Closes the create half of INT-004:
--   * the request header, every line item, and its audit row commit together;
--   * active actor, tenant lifecycle, ticket/site containment, and active-part
--     checks are enforced in the database command;
--   * total_cost is derived from validated, normalized item prices;
--   * request numbers come from the concurrency-safe sequence introduced by
--     migration 020.
--
-- Also fixes an execution-privilege oversight in migration 020. PostgreSQL
-- grants EXECUTE on new functions to PUBLIC by default, so merely granting the
-- service role did not make the number-minting functions service-role-only.

BEGIN;

REVOKE ALL ON FUNCTION public.next_ticket_no()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_request_no()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_order_no()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_spr_number()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_fso_number()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.next_ticket_no() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_request_no() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_order_no() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_spr_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_fso_number() TO service_role;

-- Migration 021 used `public` as the search path. The function bodies already
-- qualify their sequences and built-in pg_catalog remains implicitly visible,
-- so an empty path removes an unnecessary object-shadowing surface.
ALTER FUNCTION public.next_ticket_no() SET search_path = '';
ALTER FUNCTION public.next_request_no() SET search_path = '';
ALTER FUNCTION public.next_order_no() SET search_path = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'spare_part_request_items_unit_price_bounds'
      AND conrelid =
        'public.spare_part_request_items'::pg_catalog.regclass
  ) THEN
    ALTER TABLE public.spare_part_request_items
      ADD CONSTRAINT spare_part_request_items_unit_price_bounds
      CHECK (
        unit_price IS NULL
        OR (
          unit_price >= 0
          AND unit_price <= 99999999.99
        )
      )
      NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_spare_part_request_atomic(
  p_actor_id uuid,
  p_input jsonb,
  p_items jsonb
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
  v_priority text;
  v_notes text;
  v_request_id uuid;
  v_request_no text;
  v_item record;
  v_normalized_unit_price numeric;
  v_total_cost numeric := 0;
  v_stored_total_cost numeric;
  v_item_count integer;
BEGIN
  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
  THEN
    RAISE EXCEPTION 'Spare part request input must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL
    OR pg_catalog.jsonb_typeof(p_items) <> 'array'
  THEN
    RAISE EXCEPTION 'Spare part request items must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  v_item_count := pg_catalog.jsonb_array_length(p_items);
  IF v_item_count < 1 OR v_item_count > 100 THEN
    RAISE EXCEPTION 'Spare part request requires between 1 and 100 items'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE supplied.key NOT IN (
      'ticket_id',
      'site_id',
      'priority',
      'notes'
    )
  ) THEN
    RAISE EXCEPTION 'Spare part request input contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_items) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Every spare part request item must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_items) AS item(value)
    CROSS JOIN LATERAL
      pg_catalog.jsonb_object_keys(item.value) AS supplied(key)
    WHERE supplied.key NOT IN (
      'spare_part_id',
      'quantity',
      'unit_price',
      'notes'
    )
  ) THEN
    RAISE EXCEPTION 'Spare part request item contains an unsupported field'
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

  v_priority := pg_catalog.coalesce(p_input ->> 'priority', 'normal');
  IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Unsupported spare part request priority'
      USING ERRCODE = '22023';
  END IF;

  IF p_input ? 'notes' AND p_input -> 'notes' <> 'null'::jsonb THEN
    v_notes := p_input ->> 'notes';
    IF pg_catalog.char_length(v_notes) > 5000 THEN
      RAISE EXCEPTION 'Spare part request notes are too long'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items)
      AS supplied(
        spare_part_id uuid,
        quantity integer,
        unit_price numeric,
        notes text
      )
    GROUP BY supplied.spare_part_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate spare part request item'
      USING ERRCODE = '22023';
  END IF;

  -- Validate and lock catalog rows in stable UUID order so concurrent
  -- catalog changes cannot invalidate the item set mid-command.
  FOR v_item IN
    SELECT
      supplied.spare_part_id,
      supplied.quantity,
      supplied.unit_price,
      supplied.notes
    FROM pg_catalog.jsonb_to_recordset(p_items)
      AS supplied(
        spare_part_id uuid,
        quantity integer,
        unit_price numeric,
        notes text
      )
    ORDER BY supplied.spare_part_id
  LOOP
    IF v_item.spare_part_id IS NULL OR v_item.quantity IS NULL THEN
      RAISE EXCEPTION 'Each request item requires a part and quantity'
        USING ERRCODE = '22023';
    END IF;

    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Request item quantity must be positive'
        USING ERRCODE = '22023';
    END IF;

    IF v_item.notes IS NOT NULL
      AND pg_catalog.char_length(v_item.notes) > 500
    THEN
      RAISE EXCEPTION 'Request item notes are too long'
        USING ERRCODE = '22023';
    END IF;

    IF v_item.unit_price IS NOT NULL THEN
      IF v_item.unit_price < 0 THEN
        RAISE EXCEPTION 'Request item price must be nonnegative'
          USING ERRCODE = '22023';
      END IF;

      v_normalized_unit_price :=
        pg_catalog.round(v_item.unit_price, 2);
      IF v_normalized_unit_price > 99999999.99 THEN
        RAISE EXCEPTION 'Request item price exceeds supported precision'
          USING ERRCODE = '22003';
      END IF;

      v_total_cost :=
        v_total_cost + (v_item.quantity * v_normalized_unit_price);
      IF v_total_cost > 99999999.99 THEN
        RAISE EXCEPTION 'Spare part request total exceeds supported precision'
          USING ERRCODE = '22003';
      END IF;
    END IF;

    PERFORM 1
    FROM public.spare_parts AS part
    WHERE part.id = v_item.spare_part_id
      AND part.is_active
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Every requested part must be active'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_stored_total_cost := CASE
    WHEN v_total_cost = 0 THEN NULL
    ELSE v_total_cost
  END;
  v_request_no := public.next_request_no();

  INSERT INTO public.spare_part_requests (
    request_no,
    ticket_id,
    site_id,
    status,
    priority,
    notes,
    requested_by,
    total_cost
  )
  VALUES (
    v_request_no,
    v_ticket_id,
    v_site_id,
    'requested',
    v_priority,
    v_notes,
    p_actor_id,
    v_stored_total_cost
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.spare_part_request_items (
    request_id,
    spare_part_id,
    quantity,
    fulfilled_quantity,
    unit_price,
    notes
  )
  SELECT
    v_request_id,
    supplied.spare_part_id,
    supplied.quantity,
    0,
    CASE
      WHEN supplied.unit_price IS NULL THEN NULL
      ELSE pg_catalog.round(supplied.unit_price, 2)
    END,
    supplied.notes
  FROM pg_catalog.jsonb_to_recordset(p_items)
    AS supplied(
      spare_part_id uuid,
      quantity integer,
      unit_price numeric,
      notes text
    )
  ORDER BY supplied.spare_part_id;

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
    'part_request',
    v_request_id,
    'created',
    v_request_no,
    pg_catalog.jsonb_build_object(
      'site_id', v_site_id,
      'ticket_id', v_ticket_id,
      'priority', v_priority,
      'item_count', v_item_count,
      'total_cost', v_stored_total_cost,
      'command', 'create_spare_part_request_atomic'
    )
  );

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_spare_part_request_atomic(
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_spare_part_request_atomic(
  uuid,
  jsonb,
  jsonb
) TO service_role;

COMMENT ON FUNCTION public.create_spare_part_request_atomic(
  uuid,
  jsonb,
  jsonb
) IS
  'Atomically creates a spare-part request, its validated line items, and its
   audit row with active-internal attribution and tenant containment.';

COMMIT;
