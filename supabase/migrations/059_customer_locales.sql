-- Migration 059 — Customer language preferences
--
-- Customers use Ripple in English, Spanish, Chinese (Simplified), or Korean.
-- Two facts need durable storage:
--
-- 1. users.locale: the account's preferred language, used for account emails
--    (invitations, password resets) and to restore the UI language on a new
--    device.
-- 2. tickets.locale: the language the ticket was submitted in. Confirmation,
--    update, and resolution emails go to the submitter (often a guest without
--    an account), so the ticket itself carries the language.
--
-- It also adds finalize_admin_customer_user_creation: administrators had no
-- way to create the first customer manager (or any customer) for a company;
-- staff creation only produced internal roles and team creation requires an
-- existing customer manager.
--
-- Ticket creation keeps its exact service signature behind a wrapper (the
-- migration 056/058 pattern). The wrapper sets tickets.locale in the same
-- transaction that enqueues the confirmation email, so the outbox worker never
-- sees a ticket without its language. Locale is a presentation preference,
-- not business input, so an exact replay with a different locale keeps the
-- first ticket and does not fail.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_locale_supported;
ALTER TABLE public.users
  ADD CONSTRAINT users_locale_supported
  CHECK (locale IN ('en', 'es', 'zh', 'ko'));

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_locale_supported;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_locale_supported
  CHECK (locale IN ('en', 'es', 'zh', 'ko'));

-- Authenticated users can never write these columns directly (migration 045
-- revoked table writes); customers may still read their own row's locale.
GRANT SELECT (locale) ON public.users TO authenticated;

-- ---------------------------------------------------------------------------
-- Ticket creation wrapper.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.create_ticket_idempotent_atomic(jsonb)
  RENAME TO create_ticket_idempotent_atomic_legacy_059;

REVOKE ALL ON FUNCTION public.create_ticket_idempotent_atomic_legacy_059(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_ticket_idempotent_atomic(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_locale text := 'en';
  v_receipt jsonb;
  v_source text;
  v_key text;
  v_is_replay boolean := false;
BEGIN
  IF p_input IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_input) = 'object'
    AND p_input ? 'locale'
  THEN
    v_locale := p_input ->> 'locale';
    IF v_locale IS NULL OR v_locale NOT IN ('en', 'es', 'zh', 'ko') THEN
      RAISE EXCEPTION 'Unsupported ticket locale' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_input IS NOT NULL AND pg_catalog.jsonb_typeof(p_input) = 'object' THEN
    v_source := p_input ->> 'source';
    v_key := pg_catalog.btrim(p_input ->> 'idempotency_key');
  END IF;
  IF v_source IS NOT NULL AND v_key IS NOT NULL THEN
    -- Same lock as the original command, so the replay check cannot race a
    -- concurrent first attempt.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_source || ':' || v_key, 0)
    );
    v_is_replay := EXISTS (
      SELECT 1
      FROM public.ticket_creation_requests AS request
      WHERE request.source = v_source
        AND request.idempotency_key = v_key
    );
  END IF;

  v_receipt := public.create_ticket_idempotent_atomic_legacy_059(
    CASE
      WHEN p_input IS NOT NULL AND pg_catalog.jsonb_typeof(p_input) = 'object'
        THEN p_input - 'locale'
      ELSE p_input
    END
  );

  IF NOT v_is_replay THEN
    UPDATE public.tickets AS t
    SET locale = v_locale
    WHERE t.id = (v_receipt ->> 'id')::uuid
      AND t.locale IS DISTINCT FROM v_locale;
  END IF;

  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.create_ticket_idempotent_atomic(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ticket_idempotent_atomic(jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Account language preference.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.set_user_locale_atomic(
  p_actor_id uuid,
  p_user_id uuid,
  p_locale text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_occurred_at timestamptz;
BEGIN
  IF p_locale IS NULL OR p_locale NOT IN ('en', 'es', 'zh', 'ko') THEN
    RAISE EXCEPTION 'Unsupported locale' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor
  FROM public.users
  WHERE id = p_actor_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  -- Self-service, administrators, or the customer manager who provisions
  -- members of the same customer account.
  IF NOT (
    v_actor.id = v_target.id
    OR v_actor.role = 'admin'
    OR (
      v_actor.role = 'customer_manager'
      AND v_actor.customer_id IS NOT NULL
      AND v_actor.customer_id = v_target.customer_id
      AND v_target.role IN ('customer', 'customer_manager')
    )
  ) THEN
    RAISE EXCEPTION 'Not allowed to change this account language'
      USING ERRCODE = '42501';
  END IF;

  IF v_target.locale = p_locale THEN
    RETURN p_locale;
  END IF;

  v_occurred_at := pg_catalog.clock_timestamp();

  UPDATE public.users AS u
  SET locale = p_locale
  WHERE u.id = v_target.id;

  INSERT INTO public.audit_logs (
    actor_id, actor_email, actor_role, entity_type, entity_id, action,
    field_name, old_value, new_value, metadata, created_at
  )
  VALUES (
    v_actor.id, v_actor.email, v_actor.role, 'user', v_target.id, 'updated',
    'locale', v_target.locale, p_locale,
    pg_catalog.jsonb_build_object('command', 'set_user_locale_atomic'),
    v_occurred_at
  );

  RETURN p_locale;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_locale_atomic(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_locale_atomic(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Administrator-created customer accounts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.finalize_admin_customer_user_creation(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_customer_id uuid,
  p_role text,
  p_full_name text,
  p_phone text DEFAULT NULL,
  p_site_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_target public.users%ROWTYPE;
  v_full_name text;
  v_phone text;
  v_site_ids uuid[];
  v_valid_site_count integer;
BEGIN
  -- Same serialization point as the admin and team finalizers (039).
  PERFORM pg_catalog.pg_advisory_xact_lock(71618038001::bigint);

  SELECT actor.email
  INTO v_actor_email
  FROM public.users AS actor
  WHERE actor.id = p_actor_id
    AND actor.role = 'admin'
    AND actor.status = 'active'
  FOR SHARE OF actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active administrator account required'
      USING ERRCODE = '42501';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('customer_manager', 'customer') THEN
    RAISE EXCEPTION 'Customer accounts must be customer_manager or customer'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.customers AS customer
  WHERE customer.id = p_customer_id
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF customer;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active customer organization required'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required' USING ERRCODE = '22023';
  END IF;

  v_full_name := pg_catalog.btrim(p_full_name);
  v_phone := NULLIF(pg_catalog.btrim(p_phone), '');
  IF v_full_name IS NULL OR v_full_name = ''
    OR pg_catalog.char_length(v_full_name) > 200
  THEN
    RAISE EXCEPTION 'User name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NOT NULL AND pg_catalog.char_length(v_phone) > 50 THEN
    RAISE EXCEPTION 'Phone must fit 50 characters' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(requested.id ORDER BY requested.id),
    ARRAY[]::uuid[]
  )
  INTO v_site_ids
  FROM (
    SELECT DISTINCT supplied.id
    FROM pg_catalog.unnest(COALESCE(p_site_ids, ARRAY[]::uuid[])) AS supplied(id)
  ) AS requested;
  IF pg_catalog.cardinality(v_site_ids) > 200 THEN
    RAISE EXCEPTION 'Site assignment is limited to 200 sites'
      USING ERRCODE = '22023';
  END IF;

  SELECT target.*
  INTO v_target
  FROM public.users AS target
  WHERE target.id = p_target_user_id
  FOR UPDATE OF target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisional user not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target.created_at < pg_catalog.clock_timestamp() - INTERVAL '30 minutes'
    OR v_target.role <> 'customer'
    OR v_target.status NOT IN ('active', 'invited')
    OR v_target.customer_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.site_members AS membership
      WHERE membership.user_id = p_target_user_id
    )
  THEN
    RAISE EXCEPTION 'Target is not a fresh provisional user'
      USING ERRCODE = '55000';
  END IF;

  PERFORM site.id
  FROM public.sites AS site
  WHERE site.id = ANY(v_site_ids)
  ORDER BY site.id
  FOR SHARE OF site;

  SELECT pg_catalog.count(*)::integer
  INTO v_valid_site_count
  FROM public.sites AS site
  WHERE site.id = ANY(v_site_ids)
    AND site.customer_id = p_customer_id
    AND site.status = 'active';
  IF v_valid_site_count <> pg_catalog.cardinality(v_site_ids) THEN
    RAISE EXCEPTION 'Every assigned site must be active and belong to the customer'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.users AS target
  SET
    full_name = v_full_name,
    phone = v_phone,
    role = p_role,
    status = 'active',
    customer_id = p_customer_id
  WHERE target.id = p_target_user_id;

  INSERT INTO public.site_members (user_id, site_id, role)
  SELECT p_target_user_id, assigned.site_id, 'member'
  FROM pg_catalog.unnest(v_site_ids) AS assigned(site_id);

  INSERT INTO public.audit_logs (
    actor_id, actor_email, actor_role, entity_type, entity_id, action,
    new_value, metadata
  )
  VALUES (
    p_actor_id, v_actor_email, 'admin', 'user', p_target_user_id, 'created',
    v_target.email,
    pg_catalog.jsonb_build_object(
      'command', 'finalize_admin_customer_user_creation',
      'role', p_role,
      'full_name', v_full_name,
      'customer_id', p_customer_id,
      'site_ids', pg_catalog.to_jsonb(v_site_ids)
    )
  );

  -- Keep migration 055's canonical membership mirror in step (056 bridge).
  PERFORM public.sync_customer_authorization_from_legacy(
    p_target_user_id,
    p_actor_id
  );

  RETURN p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_admin_customer_user_creation(
  uuid, uuid, uuid, text, text, text, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_admin_customer_user_creation(
  uuid, uuid, uuid, text, text, text, uuid[]
) TO service_role;

COMMENT ON COLUMN public.users.locale IS
  'Preferred language for account emails and the UI (en, es, zh, ko).';
COMMENT ON COLUMN public.tickets.locale IS
  'Language the ticket was submitted in; used for submitter emails.';
COMMENT ON FUNCTION public.set_user_locale_atomic(uuid, uuid, text) IS
  'Audited language preference change by the user, an admin, or the
   provisioning customer manager.';

COMMIT;
