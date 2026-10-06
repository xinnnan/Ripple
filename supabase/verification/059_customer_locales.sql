-- Local verification matrix for migration 059 (customer language preferences).
-- Runs in one transaction and rolls back: zero residue.

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END;
$$;

CREATE FUNCTION pg_temp.state_of(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

INSERT INTO public.customers (id, name, status) VALUES
  ('c0000000-0000-4000-8000-000000000591', 'Locale Co', 'active'),
  ('c0000000-0000-4000-8000-000000000592', 'Other Locale Co', 'active');
INSERT INTO public.sites (id, customer_id, site_name, site_code, status) VALUES
  ('50000000-0000-4000-8000-000000000591', 'c0000000-0000-4000-8000-000000000591', 'Locale DC', 'LOCALE-059', 'active');
INSERT INTO public.users (id, email, full_name, role, status, customer_id) VALUES
  ('a0000000-0000-4000-8000-000000000591', 'admin059@dropletai.services', 'Admin', 'admin', 'active', NULL),
  ('a0000000-0000-4000-8000-000000000592', 'mgr059@example.com', 'Manager', 'customer_manager', 'active', 'c0000000-0000-4000-8000-000000000591'),
  ('a0000000-0000-4000-8000-000000000593', 'cust059@example.com', 'Customer', 'customer', 'active', 'c0000000-0000-4000-8000-000000000591'),
  ('a0000000-0000-4000-8000-000000000594', 'other059@example.com', 'Other', 'customer', 'active', 'c0000000-0000-4000-8000-000000000592'),
  ('a0000000-0000-4000-8000-000000000595', 'eng059@dropletai.services', 'Eng', 'engineer', 'active', NULL);

SELECT pg_temp.check(
  (SELECT locale FROM public.users WHERE id = 'a0000000-0000-4000-8000-000000000593') = 'en',
  'existing and new accounts default to English'
);
SELECT pg_temp.check(
  pg_temp.state_of($$UPDATE public.users SET locale = 'fr' WHERE id = 'a0000000-0000-4000-8000-000000000593'$$) = '23514',
  'unsupported user locale is rejected by constraint'
);

-- Privileges -----------------------------------------------------------------
SELECT pg_temp.check(NOT has_function_privilege(r, f, 'EXECUTE'), r || ' cannot execute ' || f)
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
  unnest(ARRAY['public.set_user_locale_atomic(uuid,uuid,text)', 'public.create_ticket_idempotent_atomic(jsonb)']) AS f;
SELECT pg_temp.check(has_function_privilege('service_role', 'public.create_ticket_idempotent_atomic(jsonb)', 'EXECUTE'), 'service_role creates tickets');
SELECT pg_temp.check(NOT has_function_privilege('service_role', 'public.create_ticket_idempotent_atomic_legacy_059(jsonb)', 'EXECUTE'), 'original create command is internal only');
SELECT pg_temp.check(NOT has_column_privilege('authenticated', 'public.users', 'locale', 'UPDATE'), 'authenticated cannot write locale directly');

-- set_user_locale_atomic -----------------------------------------------------
SELECT public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000593', 'a0000000-0000-4000-8000-000000000593', 'ko');
SELECT pg_temp.check(
  (SELECT locale FROM public.users WHERE id = 'a0000000-0000-4000-8000-000000000593') = 'ko',
  'customer sets their own language'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.audit_logs WHERE entity_id = 'a0000000-0000-4000-8000-000000000593' AND field_name = 'locale' AND new_value = 'ko') = 1,
  'language change writes one audit row'
);
SELECT public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000593', 'a0000000-0000-4000-8000-000000000593', 'ko');
SELECT pg_temp.check(
  (SELECT count(*) FROM public.audit_logs WHERE entity_id = 'a0000000-0000-4000-8000-000000000593' AND field_name = 'locale') = 1,
  'unchanged language is a no-op without audit'
);
SELECT pg_temp.check(
  public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000592', 'a0000000-0000-4000-8000-000000000593', 'es') = 'es',
  'customer manager sets a same-company member language'
);
SELECT pg_temp.check(
  public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000591', 'a0000000-0000-4000-8000-000000000594', 'zh') = 'zh',
  'admin sets any account language'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000592', 'a0000000-0000-4000-8000-000000000594', 'ko')$$) = '42501',
  'customer manager cannot change another company account'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000593', 'a0000000-0000-4000-8000-000000000592', 'ko')$$) = '42501',
  'customer cannot change someone else'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000592', 'a0000000-0000-4000-8000-000000000595', 'ko')$$) = '42501',
  'customer manager cannot change an internal account'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000593', 'a0000000-0000-4000-8000-000000000593', 'de')$$) = '22023',
  'unsupported language is rejected by the command'
);
UPDATE public.users SET status = 'inactive' WHERE id = 'a0000000-0000-4000-8000-000000000593';
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.set_user_locale_atomic('a0000000-0000-4000-8000-000000000593', 'a0000000-0000-4000-8000-000000000593', 'en')$$) = '42501',
  'inactive accounts cannot change language'
);

-- Ticket creation wrapper ----------------------------------------------------
CREATE FUNCTION pg_temp.create_input(p_key text, p_locale text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'customer_id', 'c0000000-0000-4000-8000-000000000591',
    'site_id', '50000000-0000-4000-8000-000000000591',
    'source', 'web',
    'title', 'Locale ticket',
    'description', 'Created in a test',
    'request_type', 'incident',
    'severity', 'P3',
    'submitter_name', 'Guest',
    'submitter_email', 'guest059@example.com',
    'secure_token', md5(p_key) || md5(p_key || 'x'),
    'idempotency_key', p_key
  ) || CASE WHEN p_locale IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('locale', p_locale) END;
$$;

SELECT public.create_ticket_idempotent_atomic(pg_temp.create_input('verify-059-create-ko-1', 'ko')) AS ko_receipt \gset
SELECT pg_temp.check(
  (SELECT locale FROM public.tickets WHERE id = (:'ko_receipt'::jsonb ->> 'id')::uuid) = 'ko',
  'new ticket stores the submitter language'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = (:'ko_receipt'::jsonb ->> 'id')::uuid AND event_type = 'ticket.email_confirmation') = 1,
  'confirmation email is enqueued in the same transaction'
);
SELECT pg_temp.check(
  public.create_ticket_idempotent_atomic(pg_temp.create_input('verify-059-create-ko-1', 'es')) ->> 'id' = :'ko_receipt'::jsonb ->> 'id',
  'replay returns the first ticket'
);
SELECT pg_temp.check(
  (SELECT locale FROM public.tickets WHERE id = (:'ko_receipt'::jsonb ->> 'id')::uuid) = 'ko',
  'replay keeps the original language'
);
SELECT public.create_ticket_idempotent_atomic(pg_temp.create_input('verify-059-create-default', NULL)) AS default_receipt \gset
SELECT pg_temp.check(
  (SELECT locale FROM public.tickets WHERE id = (:'default_receipt'::jsonb ->> 'id')::uuid) = 'en',
  'callers that send no language get English'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.create_ticket_idempotent_atomic(pg_temp.create_input('verify-059-create-bad', 'fr'))$$) = '22023'
  AND NOT EXISTS (SELECT 1 FROM public.ticket_creation_requests WHERE idempotency_key = 'verify-059-create-bad'),
  'unsupported ticket language is rejected before creation'
);

-- Administrator-created customer accounts ----------------------------------
INSERT INTO public.sites (id, customer_id, site_name, site_code, status) VALUES
  ('50000000-0000-4000-8000-000000000592', 'c0000000-0000-4000-8000-000000000592', 'Other Locale DC', 'LOCALE-059-B', 'active');
INSERT INTO public.users (id, email, full_name, role, status, customer_id) VALUES
  ('b0000000-0000-4000-8000-000000000591', 'newmgr059@example.com', 'Pending', 'customer', 'invited', NULL),
  ('b0000000-0000-4000-8000-000000000592', 'newcust059@example.com', 'Pending', 'customer', 'invited', NULL),
  ('b0000000-0000-4000-8000-000000000593', 'cross059@example.com', 'Pending', 'customer', 'invited', NULL);
INSERT INTO public.users (id, email, full_name, role, status, customer_id, created_at) VALUES
  ('b0000000-0000-4000-8000-000000000594', 'stale059@example.com', 'Pending', 'customer', 'invited', NULL, now() - interval '2 hours');

SELECT pg_temp.check(
  NOT has_function_privilege(r, 'public.finalize_admin_customer_user_creation(uuid,uuid,uuid,text,text,text,uuid[])', 'EXECUTE'),
  r || ' cannot create customer accounts'
) FROM unnest(ARRAY['anon', 'authenticated']) AS r;

SELECT public.finalize_admin_customer_user_creation(
  'a0000000-0000-4000-8000-000000000591', 'b0000000-0000-4000-8000-000000000591',
  'c0000000-0000-4000-8000-000000000591', 'customer_manager', ' New Manager ', NULL, ARRAY[]::uuid[]
);
SELECT pg_temp.check(
  (SELECT role = 'customer_manager' AND status = 'active' AND customer_id = 'c0000000-0000-4000-8000-000000000591' AND full_name = 'New Manager'
   FROM public.users WHERE id = 'b0000000-0000-4000-8000-000000000591'),
  'admin creates the first customer manager for a company'
);
SELECT pg_temp.check(
  EXISTS (SELECT 1 FROM public.customer_memberships WHERE user_id = 'b0000000-0000-4000-8000-000000000591'
            AND customer_id = 'c0000000-0000-4000-8000-000000000591'),
  'new manager is mirrored into the canonical membership model'
);
SELECT public.finalize_admin_customer_user_creation(
  'a0000000-0000-4000-8000-000000000591', 'b0000000-0000-4000-8000-000000000592',
  'c0000000-0000-4000-8000-000000000591', 'customer', 'New Customer', '+1 555 0100',
  ARRAY['50000000-0000-4000-8000-000000000591'::uuid, '50000000-0000-4000-8000-000000000591'::uuid]
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.site_members WHERE user_id = 'b0000000-0000-4000-8000-000000000592') = 1,
  'customer gets each requested site exactly once'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.audit_logs WHERE entity_id = 'b0000000-0000-4000-8000-000000000592'
     AND metadata ->> 'command' = 'finalize_admin_customer_user_creation') = 1,
  'customer creation writes one audit row'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.finalize_admin_customer_user_creation(
    'a0000000-0000-4000-8000-000000000591', 'b0000000-0000-4000-8000-000000000593',
    'c0000000-0000-4000-8000-000000000591', 'customer', 'Cross', NULL,
    ARRAY['50000000-0000-4000-8000-000000000592'::uuid])$$) = '42501',
  'another company site cannot be assigned'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.finalize_admin_customer_user_creation(
    'a0000000-0000-4000-8000-000000000592', 'b0000000-0000-4000-8000-000000000593',
    'c0000000-0000-4000-8000-000000000591', 'customer', 'X', NULL, ARRAY[]::uuid[])$$) = '42501',
  'customer managers cannot use the administrator command'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.finalize_admin_customer_user_creation(
    'a0000000-0000-4000-8000-000000000591', 'b0000000-0000-4000-8000-000000000593',
    'c0000000-0000-4000-8000-000000000591', 'engineer', 'X', NULL, ARRAY[]::uuid[])$$) = '22023',
  'internal roles cannot be created through the customer command'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.finalize_admin_customer_user_creation(
    'a0000000-0000-4000-8000-000000000591', 'b0000000-0000-4000-8000-000000000594',
    'c0000000-0000-4000-8000-000000000591', 'customer', 'X', NULL, ARRAY[]::uuid[])$$) = '55000',
  'stale provisional identities cannot be finalized'
);
SELECT pg_temp.check(
  pg_temp.state_of($$SELECT public.finalize_admin_customer_user_creation(
    'a0000000-0000-4000-8000-000000000591', 'b0000000-0000-4000-8000-000000000591',
    'c0000000-0000-4000-8000-000000000591', 'customer', 'Again', NULL, ARRAY[]::uuid[])$$) = '55000',
  'an existing account cannot be re-finalized'
);

ROLLBACK;
