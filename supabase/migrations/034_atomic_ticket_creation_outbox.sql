-- Migration: 034_atomic_ticket_creation_outbox
-- Description: Add an opt-in atomic ticket creation command that validates
--              creator scope and commits timeline/audit/outbox rows together.
--
-- Rollout safety:
-- This is a service-role RPC, not an INSERT trigger. Applying the migration
-- first leaves the currently deployed direct-insert path unchanged. The new
-- application code opts into the command only after it is deployed.

BEGIN;

ALTER TABLE public.integration_outbox
  DROP CONSTRAINT IF EXISTS integration_outbox_event_type;

ALTER TABLE public.integration_outbox
  ADD CONSTRAINT integration_outbox_event_type
  CHECK (
    event_type IN (
      'ticket.slack_master_create',
      'ticket.email_confirmation',
      'ticket.slack_master_sync',
      'ticket.slack_resolution_reply',
      'ticket.email_resolution'
    )
  );

CREATE OR REPLACE FUNCTION public.create_ticket_atomic(
  p_input jsonb
)
RETURNS uuid
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
    'resolve_due_at'
  ];
  v_customer_id uuid;
  v_site_id uuid;
  v_created_by uuid;
  v_sla_policy_id uuid;
  v_source text;
  v_title text;
  v_description text;
  v_request_type text;
  v_severity text;
  v_impact text;
  v_asset_id text;
  v_area text;
  v_submitter_name text;
  v_submitter_email text;
  v_submitter_phone text;
  v_secure_token text;
  v_first_response_due_at timestamptz;
  v_resolve_due_at timestamptz;
  v_actor_email text;
  v_actor_role text;
  v_actor_customer_id uuid;
  v_actor_is_internal boolean := false;
  v_ticket_id uuid;
  v_ticket_no text;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
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

  BEGIN
    v_customer_id := (p_input ->> 'customer_id')::uuid;
    v_site_id := (p_input ->> 'site_id')::uuid;
    v_created_by := CASE
      WHEN p_input -> 'created_by' IS NULL
        OR p_input -> 'created_by' = 'null'::jsonb
        THEN NULL
      ELSE (p_input ->> 'created_by')::uuid
    END;
    v_sla_policy_id := CASE
      WHEN p_input -> 'sla_policy_id' IS NULL
        OR p_input -> 'sla_policy_id' = 'null'::jsonb
        THEN NULL
      ELSE (p_input ->> 'sla_policy_id')::uuid
    END;
    v_first_response_due_at := CASE
      WHEN p_input -> 'first_response_due_at' IS NULL
        OR p_input -> 'first_response_due_at' = 'null'::jsonb
        THEN NULL
      ELSE (p_input ->> 'first_response_due_at')::timestamptz
    END;
    v_resolve_due_at := CASE
      WHEN p_input -> 'resolve_due_at' IS NULL
        OR p_input -> 'resolve_due_at' = 'null'::jsonb
        THEN NULL
      ELSE (p_input ->> 'resolve_due_at')::timestamptz
    END;
  EXCEPTION
    WHEN invalid_text_representation
      OR invalid_datetime_format
      OR datetime_field_overflow
    THEN
      RAISE EXCEPTION 'Ticket input contains an invalid identifier or timestamp'
        USING ERRCODE = '22023';
  END;

  v_source := p_input ->> 'source';
  v_title := pg_catalog.btrim(p_input ->> 'title');
  v_description := pg_catalog.btrim(p_input ->> 'description');
  v_request_type := p_input ->> 'request_type';
  v_severity := p_input ->> 'severity';
  v_impact := NULLIF(p_input ->> 'impact', '');
  v_asset_id := NULLIF(pg_catalog.btrim(p_input ->> 'asset_id'), '');
  v_area := NULLIF(pg_catalog.btrim(p_input ->> 'area'), '');
  v_submitter_name :=
    NULLIF(pg_catalog.btrim(p_input ->> 'submitter_name'), '');
  v_submitter_email :=
    NULLIF(pg_catalog.btrim(p_input ->> 'submitter_email'), '');
  v_submitter_phone :=
    NULLIF(pg_catalog.btrim(p_input ->> 'submitter_phone'), '');
  v_secure_token := p_input ->> 'secure_token';

  IF v_customer_id IS NULL OR v_site_id IS NULL THEN
    RAISE EXCEPTION 'Ticket customer and site are required'
      USING ERRCODE = '22023';
  END IF;

  IF v_source IS NULL
    OR v_source NOT IN ('slack', 'web', 'email', 'internal')
  THEN
    RAISE EXCEPTION 'Unsupported ticket source'
      USING ERRCODE = '22023';
  END IF;

  IF v_title IS NULL
    OR pg_catalog.length(v_title) < 1
    OR pg_catalog.length(v_title) > 200
  THEN
    RAISE EXCEPTION 'Ticket title must contain 1 to 200 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_description IS NULL OR pg_catalog.length(v_description) < 1 THEN
    RAISE EXCEPTION 'Ticket description is required'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.length(v_description) > 20000 THEN
    RAISE EXCEPTION 'Ticket description must fit 20000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_request_type IS NULL
    OR v_request_type NOT IN (
      'incident',
      'service_request',
      'question',
      'change_request',
      'parts_rma',
      'deployment_issue',
      'training_documentation'
    )
  THEN
    RAISE EXCEPTION 'Unsupported request type'
      USING ERRCODE = '22023';
  END IF;

  IF v_severity IS NULL
    OR v_severity NOT IN ('P1', 'P2', 'P3', 'P4')
  THEN
    RAISE EXCEPTION 'Unsupported ticket severity'
      USING ERRCODE = '22023';
  END IF;

  IF v_impact IS NOT NULL
    AND v_impact NOT IN (
      'safety',
      'production_stopped',
      'production_slowed',
      'single_asset',
      'no_impact'
    )
  THEN
    RAISE EXCEPTION 'Unsupported ticket impact'
      USING ERRCODE = '22023';
  END IF;

  IF v_secure_token IS NULL
    OR v_secure_token !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Ticket secure token must be 64 lowercase hex characters'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.length(COALESCE(v_asset_id, '')) > 500
    OR pg_catalog.length(COALESCE(v_area, '')) > 500
    OR pg_catalog.length(COALESCE(v_submitter_name, '')) > 200
    OR pg_catalog.length(COALESCE(v_submitter_email, '')) > 320
    OR pg_catalog.length(COALESCE(v_submitter_phone, '')) > 50
  THEN
    RAISE EXCEPTION 'Ticket contact or asset fields exceed their limits'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.sites AS site
    JOIN public.customers AS customer
      ON customer.id = site.customer_id
    WHERE site.id = v_site_id
      AND site.customer_id = v_customer_id
      AND site.status = 'active'
      AND customer.status IN ('active', 'trial')
    FOR SHARE OF site, customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Ticket site must be active and belong to an active customer'
      USING ERRCODE = '22023';
  END IF;

  IF v_sla_policy_id IS NOT NULL THEN
    PERFORM 1
      FROM public.sla_policies AS policy
      WHERE policy.id = v_sla_policy_id
        AND (
          policy.customer_id IS NULL
          OR policy.customer_id = v_customer_id
        )
      FOR SHARE OF policy;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLA policy does not apply to the ticket customer'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_created_by IS NULL THEN
    IF v_source NOT IN ('web', 'slack') THEN
      RAISE EXCEPTION
        'Unauthenticated ticket source must be web or signed Slack'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT actor.email, actor.role, actor.customer_id
    INTO v_actor_email, v_actor_role, v_actor_customer_id
    FROM public.users AS actor
    WHERE actor.id = v_created_by
      AND actor.status = 'active'
    FOR SHARE OF actor;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active ticket creator account required'
        USING ERRCODE = '42501';
    END IF;

    v_actor_is_internal := CASE
      WHEN v_actor_role IS NOT NULL
        THEN v_actor_role IN ('admin', 'engineer')
      ELSE pg_catalog.lower(COALESCE(v_actor_email, ''))
        LIKE '%@dropletai.services'
    END;

    IF NOT v_actor_is_internal THEN
      IF v_source <> 'web' THEN
        RAISE EXCEPTION
          'External account ticket source must be web'
          USING ERRCODE = '42501';
      END IF;

      IF v_actor_role = 'customer_manager' THEN
        IF v_actor_customer_id IS DISTINCT FROM v_customer_id THEN
          RAISE EXCEPTION 'Ticket site is outside the customer account'
            USING ERRCODE = '42501';
        END IF;
      ELSIF v_actor_role = 'customer' THEN
        PERFORM 1
          FROM public.site_members AS membership
          WHERE membership.user_id = v_created_by
            AND membership.site_id = v_site_id
          FOR SHARE OF membership;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Ticket site is outside the assigned sites'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'Unsupported ticket creator role'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  v_ticket_no := public.next_ticket_no();

  INSERT INTO public.tickets (
    ticket_no,
    customer_id,
    site_id,
    source,
    title,
    description,
    request_type,
    severity,
    status,
    impact,
    asset_id,
    area,
    created_by,
    submitter_name,
    submitter_email,
    submitter_phone,
    secure_token,
    sla_policy_id,
    first_response_due_at,
    resolve_due_at,
    created_at,
    updated_at
  )
  VALUES (
    v_ticket_no,
    v_customer_id,
    v_site_id,
    v_source,
    v_title,
    v_description,
    v_request_type,
    v_severity,
    'new',
    v_impact,
    v_asset_id,
    v_area,
    v_created_by,
    v_submitter_name,
    v_submitter_email,
    v_submitter_phone,
    v_secure_token,
    v_sla_policy_id,
    v_first_response_due_at,
    v_resolve_due_at,
    v_occurred_at,
    v_occurred_at
  )
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.ticket_events (
    ticket_id,
    event_type,
    old_value,
    new_value,
    actor_id,
    created_at
  )
  VALUES (
    v_ticket_id,
    'ticket_created',
    NULL,
    'new',
    v_created_by,
    v_occurred_at
  );

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
    metadata,
    created_at
  )
  VALUES (
    v_created_by,
    v_actor_email,
    v_actor_role,
    'ticket',
    v_ticket_id,
    'created',
    'status',
    NULL,
    'new',
    pg_catalog.jsonb_build_object(
      'source', v_source,
      'command', 'create_ticket_atomic'
    ),
    v_occurred_at
  );

  INSERT INTO public.integration_outbox (
    aggregate_type,
    aggregate_id,
    event_type,
    idempotency_key,
    payload,
    created_at,
    available_at
  )
  VALUES (
    'ticket',
    v_ticket_id,
    'ticket.slack_master_create',
    'ticket:' || v_ticket_id::text || ':slack-master-create',
    pg_catalog.jsonb_build_object('source', v_source),
    v_occurred_at,
    v_occurred_at
  );

  IF v_submitter_email IS NOT NULL THEN
    INSERT INTO public.integration_outbox (
      aggregate_type,
      aggregate_id,
      event_type,
      idempotency_key,
      payload,
      created_at,
      available_at
    )
    VALUES (
      'ticket',
      v_ticket_id,
      'ticket.email_confirmation',
      'ticket:' || v_ticket_id::text || ':email-confirmation',
      pg_catalog.jsonb_build_object('source', v_source),
      v_occurred_at,
      v_occurred_at
    );
  END IF;

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_ticket_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ticket_atomic(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.create_ticket_atomic(jsonb) IS
  'Validates creator/site/source scope and atomically creates a ticket,
   timeline event, audit row, and durable Slack/email outbox records.';

COMMIT;
