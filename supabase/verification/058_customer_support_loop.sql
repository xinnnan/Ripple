-- Local verification matrix for migration 058 (customer support loop).
-- Runs in one transaction and rolls back: zero residue.
-- Usage: npm run verify:db   (requires `supabase start`)
-- Share tokens use an e-prefixed pattern so the matrix can run beside
-- `npm run seed:local` fixtures.

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

-- Expect a command to fail with a SQLSTATE and leave no comment behind.
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_before bigint;
  v_after bigint;
BEGIN
  SELECT count(*) INTO v_before FROM public.ticket_comments;
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FAIL: % (no error raised)', p_label;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLSTATE <> p_state THEN
      RAISE EXCEPTION 'FAIL: % (got % %)', p_label, SQLSTATE, SQLERRM;
    END IF;
  END;
  SELECT count(*) INTO v_after FROM public.ticket_comments;
  PERFORM pg_temp.check(v_before = v_after, p_label || ' leaves no comment');
END;
$$;

-- Fixtures ------------------------------------------------------------------
INSERT INTO public.customers (id, name, status) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Verify Co', 'active'),
  ('c0000000-0000-4000-8000-000000000002', 'Other Co', 'active');
INSERT INTO public.sites (id, customer_id, site_name, site_code, status) VALUES
  ('50000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Verify DC', 'VERIFY-058', 'active'),
  ('50000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'Other DC', 'OTHER-058', 'active');
INSERT INTO public.users (id, email, full_name, role, status, customer_id) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'eng058@dropletai.services', 'Eng', 'engineer', 'active', NULL),
  ('a0000000-0000-4000-8000-000000000002', 'cust058@example.com', 'Cust', 'customer', 'active', 'c0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000003', 'other058@example.com', 'Other', 'customer', 'active', 'c0000000-0000-4000-8000-000000000002');
INSERT INTO public.site_members (user_id, site_id, role) VALUES
  ('a0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'member'),
  ('a0000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', 'member');

INSERT INTO public.tickets (
  id, ticket_no, customer_id, site_id, source, title, description,
  request_type, severity, secure_token, status, owner_id, submitter_email,
  customer_visible_summary, resolved_at, closed_at
) VALUES
  -- T1 waiting on customer, owned
  ('70000000-0000-4000-8000-000000000001', 'RPL-958001', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T1', 'd', 'incident', 'P3', repeat('e1', 32), 'waiting_customer', 'a0000000-0000-4000-8000-000000000001', 'guest@example.com', NULL, NULL, NULL),
  -- T2 resolved yesterday
  ('70000000-0000-4000-8000-000000000002', 'RPL-958002', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T2', 'd', 'incident', 'P3', repeat('e2', 32), 'resolved', 'a0000000-0000-4000-8000-000000000001', 'guest@example.com', 'Fixed', now() - interval '1 day', NULL),
  -- T3 closed 40 days ago
  ('70000000-0000-4000-8000-000000000003', 'RPL-958003', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T3', 'd', 'incident', 'P3', repeat('e3', 32), 'closed', 'a0000000-0000-4000-8000-000000000001', NULL, 'Fixed', now() - interval '45 days', now() - interval '40 days'),
  -- T4 resolved 10 days ago, quiet: auto-close candidate
  ('70000000-0000-4000-8000-000000000004', 'RPL-958004', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T4', 'd', 'incident', 'P3', repeat('e4', 32), 'resolved', 'a0000000-0000-4000-8000-000000000001', NULL, 'Fixed', now() - interval '10 days', NULL),
  -- T5 resolved 10 days ago but the customer wrote 2 days ago
  ('70000000-0000-4000-8000-000000000005', 'RPL-958005', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T5', 'd', 'incident', 'P3', repeat('e5', 32), 'resolved', 'a0000000-0000-4000-8000-000000000001', NULL, 'Fixed', now() - interval '10 days', NULL),
  -- T6 resolved 2 days ago
  ('70000000-0000-4000-8000-000000000006', 'RPL-958006', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T6', 'd', 'incident', 'P3', repeat('e6', 32), 'resolved', 'a0000000-0000-4000-8000-000000000001', NULL, 'Fixed', now() - interval '2 days', NULL),
  -- T7 waiting on customer without an owner (legacy shape)
  ('70000000-0000-4000-8000-000000000007', 'RPL-958007', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T7', 'd', 'incident', 'P3', repeat('e7', 32), 'waiting_customer', NULL, NULL, NULL, NULL, NULL),
  -- T9 Slack-sourced, waiting on customer
  ('70000000-0000-4000-8000-000000000009', 'RPL-958009', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'slack', 'T9', 'd', 'incident', 'P3', repeat('ea', 32), 'waiting_customer', 'a0000000-0000-4000-8000-000000000001', 'slackuser@example.com', NULL, NULL, NULL),
  -- T8 resolved, for guest reopen
  ('70000000-0000-4000-8000-000000000008', 'RPL-958008', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'web', 'T8', 'd', 'incident', 'P3', repeat('e8', 32), 'resolved', 'a0000000-0000-4000-8000-000000000001', 'guest@example.com', 'Fixed', now() - interval '1 day', NULL);

INSERT INTO public.ticket_comments (ticket_id, author_id, body, visibility, source, created_at)
VALUES ('70000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', 'Still watching', 'customer', 'web', now() - interval '2 days');

-- Privileges ----------------------------------------------------------------
SELECT pg_temp.check(
  NOT has_function_privilege(r, f, 'EXECUTE'),
  format('%s cannot execute %s', r, f)
)
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
  unnest(ARRAY[
    'public.record_ticket_comment_idempotent_atomic(jsonb)',
    'public.reopen_ticket_as_customer_atomic(jsonb)',
    'public.record_guest_ticket_reply_atomic(jsonb)',
    'public.close_stale_resolved_tickets_atomic(integer)',
    'public.record_slack_event_comment_atomic(jsonb)'
  ]) AS f;

SELECT pg_temp.check(has_function_privilege('service_role', f, 'EXECUTE'), 'service_role executes ' || f)
FROM unnest(ARRAY[
  'public.record_slack_event_comment_atomic(jsonb)',
  'public.record_ticket_comment_idempotent_atomic(jsonb)',
  'public.reopen_ticket_as_customer_atomic(jsonb)',
  'public.record_guest_ticket_reply_atomic(jsonb)',
  'public.close_stale_resolved_tickets_atomic(integer)'
]) AS f;

SELECT pg_temp.check(NOT has_function_privilege('service_role', f, 'EXECUTE'), 'service_role cannot call internal ' || f)
FROM unnest(ARRAY[
  'public.record_ticket_comment_idempotent_atomic_legacy_058(jsonb)',
  'public.record_slack_event_comment_atomic_legacy_058(jsonb)',
  'public.apply_new_comment_effects_058(uuid,text)',
  'public.apply_customer_reply_status_effect(uuid,uuid,text,text,boolean,text)',
  'public.validate_customer_reply_input_058(jsonb,text[])'
]) AS f;

SELECT pg_temp.check(
  NOT has_table_privilege(r, 'public.ticket_customer_reply_requests', 'SELECT'),
  r || ' cannot read reply ledger'
) FROM unnest(ARRAY['anon', 'authenticated']) AS r;

-- Customer comment returns a waiting ticket to the queue --------------------
SELECT public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000001',
  'actor_id', 'a0000000-0000-4000-8000-000000000002',
  'body', 'Here are the logs', 'visibility', 'customer', 'source', 'web',
  'is_automated', false, 'idempotency_key', 'verify-058-customer-reply-1'
)) AS first_comment \gset

SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000001') = 'in_progress',
  'customer reply moves waiting_customer to in_progress'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.ticket_events WHERE ticket_id = '70000000-0000-4000-8000-000000000001'
     AND event_type = 'status_changed' AND old_value = 'waiting_customer' AND new_value = 'in_progress'
     AND actor_id = 'a0000000-0000-4000-8000-000000000002') = 1,
  'auto-return writes one attributed status event'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.audit_logs WHERE entity_id = '70000000-0000-4000-8000-000000000001'
     AND field_name = 'status' AND metadata ->> 'reason' = 'customer_reply') = 1,
  'auto-return writes one audit row'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000001'
     AND event_type = 'ticket.slack_master_sync') = 1,
  'auto-return syncs the Slack master card once'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000001'
     AND event_type = 'ticket.email_customer_update') = 0,
  'customer replies never email the customer'
);

SELECT pg_temp.check(
  public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000001',
    'actor_id', 'a0000000-0000-4000-8000-000000000002',
    'body', 'Here are the logs', 'visibility', 'customer', 'source', 'web',
    'is_automated', false, 'idempotency_key', 'verify-058-customer-reply-1'
  )) = :'first_comment'::uuid,
  'exact comment replay returns the first comment'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.ticket_events WHERE ticket_id = '70000000-0000-4000-8000-000000000001'
     AND event_type = 'status_changed') = 1,
  'replay applies no second status effect'
);

-- Owner-less waiting ticket stays put (in_progress requires an owner).
SELECT public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000007',
  'actor_id', 'a0000000-0000-4000-8000-000000000002',
  'body', 'Answer', 'visibility', 'customer', 'source', 'web',
  'is_automated', false, 'idempotency_key', 'verify-058-customer-reply-7'
));
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000007') = 'waiting_customer',
  'owner-less waiting ticket is not auto-returned'
);

-- Engineer updates email the submitter once ---------------------------------
SELECT public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000001',
  'actor_id', 'a0000000-0000-4000-8000-000000000001',
  'body', 'Please power-cycle the controller', 'visibility', 'customer', 'source', 'web',
  'is_automated', false, 'idempotency_key', 'verify-058-engineer-update-1'
)) AS engineer_comment \gset
SELECT public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000001',
  'actor_id', 'a0000000-0000-4000-8000-000000000001',
  'body', 'Please power-cycle the controller', 'visibility', 'customer', 'source', 'web',
  'is_automated', false, 'idempotency_key', 'verify-058-engineer-update-1'
));
SELECT public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000001',
  'actor_id', 'a0000000-0000-4000-8000-000000000001',
  'body', 'Internal note', 'visibility', 'internal', 'source', 'web',
  'is_automated', false, 'idempotency_key', 'verify-058-engineer-internal-1'
));
SELECT public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000001',
  'actor_id', 'a0000000-0000-4000-8000-000000000001',
  'body', 'Automated notice', 'visibility', 'customer', 'source', 'web',
  'is_automated', true, 'idempotency_key', 'verify-058-engineer-automated-1'
));
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000001'
     AND event_type = 'ticket.email_customer_update') = 1,
  'only the human customer-visible engineer update emails, once'
);
SELECT pg_temp.check(
  (SELECT payload ->> 'comment_id' FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000001'
     AND event_type = 'ticket.email_customer_update') = :'engineer_comment',
  'update email references the engineer comment'
);
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000001') = 'in_progress',
  'engineer comments do not change status'
);

-- Signed Slack thread capture gets the same effects -------------------------
SELECT public.record_slack_event_comment_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000009',
  'actor_id', 'a0000000-0000-4000-8000-000000000002',
  'body', 'Replied in Slack', 'idempotency_key', 'verify-058-slack-customer-1'
)) AS slack_customer_comment \gset
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000009') = 'in_progress',
  'customer Slack thread reply returns the ticket to the queue'
);
SELECT pg_temp.check(
  public.record_slack_event_comment_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000009',
    'actor_id', 'a0000000-0000-4000-8000-000000000002',
    'body', 'Replied in Slack', 'idempotency_key', 'verify-058-slack-customer-1'
  )) = :'slack_customer_comment'::uuid
  AND (SELECT count(*) FROM public.ticket_events WHERE ticket_id = '70000000-0000-4000-8000-000000000009'
         AND event_type = 'status_changed') = 1,
  'Slack capture replay returns the first comment without a second effect'
);
SELECT public.record_slack_event_comment_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000009',
  'actor_id', 'a0000000-0000-4000-8000-000000000001',
  'body', 'Engineer reply in Slack', 'idempotency_key', 'verify-058-slack-engineer-1'
));
SELECT public.record_ticket_comment_idempotent_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000009',
  'actor_id', 'a0000000-0000-4000-8000-000000000001',
  'body', 'Engineer web update', 'visibility', 'customer', 'source', 'web',
  'is_automated', false, 'idempotency_key', 'verify-058-slack-ticket-web-update'
));
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000009'
     AND event_type = 'ticket.email_customer_update') = 0,
  'Slack-sourced tickets never email updates the customer already sees in Slack'
);
SELECT public.record_slack_event_comment_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000001',
  'actor_id', 'a0000000-0000-4000-8000-000000000001',
  'body', 'Engineer answered in the thread', 'idempotency_key', 'verify-058-slack-engineer-web-ticket'
));
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000001'
     AND event_type = 'ticket.email_customer_update') = 2,
  'engineer Slack thread reply on a web ticket emails the submitter'
);

-- Signed-in reopen -----------------------------------------------------------
SELECT public.reopen_ticket_as_customer_atomic(jsonb_build_object(
  'ticket_id', '70000000-0000-4000-8000-000000000002',
  'actor_id', 'a0000000-0000-4000-8000-000000000002',
  'body', 'The jam came back', 'idempotency_key', 'verify-058-reopen-account-1'
)) AS reopen_comment \gset
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000002') = 'reopened',
  'customer reopens a resolved ticket'
);
SELECT pg_temp.check(
  (SELECT visibility = 'customer' AND author_id = 'a0000000-0000-4000-8000-000000000002'
     FROM public.ticket_comments WHERE id = :'reopen_comment'),
  'reopen reason is a customer-visible comment by the customer'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000002'
     AND event_type IN ('ticket.slack_comment_reply', 'ticket.slack_master_sync')) = 2,
  'reopen posts the reason and syncs the card'
);
SELECT pg_temp.check(
  public.reopen_ticket_as_customer_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000002',
    'actor_id', 'a0000000-0000-4000-8000-000000000002',
    'body', 'The jam came back', 'idempotency_key', 'verify-058-reopen-account-1'
  )) = :'reopen_comment'::uuid,
  'exact reopen replay returns the first comment'
);
SELECT pg_temp.expect_error(
  $$SELECT public.reopen_ticket_as_customer_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000002',
    'actor_id', 'a0000000-0000-4000-8000-000000000002',
    'body', 'Different text', 'idempotency_key', 'verify-058-reopen-account-1'))$$,
  '22023', 'altered reopen key reuse is rejected'
);
SELECT pg_temp.expect_error(
  $$SELECT public.reopen_ticket_as_customer_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000003',
    'actor_id', 'a0000000-0000-4000-8000-000000000002',
    'body', 'Again', 'idempotency_key', 'verify-058-reopen-old-closed'))$$,
  '23514', 'tickets closed over 30 days ago cannot be reopened'
);
SELECT pg_temp.expect_error(
  $$SELECT public.reopen_ticket_as_customer_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000001',
    'actor_id', 'a0000000-0000-4000-8000-000000000002',
    'body', 'Again', 'idempotency_key', 'verify-058-reopen-open-ticket'))$$,
  '23514', 'open tickets cannot be reopened'
);
SELECT pg_temp.expect_error(
  $$SELECT public.reopen_ticket_as_customer_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000006',
    'actor_id', 'a0000000-0000-4000-8000-000000000001',
    'body', 'Again', 'idempotency_key', 'verify-058-reopen-engineer'))$$,
  '42501', 'internal accounts do not use the customer reopen command'
);
SELECT pg_temp.expect_error(
  $$SELECT public.reopen_ticket_as_customer_atomic(jsonb_build_object(
    'ticket_id', '70000000-0000-4000-8000-000000000006',
    'actor_id', 'a0000000-0000-4000-8000-000000000003',
    'body', 'Again', 'idempotency_key', 'verify-058-reopen-outsider'))$$,
  '42501', 'customers outside the site cannot reopen'
);
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000006') = 'resolved',
  'rejected reopen leaves the ticket resolved'
);

-- Guest reply ----------------------------------------------------------------
UPDATE public.tickets SET status = 'waiting_customer'
WHERE id = '70000000-0000-4000-8000-000000000001';

SELECT public.record_guest_ticket_reply_atomic(jsonb_build_object(
  'ticket_no', 'RPL-958001', 'secure_token', repeat('e1', 32),
  'body', 'Guest answer', 'reopen', false, 'idempotency_key', 'verify-058-guest-reply-1'
)) AS guest_comment \gset
SELECT pg_temp.check(
  (SELECT author_id IS NULL AND visibility = 'customer' FROM public.ticket_comments WHERE id = :'guest_comment'),
  'guest comment has no author and is customer-visible'
);
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000001') = 'in_progress',
  'guest reply returns the ticket to the queue'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.audit_logs WHERE entity_id = :'guest_comment'::uuid
     AND actor_role = 'guest' AND actor_email = 'guest@example.com') = 1,
  'guest reply audit names the submitter email, not an account'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE event_type = 'ticket.slack_comment_reply'
     AND payload ->> 'comment_id' = :'guest_comment'
     AND payload ->> 'message_text' LIKE '%ticket link%') = 1,
  'guest reply posts one Slack thread reply'
);
SELECT pg_temp.check(
  public.record_guest_ticket_reply_atomic(jsonb_build_object(
    'ticket_no', 'RPL-958001', 'secure_token', repeat('e1', 32),
    'body', 'Guest answer', 'reopen', false, 'idempotency_key', 'verify-058-guest-reply-1'
  )) = :'guest_comment'::uuid,
  'exact guest replay returns the first comment'
);
SELECT pg_temp.expect_error(
  $$SELECT public.record_guest_ticket_reply_atomic(jsonb_build_object(
    'ticket_no', 'RPL-958001', 'secure_token', repeat('e1', 32),
    'body', 'Guest answer', 'reopen', true, 'idempotency_key', 'verify-058-guest-reply-1'))$$,
  '22023', 'altered guest key reuse is rejected'
);
SELECT pg_temp.expect_error(
  $$SELECT public.record_guest_ticket_reply_atomic(jsonb_build_object(
    'ticket_no', 'RPL-958001', 'secure_token', repeat('e9', 32),
    'body', 'Hi', 'reopen', false, 'idempotency_key', 'verify-058-guest-wrong-token'))$$,
  'P0002', 'wrong share token is not found'
);
SELECT pg_temp.expect_error(
  $$SELECT public.record_guest_ticket_reply_atomic(jsonb_build_object(
    'ticket_no', 'RPL-958001', 'secure_token', repeat('e1', 32),
    'body', 'Hi', 'reopen', false, 'idempotency_key', 'verify-058-guest-extra', 'author_id', 'x'))$$,
  '22023', 'unknown guest input fields are rejected'
);
SELECT public.record_guest_ticket_reply_atomic(jsonb_build_object(
  'ticket_no', 'RPL-958008', 'secure_token', repeat('e8', 32),
  'body', 'Still broken', 'reopen', true, 'idempotency_key', 'verify-058-guest-reopen-1'
));
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000008') = 'reopened',
  'guest can reopen a resolved ticket with a reason'
);
SELECT pg_temp.expect_error(
  $$SELECT public.record_guest_ticket_reply_atomic(jsonb_build_object(
    'ticket_no', 'RPL-958003', 'secure_token', repeat('e3', 32),
    'body', 'Again', 'reopen', true, 'idempotency_key', 'verify-058-guest-reopen-old'))$$,
  '23514', 'guest cannot reopen a long-closed ticket'
);

-- Auto-close -----------------------------------------------------------------
SELECT pg_temp.expect_error(
  $$SELECT public.close_stale_resolved_tickets_atomic(0)$$,
  '22023', 'auto-close rejects an out-of-range limit'
);
SELECT pg_temp.check(public.close_stale_resolved_tickets_atomic(100) >= 1, 'auto-close runs');
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000004') = 'closed',
  'quiet ticket resolved 10 days ago is closed'
);
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000005') = 'resolved',
  'recent customer activity defers auto-close'
);
SELECT pg_temp.check(
  (SELECT status FROM public.tickets WHERE id = '70000000-0000-4000-8000-000000000006') = 'resolved',
  'recently resolved ticket stays resolved'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.audit_logs WHERE entity_id = '70000000-0000-4000-8000-000000000004'
     AND actor_role = 'system' AND new_value = 'closed') = 1,
  'auto-close writes one system audit row'
);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.integration_outbox WHERE aggregate_id = '70000000-0000-4000-8000-000000000004'
     AND event_type = 'ticket.slack_master_sync') = 1,
  'auto-close syncs the Slack card'
);
SELECT public.close_stale_resolved_tickets_atomic(100);
SELECT pg_temp.check(
  (SELECT count(*) FROM public.audit_logs WHERE entity_id = '70000000-0000-4000-8000-000000000004'
     AND actor_role = 'system') = 1,
  'second auto-close run does not touch closed tickets'
);

ROLLBACK;
