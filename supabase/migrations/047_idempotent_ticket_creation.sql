-- Migration 047 — Replay-safe ticket creation
--
-- Migration 034 makes ticket creation atomic, but a client can still lose the
-- HTTP/Slack response after commit and replay the command. The second request
-- then creates a second ticket because the command has no stable request key.
--
-- Add a service-only request ledger and a new wrapper around migration 034's
-- command. The wrapper serializes each source/key pair, returns the original
-- ticket for an exact replay, rejects key reuse with different business input,
-- and returns a durable receipt directly from the transaction. The migration-
-- 034 function remains available so migration-first deployment is safe.

BEGIN;

CREATE TABLE public.ticket_creation_requests (
  source text NOT NULL
    CHECK (source IN ('slack', 'web', 'email', 'internal')),
  idempotency_key text NOT NULL
    CHECK (
      pg_catalog.length(idempotency_key) BETWEEN 16 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    ),
  ticket_id uuid NOT NULL UNIQUE
    REFERENCES public.tickets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (source, idempotency_key)
);

ALTER TABLE public.ticket_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_creation_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ticket_creation_requests
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_ticket_idempotent_atomic(
  p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed_keys constant text[] := ARRAY[
    'customer_id',
    'site_id',
    'source',
    'title',
    'description',
    'request_type',
    'severity',
    'impact',
    'asset_id',
    'area',
    'created_by',
    'submitter_name',
    'submitter_email',
    'submitter_phone',
    'secure_token',
    'sla_policy_id',
    'first_response_due_at',
    'resolve_due_at',
    'idempotency_key'
  ];
  v_idempotency_key text;
  v_source text;
  v_customer_id uuid;
  v_site_id uuid;
  v_created_by uuid;
  v_ticket_id uuid;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
  THEN
    RAISE EXCEPTION 'Ticket input must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE NOT supplied.key = ANY (v_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'Ticket input contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := pg_catalog.btrim(p_input ->> 'idempotency_key');
  v_source := p_input ->> 'source';

  IF v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
  THEN
    RAISE EXCEPTION 'A valid ticket idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_source IS NULL
    OR v_source NOT IN ('slack', 'web', 'email', 'internal')
  THEN
    RAISE EXCEPTION 'Unsupported ticket source'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_customer_id := (p_input ->> 'customer_id')::uuid;
    v_site_id := (p_input ->> 'site_id')::uuid;
    v_created_by := CASE
      WHEN p_input -> 'created_by' IS NULL
        OR p_input -> 'created_by' = 'null'::jsonb
        THEN NULL
      ELSE (p_input ->> 'created_by')::uuid
    END;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Ticket input contains an invalid identifier'
        USING ERRCODE = '22023';
  END;

  -- A transaction-scoped lock avoids a visible half-written reservation row
  -- and makes concurrent deliveries of the same Slack/HTTP request wait for
  -- one authoritative outcome. Hash collisions only serialize unrelated work.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_source || ':' || v_idempotency_key, 0)
  );

  SELECT request.ticket_id
  INTO v_ticket_id
  FROM public.ticket_creation_requests AS request
  WHERE request.source = v_source
    AND request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF FOUND THEN
    SELECT existing.*
    INTO v_ticket
    FROM public.tickets AS existing
    WHERE existing.id = v_ticket_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ticket idempotency record is inconsistent'
        USING ERRCODE = '55000';
    END IF;

    -- Volatile creation fields (secure token and SLA timestamps/policy) are
    -- intentionally excluded. A retry must return the first committed values,
    -- even if policy time moved while the client was waiting for a response.
    IF v_ticket.customer_id IS DISTINCT FROM v_customer_id
      OR v_ticket.site_id IS DISTINCT FROM v_site_id
      OR v_ticket.source IS DISTINCT FROM v_source
      OR v_ticket.title IS DISTINCT FROM
        pg_catalog.btrim(p_input ->> 'title')
      OR v_ticket.description IS DISTINCT FROM
        pg_catalog.btrim(p_input ->> 'description')
      OR v_ticket.request_type IS DISTINCT FROM
        (p_input ->> 'request_type')
      OR v_ticket.severity IS DISTINCT FROM (p_input ->> 'severity')
      OR v_ticket.impact IS DISTINCT FROM
        NULLIF(p_input ->> 'impact', '')
      OR v_ticket.asset_id IS DISTINCT FROM
        NULLIF(pg_catalog.btrim(p_input ->> 'asset_id'), '')
      OR v_ticket.area IS DISTINCT FROM
        NULLIF(pg_catalog.btrim(p_input ->> 'area'), '')
      OR v_ticket.created_by IS DISTINCT FROM v_created_by
      OR v_ticket.submitter_name IS DISTINCT FROM
        NULLIF(pg_catalog.btrim(p_input ->> 'submitter_name'), '')
      OR v_ticket.submitter_email IS DISTINCT FROM
        NULLIF(pg_catalog.btrim(p_input ->> 'submitter_email'), '')
      OR v_ticket.submitter_phone IS DISTINCT FROM
        NULLIF(pg_catalog.btrim(p_input ->> 'submitter_phone'), '')
    THEN
      RAISE EXCEPTION
        'Ticket idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_ticket_id := public.create_ticket_atomic(
      p_input - 'idempotency_key'
    );

    INSERT INTO public.ticket_creation_requests (
      source,
      idempotency_key,
      ticket_id
    )
    VALUES (
      v_source,
      v_idempotency_key,
      v_ticket_id
    );

    SELECT created.*
    INTO v_ticket
    FROM public.tickets AS created
    WHERE created.id = v_ticket_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Created ticket receipt is unavailable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_ticket.id,
    'ticket_no', v_ticket.ticket_no,
    'secure_token', v_ticket.secure_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_ticket_idempotent_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ticket_idempotent_atomic(jsonb)
  TO service_role;

COMMENT ON TABLE public.ticket_creation_requests IS
  'Service-only replay ledger for atomic ticket creation request keys.';

COMMENT ON FUNCTION public.create_ticket_idempotent_atomic(jsonb) IS
  'Serializes ticket creation by source/request key, returns the first durable
   receipt for an exact replay, and rejects reuse with different input.';

COMMIT;
