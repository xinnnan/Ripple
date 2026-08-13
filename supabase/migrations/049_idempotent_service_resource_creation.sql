-- Migration 049 — Replay-safe spare-part and field-service creation
--
-- Migrations 029 and 030 make each individual create command atomic, but a
-- caller that loses the HTTP response can still retry and create a duplicate
-- procurement request or service dispatch. Add service-only request ledgers
-- and wrappers that serialize one caller key, return the first resource for
-- exact retries, and reject altered key reuse. The original commands remain
-- available so this migration can be deployed before the application update.

BEGIN;

CREATE TABLE public.spare_part_request_creation_requests (
  idempotency_key text PRIMARY KEY
    CHECK (
      pg_catalog.length(idempotency_key) BETWEEN 16 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    ),
  request_id uuid NOT NULL UNIQUE
    REFERENCES public.spare_part_requests(id) ON DELETE CASCADE,
  request_snapshot jsonb NOT NULL
    CHECK (pg_catalog.jsonb_typeof(request_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.spare_part_request_creation_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_part_request_creation_requests
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.spare_part_request_creation_requests
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.spare_part_request_creation_requests
  TO service_role;

CREATE TABLE public.field_service_order_creation_requests (
  idempotency_key text PRIMARY KEY
    CHECK (
      pg_catalog.length(idempotency_key) BETWEEN 16 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    ),
  order_id uuid NOT NULL UNIQUE
    REFERENCES public.field_service_orders(id) ON DELETE CASCADE,
  request_snapshot jsonb NOT NULL
    CHECK (pg_catalog.jsonb_typeof(request_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.field_service_order_creation_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_service_order_creation_requests
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.field_service_order_creation_requests
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.field_service_order_creation_requests
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_spare_part_request_idempotent_atomic(
  p_actor_id uuid,
  p_input jsonb,
  p_items jsonb,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_idempotency_key text;
  v_request_snapshot jsonb;
  v_existing_snapshot jsonb;
  v_request_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Spare part request actor is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
    OR p_items IS NULL
    OR pg_catalog.jsonb_typeof(p_items) <> 'array'
  THEN
    RAISE EXCEPTION 'Spare part request input and items are invalid'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := pg_catalog.btrim(p_idempotency_key);
  IF v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
  THEN
    RAISE EXCEPTION 'A valid spare part request idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  v_request_snapshot := pg_catalog.jsonb_build_object(
    'actor_id', p_actor_id,
    'input', p_input,
    'items', p_items
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'spare-part-request-create:' || v_idempotency_key,
      0
    )
  );

  SELECT request.request_id, request.request_snapshot
  INTO v_request_id, v_existing_snapshot
  FROM public.spare_part_request_creation_requests AS request
  WHERE request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF FOUND THEN
    IF v_existing_snapshot IS DISTINCT FROM v_request_snapshot THEN
      RAISE EXCEPTION
        'Spare part request idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.spare_part_requests AS existing
      WHERE existing.id = v_request_id
    ) THEN
      RAISE EXCEPTION 'Spare part request idempotency record is inconsistent'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    v_request_id := public.create_spare_part_request_atomic(
      p_actor_id,
      p_input,
      p_items
    );

    INSERT INTO public.spare_part_request_creation_requests (
      idempotency_key,
      request_id,
      request_snapshot
    )
    VALUES (
      v_idempotency_key,
      v_request_id,
      v_request_snapshot
    );
  END IF;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_field_service_order_idempotent_atomic(
  p_actor_id uuid,
  p_input jsonb,
  p_engineers jsonb,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_idempotency_key text;
  v_request_snapshot jsonb;
  v_existing_snapshot jsonb;
  v_order_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Field service order actor is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
    OR p_engineers IS NULL
    OR pg_catalog.jsonb_typeof(p_engineers) <> 'array'
  THEN
    RAISE EXCEPTION 'Field service order input and engineers are invalid'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := pg_catalog.btrim(p_idempotency_key);
  IF v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
  THEN
    RAISE EXCEPTION 'A valid field service order idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  v_request_snapshot := pg_catalog.jsonb_build_object(
    'actor_id', p_actor_id,
    'input', p_input,
    'engineers', p_engineers
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'field-service-order-create:' || v_idempotency_key,
      0
    )
  );

  SELECT request.order_id, request.request_snapshot
  INTO v_order_id, v_existing_snapshot
  FROM public.field_service_order_creation_requests AS request
  WHERE request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF FOUND THEN
    IF v_existing_snapshot IS DISTINCT FROM v_request_snapshot THEN
      RAISE EXCEPTION
        'Field service order idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.field_service_orders AS existing
      WHERE existing.id = v_order_id
    ) THEN
      RAISE EXCEPTION 'Field service order idempotency record is inconsistent'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    v_order_id := public.create_field_service_order_atomic(
      p_actor_id,
      p_input,
      p_engineers
    );

    INSERT INTO public.field_service_order_creation_requests (
      idempotency_key,
      order_id,
      request_snapshot
    )
    VALUES (
      v_idempotency_key,
      v_order_id,
      v_request_snapshot
    );
  END IF;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_spare_part_request_idempotent_atomic(
  uuid,
  jsonb,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_spare_part_request_idempotent_atomic(
  uuid,
  jsonb,
  jsonb,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.create_field_service_order_idempotent_atomic(
  uuid,
  jsonb,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_field_service_order_idempotent_atomic(
  uuid,
  jsonb,
  jsonb,
  text
) TO service_role;

COMMENT ON TABLE public.spare_part_request_creation_requests IS
  'Service-only replay ledger for atomic spare-part request creation keys.';
COMMENT ON TABLE public.field_service_order_creation_requests IS
  'Service-only replay ledger for atomic field-service order creation keys.';

COMMENT ON FUNCTION public.create_spare_part_request_idempotent_atomic(
  uuid,
  jsonb,
  jsonb,
  text
) IS
  'Serializes spare-part request creation by request key, returns the first
   resource for an exact replay, and rejects altered key reuse.';
COMMENT ON FUNCTION public.create_field_service_order_idempotent_atomic(
  uuid,
  jsonb,
  jsonb,
  text
) IS
  'Serializes field-service order creation by request key, returns the first
   resource for an exact replay, and rejects altered key reuse.';

COMMIT;
