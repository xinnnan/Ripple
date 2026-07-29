-- Migration 028 — Atomic spare-part request updates
--
-- Closes INT-005 and the update half of INT-004:
--   * a fulfillment item must belong to the request being patched;
--   * fulfilled quantity must remain between zero and ordered quantity;
--   * header changes, item changes, and audit rows commit atomically;
--   * the request and item rows are locked before mutation;
--   * only the service role can invoke the command, and the claimed actor is
--     independently verified as an active internal user.
--
-- The NOT VALID table constraint protects all new/changed rows without
-- pretending that historical data has already been audited. Validate it in a
-- later migration after checking existing rows.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'spare_part_request_items_fulfilled_bounds'
      AND conrelid = 'public.spare_part_request_items'::pg_catalog.regclass
  ) THEN
    ALTER TABLE public.spare_part_request_items
      ADD CONSTRAINT spare_part_request_items_fulfilled_bounds
      CHECK (
        fulfilled_quantity >= 0
        AND fulfilled_quantity <= quantity
      )
      NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_spare_part_request_patch(
  p_request_id uuid,
  p_actor_id uuid,
  p_patch jsonb,
  p_items jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.spare_part_requests%ROWTYPE;
  v_after public.spare_part_requests%ROWTYPE;
  v_actor_email text;
  v_actor_role text;
  v_occurred_at timestamptz;
  v_new_status text;
  v_new_priority text;
  v_item record;
  v_old_fulfilled integer;
  v_ordered_quantity integer;
BEGIN
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Spare part request patch must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_items) <> 'array'
  THEN
    RAISE EXCEPTION 'Spare part request items must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch = '{}'::jsonb
    AND (
      p_items IS NULL
      OR pg_catalog.jsonb_array_length(p_items) = 0
    )
  THEN
    RAISE EXCEPTION 'Spare part request update must contain a change'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN (
      'status',
      'notes',
      'priority',
      'shipping_carrier',
      'shipping_tracking'
    )
  ) THEN
    RAISE EXCEPTION 'Spare part request patch contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.role
  INTO v_actor_email, v_actor_role
  FROM public.users AS u
  WHERE u.id = p_actor_id
    AND u.status = 'active'
    AND u.role IN ('admin', 'engineer');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active internal account required'
      USING ERRCODE = '42501';
  END IF;

  SELECT spr.*
  INTO v_request
  FROM public.spare_part_requests AS spr
  WHERE spr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spare part request not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_occurred_at := pg_catalog.clock_timestamp();
  v_new_status := CASE
    WHEN p_patch ? 'status' THEN p_patch ->> 'status'
    ELSE v_request.status
  END;
  IF v_new_status IS NULL OR v_new_status NOT IN (
    'requested',
    'approved',
    'shipped',
    'delivered',
    'cancelled'
  ) THEN
    RAISE EXCEPTION 'Unsupported spare part request status'
      USING ERRCODE = '22023';
  END IF;

  v_new_priority := CASE
    WHEN p_patch ? 'priority' THEN p_patch ->> 'priority'
    ELSE v_request.priority
  END;
  IF v_new_priority IS NULL OR v_new_priority NOT IN (
    'low',
    'normal',
    'high',
    'urgent'
  ) THEN
    RAISE EXCEPTION 'Unsupported spare part request priority'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items)
      AS supplied(id uuid, fulfilled_quantity integer)
    GROUP BY supplied.id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate spare part request item'
      USING ERRCODE = '22023';
  END IF;

  -- Lock in a stable order so concurrent multi-item updates cannot acquire
  -- the same item set in opposite orders.
  IF p_items IS NOT NULL THEN
    FOR v_item IN
      SELECT supplied.id, supplied.fulfilled_quantity
      FROM pg_catalog.jsonb_to_recordset(p_items)
        AS supplied(id uuid, fulfilled_quantity integer)
      ORDER BY supplied.id
    LOOP
      IF v_item.id IS NULL OR v_item.fulfilled_quantity IS NULL THEN
        RAISE EXCEPTION 'Each fulfillment item requires id and quantity'
          USING ERRCODE = '22023';
      END IF;

      SELECT item.fulfilled_quantity, item.quantity
      INTO v_old_fulfilled, v_ordered_quantity
      FROM public.spare_part_request_items AS item
      WHERE item.id = v_item.id
        AND item.request_id = p_request_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item does not belong to spare part request'
          USING ERRCODE = '22023';
      END IF;

      IF v_item.fulfilled_quantity < 0
        OR v_item.fulfilled_quantity > v_ordered_quantity
      THEN
        RAISE EXCEPTION 'Fulfilled quantity must be within ordered quantity'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.spare_part_requests AS spr
  SET
    status = v_new_status,
    notes = CASE
      WHEN p_patch ? 'notes' THEN p_patch ->> 'notes'
      ELSE v_request.notes
    END,
    priority = v_new_priority,
    shipping_carrier = CASE
      WHEN p_patch ? 'shipping_carrier' THEN p_patch ->> 'shipping_carrier'
      ELSE v_request.shipping_carrier
    END,
    shipping_tracking = CASE
      WHEN p_patch ? 'shipping_tracking' THEN p_patch ->> 'shipping_tracking'
      ELSE v_request.shipping_tracking
    END,
    approved_by = CASE
      WHEN v_new_status = 'approved'
        AND v_request.status IS DISTINCT FROM 'approved'
        THEN p_actor_id
      ELSE v_request.approved_by
    END,
    shipped_at = CASE
      WHEN v_new_status = 'shipped'
        AND v_request.status IS DISTINCT FROM 'shipped'
        THEN v_occurred_at
      ELSE v_request.shipped_at
    END,
    delivered_at = CASE
      WHEN v_new_status = 'delivered'
        AND v_request.status IS DISTINCT FROM 'delivered'
        THEN v_occurred_at
      ELSE v_request.delivered_at
    END,
    updated_at = v_occurred_at
  WHERE spr.id = p_request_id
  RETURNING spr.* INTO v_after;

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
    'part_request',
    p_request_id,
    'updated',
    changed.field_name,
    changed.old_value,
    changed.new_value,
    pg_catalog.jsonb_build_object(
      'request_no', v_request.request_no,
      'command', 'apply_spare_part_request_patch'
    )
  FROM (
    VALUES
      ('status', v_request.status::text, v_after.status::text),
      ('notes', v_request.notes, v_after.notes),
      ('priority', v_request.priority::text, v_after.priority::text),
      (
        'shipping_carrier',
        v_request.shipping_carrier,
        v_after.shipping_carrier
      ),
      (
        'shipping_tracking',
        v_request.shipping_tracking,
        v_after.shipping_tracking
      ),
      (
        'approved_by',
        v_request.approved_by::text,
        v_after.approved_by::text
      ),
      ('shipped_at', v_request.shipped_at::text, v_after.shipped_at::text),
      (
        'delivered_at',
        v_request.delivered_at::text,
        v_after.delivered_at::text
      )
  ) AS changed(field_name, old_value, new_value)
  WHERE changed.old_value IS DISTINCT FROM changed.new_value;

  IF p_items IS NOT NULL THEN
    FOR v_item IN
      SELECT supplied.id, supplied.fulfilled_quantity
      FROM pg_catalog.jsonb_to_recordset(p_items)
        AS supplied(id uuid, fulfilled_quantity integer)
      ORDER BY supplied.id
    LOOP
      SELECT item.fulfilled_quantity
      INTO v_old_fulfilled
      FROM public.spare_part_request_items AS item
      WHERE item.id = v_item.id
        AND item.request_id = p_request_id;

      IF v_old_fulfilled IS DISTINCT FROM v_item.fulfilled_quantity THEN
        UPDATE public.spare_part_request_items AS item
        SET fulfilled_quantity = v_item.fulfilled_quantity
        WHERE item.id = v_item.id
          AND item.request_id = p_request_id;

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
          'part_request',
          p_request_id,
          'updated',
          'item_fulfilled_quantity',
          v_old_fulfilled::text,
          v_item.fulfilled_quantity::text,
          pg_catalog.jsonb_build_object(
            'request_no', v_request.request_no,
            'item_id', v_item.id,
            'command', 'apply_spare_part_request_patch'
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_spare_part_request_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_spare_part_request_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) TO service_role;

COMMENT ON FUNCTION public.apply_spare_part_request_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) IS
  'Atomically updates one spare-part request and its owned fulfillment items,
   enforcing active-internal attribution, parent containment, quantity bounds,
   row locking, and transaction-local audit rows.';

COMMIT;
