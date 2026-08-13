-- Migration 051 — Replay-safe Ripple Assist provider boundary
--
-- Ripple Assist previously called the paid provider and then inserted an
-- ai_suggestions row directly. A lost HTTP/Slack response or concurrent replay
-- could therefore spend twice, while a provider success followed by a lost
-- database acknowledgement had no durable reconciliation state.
--
-- Add a service-only request ledger and four narrow commands:
--   1. reserve one source/request key and return a prior completed receipt;
--   2. cancel only a reservation that has not crossed the provider boundary;
--   3. checkpoint the provider attempt before network I/O; and
--   4. atomically persist the suggestion and complete the request receipt.
--
-- A request whose provider checkpoint exists but whose suggestion receipt does
-- not is intentionally fail-closed. Automatic replay cannot prove whether the
-- provider already charged or completed the request.

BEGIN;

CREATE TABLE public.ai_suggestion_requests (
  source text NOT NULL
    CHECK (source IN ('web', 'slack')),
  idempotency_key text NOT NULL
    CHECK (
      pg_catalog.length(idempotency_key) BETWEEN 16 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    ),
  ticket_id uuid NOT NULL
    REFERENCES public.tickets(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  suggestion_type text NOT NULL
    CHECK (suggestion_type IN (
      'summary',
      'troubleshooting',
      'similar_tickets',
      'customer_reply_draft',
      'escalation_summary',
      'closure_summary',
      'log_analysis'
    )),
  provider_attempted_at timestamptz,
  suggestion_id uuid UNIQUE
    REFERENCES public.ai_suggestions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (source, idempotency_key),
  CONSTRAINT ai_suggestion_requests_completion_shape CHECK (
    (suggestion_id IS NULL AND completed_at IS NULL)
    OR (suggestion_id IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT ai_suggestion_requests_provider_time CHECK (
    provider_attempted_at IS NULL OR provider_attempted_at >= created_at
  ),
  CONSTRAINT ai_suggestion_requests_completion_time CHECK (
    completed_at IS NULL OR completed_at >= created_at
  )
);

ALTER TABLE public.ai_suggestion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestion_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_suggestion_requests
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_ai_suggestion_request(
  p_source text,
  p_idempotency_key text,
  p_ticket_id uuid,
  p_actor_id uuid,
  p_suggestion_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text := pg_catalog.btrim(p_source);
  v_idempotency_key text := pg_catalog.btrim(p_idempotency_key);
  v_request public.ai_suggestion_requests%ROWTYPE;
  v_suggestion public.ai_suggestions%ROWTYPE;
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('web', 'slack') THEN
    RAISE EXCEPTION 'Unsupported AI suggestion source'
      USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
  THEN
    RAISE EXCEPTION 'A valid AI suggestion idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_ticket_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'AI suggestion ticket and actor are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_suggestion_type IS NULL OR p_suggestion_type NOT IN (
    'summary',
    'troubleshooting',
    'similar_tickets',
    'customer_reply_draft',
    'escalation_summary',
    'closure_summary',
    'log_analysis'
  ) THEN
    RAISE EXCEPTION 'Unsupported AI suggestion type'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users AS actor
    WHERE actor.id = p_actor_id
      AND actor.status = 'active'
      AND actor.role IN ('admin', 'engineer')
  ) THEN
    RAISE EXCEPTION 'AI suggestion actor is not an active internal user'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tickets AS ticket
    WHERE ticket.id = p_ticket_id
  ) THEN
    RAISE EXCEPTION 'AI suggestion ticket is unavailable'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai-suggestion:' || v_source || ':' || v_idempotency_key,
      0
    )
  );

  SELECT request.*
  INTO v_request
  FROM public.ai_suggestion_requests AS request
  WHERE request.source = v_source
    AND request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF FOUND THEN
    IF v_request.ticket_id IS DISTINCT FROM p_ticket_id
      OR v_request.actor_id IS DISTINCT FROM p_actor_id
      OR v_request.suggestion_type IS DISTINCT FROM p_suggestion_type
    THEN
      RAISE EXCEPTION
        'AI suggestion idempotency key was already used for different input'
        USING ERRCODE = '22023';
    END IF;

    IF v_request.suggestion_id IS NOT NULL THEN
      SELECT suggestion.*
      INTO v_suggestion
      FROM public.ai_suggestions AS suggestion
      WHERE suggestion.id = v_request.suggestion_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'AI suggestion request receipt is inconsistent'
          USING ERRCODE = '55000';
      END IF;

      RETURN pg_catalog.jsonb_build_object(
        'state', 'completed',
        'id', v_suggestion.id,
        'output_text', v_suggestion.output_text,
        'confidence_level', v_suggestion.confidence_level,
        'suggestion_type', v_suggestion.suggestion_type,
        'model_name', v_suggestion.model_name
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'state', CASE
        WHEN v_request.provider_attempted_at IS NULL THEN 'in_progress'
        ELSE 'provider_attempted'
      END,
      'provider_attempted_at', v_request.provider_attempted_at
    );
  END IF;

  INSERT INTO public.ai_suggestion_requests (
    source,
    idempotency_key,
    ticket_id,
    actor_id,
    suggestion_type
  )
  VALUES (
    v_source,
    v_idempotency_key,
    p_ticket_id,
    p_actor_id,
    p_suggestion_type
  );

  RETURN pg_catalog.jsonb_build_object('state', 'reserved');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ai_suggestion_request(
  p_source text,
  p_idempotency_key text,
  p_ticket_id uuid,
  p_actor_id uuid,
  p_suggestion_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text := pg_catalog.btrim(p_source);
  v_idempotency_key text := pg_catalog.btrim(p_idempotency_key);
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('web', 'slack')
    OR v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    OR p_ticket_id IS NULL
    OR p_actor_id IS NULL
    OR p_suggestion_type IS NULL
  THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai-suggestion:' || v_source || ':' || v_idempotency_key,
      0
    )
  );

  DELETE FROM public.ai_suggestion_requests AS request
  WHERE request.source = v_source
    AND request.idempotency_key = v_idempotency_key
    AND request.ticket_id = p_ticket_id
    AND request.actor_id = p_actor_id
    AND request.suggestion_type = p_suggestion_type
    AND request.provider_attempted_at IS NULL
    AND request.suggestion_id IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkpoint_ai_suggestion_provider_attempt(
  p_source text,
  p_idempotency_key text,
  p_ticket_id uuid,
  p_actor_id uuid,
  p_suggestion_type text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text := pg_catalog.btrim(p_source);
  v_idempotency_key text := pg_catalog.btrim(p_idempotency_key);
  v_request public.ai_suggestion_requests%ROWTYPE;
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('web', 'slack')
    OR v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    OR p_ticket_id IS NULL
    OR p_actor_id IS NULL
    OR p_suggestion_type IS NULL
  THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai-suggestion:' || v_source || ':' || v_idempotency_key,
      0
    )
  );

  SELECT request.*
  INTO v_request
  FROM public.ai_suggestion_requests AS request
  WHERE request.source = v_source
    AND request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF NOT FOUND
    OR v_request.ticket_id IS DISTINCT FROM p_ticket_id
    OR v_request.actor_id IS DISTINCT FROM p_actor_id
    OR v_request.suggestion_type IS DISTINCT FROM p_suggestion_type
    OR v_request.suggestion_id IS NOT NULL
  THEN
    RETURN NULL;
  END IF;

  UPDATE public.ai_suggestion_requests AS request
  SET provider_attempted_at = COALESCE(
    request.provider_attempted_at,
    pg_catalog.clock_timestamp()
  )
  WHERE request.source = v_source
    AND request.idempotency_key = v_idempotency_key
  RETURNING request.provider_attempted_at
  INTO v_request.provider_attempted_at;

  RETURN v_request.provider_attempted_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_suggestion_request_atomic(
  p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed_keys constant text[] := ARRAY[
    'source',
    'idempotency_key',
    'ticket_id',
    'actor_id',
    'suggestion_type',
    'model_name',
    'prompt_version',
    'output_text',
    'confidence_level'
  ];
  v_source text;
  v_idempotency_key text;
  v_ticket_id uuid;
  v_actor_id uuid;
  v_suggestion_type text;
  v_model_name text;
  v_prompt_version text;
  v_output_text text;
  v_confidence_level text;
  v_request public.ai_suggestion_requests%ROWTYPE;
  v_suggestion public.ai_suggestions%ROWTYPE;
BEGIN
  IF p_input IS NULL OR pg_catalog.jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'AI suggestion completion must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_input) AS supplied(key)
    WHERE NOT supplied.key = ANY (v_allowed_keys)
  ) THEN
    RAISE EXCEPTION 'AI suggestion completion contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_ticket_id := (p_input ->> 'ticket_id')::uuid;
    v_actor_id := (p_input ->> 'actor_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'AI suggestion completion has an invalid identifier'
        USING ERRCODE = '22023';
  END;

  v_source := pg_catalog.btrim(p_input ->> 'source');
  v_idempotency_key := pg_catalog.btrim(p_input ->> 'idempotency_key');
  v_suggestion_type := p_input ->> 'suggestion_type';
  v_model_name := pg_catalog.btrim(p_input ->> 'model_name');
  v_prompt_version := pg_catalog.btrim(p_input ->> 'prompt_version');
  v_output_text := p_input ->> 'output_text';
  v_confidence_level := p_input ->> 'confidence_level';

  IF v_source IS NULL OR v_source NOT IN ('web', 'slack')
    OR v_idempotency_key IS NULL
    OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 16 AND 200
    OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    OR v_ticket_id IS NULL
    OR v_actor_id IS NULL
  THEN
    RAISE EXCEPTION 'AI suggestion completion request identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_suggestion_type IS NULL OR v_suggestion_type NOT IN (
    'summary',
    'troubleshooting',
    'similar_tickets',
    'customer_reply_draft',
    'escalation_summary',
    'closure_summary',
    'log_analysis'
  ) THEN
    RAISE EXCEPTION 'Unsupported AI suggestion type'
      USING ERRCODE = '22023';
  END IF;

  IF v_model_name IS NULL
    OR pg_catalog.length(v_model_name) NOT BETWEEN 1 AND 200
    OR v_prompt_version IS NULL
    OR pg_catalog.length(v_prompt_version) NOT BETWEEN 1 AND 50
    OR v_output_text IS NULL
    OR pg_catalog.length(v_output_text) NOT BETWEEN 1 AND 20000
    OR v_confidence_level IS NULL
    OR v_confidence_level NOT IN ('high', 'medium', 'low')
  THEN
    RAISE EXCEPTION 'AI suggestion completion payload is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai-suggestion:' || v_source || ':' || v_idempotency_key,
      0
    )
  );

  SELECT request.*
  INTO v_request
  FROM public.ai_suggestion_requests AS request
  WHERE request.source = v_source
    AND request.idempotency_key = v_idempotency_key
  FOR UPDATE OF request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI suggestion request reservation is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.ticket_id IS DISTINCT FROM v_ticket_id
    OR v_request.actor_id IS DISTINCT FROM v_actor_id
    OR v_request.suggestion_type IS DISTINCT FROM v_suggestion_type
  THEN
    RAISE EXCEPTION
      'AI suggestion idempotency key was already used for different input'
      USING ERRCODE = '22023';
  END IF;

  IF v_request.suggestion_id IS NOT NULL THEN
    SELECT suggestion.*
    INTO v_suggestion
    FROM public.ai_suggestions AS suggestion
    WHERE suggestion.id = v_request.suggestion_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'AI suggestion request receipt is inconsistent'
        USING ERRCODE = '55000';
    END IF;

    IF v_suggestion.ticket_id IS DISTINCT FROM v_ticket_id
      OR v_suggestion.created_by IS DISTINCT FROM v_actor_id
      OR v_suggestion.suggestion_type IS DISTINCT FROM v_suggestion_type
      OR v_suggestion.model_name IS DISTINCT FROM v_model_name
      OR v_suggestion.prompt_version IS DISTINCT FROM v_prompt_version
      OR v_suggestion.output_text IS DISTINCT FROM v_output_text
      OR v_suggestion.confidence_level IS DISTINCT FROM v_confidence_level
    THEN
      RAISE EXCEPTION
        'AI suggestion completion was replayed with different output'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    INSERT INTO public.ai_suggestions (
      ticket_id,
      suggestion_type,
      model_name,
      prompt_version,
      output_text,
      confidence_level,
      created_by
    )
    VALUES (
      v_ticket_id,
      v_suggestion_type,
      v_model_name,
      v_prompt_version,
      v_output_text,
      v_confidence_level,
      v_actor_id
    )
    RETURNING * INTO v_suggestion;

    UPDATE public.ai_suggestion_requests AS request
    SET
      suggestion_id = v_suggestion.id,
      completed_at = pg_catalog.clock_timestamp()
    WHERE request.source = v_source
      AND request.idempotency_key = v_idempotency_key;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_suggestion.id,
    'output_text', v_suggestion.output_text,
    'confidence_level', v_suggestion.confidence_level,
    'suggestion_type', v_suggestion.suggestion_type,
    'model_name', v_suggestion.model_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_suggestion_request(
  text,
  text,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_suggestion_request(
  text,
  text,
  uuid,
  uuid,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_ai_suggestion_request(
  text,
  text,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ai_suggestion_request(
  text,
  text,
  uuid,
  uuid,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.checkpoint_ai_suggestion_provider_attempt(
  text,
  text,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_ai_suggestion_provider_attempt(
  text,
  text,
  uuid,
  uuid,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.complete_ai_suggestion_request_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ai_suggestion_request_atomic(jsonb)
  TO service_role;

COMMENT ON TABLE public.ai_suggestion_requests IS
  'Service-only replay ledger for paid Ripple Assist request keys and provider-attempt evidence.';

COMMENT ON FUNCTION public.reserve_ai_suggestion_request(
  text,
  text,
  uuid,
  uuid,
  text
) IS
  'Reserves one AI request key, returns a completed receipt for exact replay, and rejects altered reuse.';

COMMENT ON FUNCTION public.cancel_ai_suggestion_request(
  text,
  text,
  uuid,
  uuid,
  text
) IS
  'Cancels only an unfinished AI reservation that has not crossed the provider boundary.';

COMMENT ON FUNCTION public.checkpoint_ai_suggestion_provider_attempt(
  text,
  text,
  uuid,
  uuid,
  text
) IS
  'Durably checkpoints a reserved AI request before paid provider network I/O.';

COMMENT ON FUNCTION public.complete_ai_suggestion_request_atomic(jsonb) IS
  'Atomically persists one AI suggestion, completes its request receipt, and returns the first exact result.';

COMMIT;
