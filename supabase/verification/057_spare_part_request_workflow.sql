-- Local verification matrix for migration 057 (part-request workflow guard).
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

CREATE FUNCTION pg_temp.patch_state(p_request uuid, p_actor uuid, p_status text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.apply_spare_part_request_patch(
    p_request, p_actor, jsonb_build_object('status', p_status), NULL
  );
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

INSERT INTO public.customers (id, name, status)
VALUES ('c0000000-0000-4000-8000-000000000057', 'Verify 057', 'active');
INSERT INTO public.sites (id, customer_id, site_name, site_code, status)
VALUES ('50000000-0000-4000-8000-000000000057', 'c0000000-0000-4000-8000-000000000057', 'Verify 057 DC', 'VERIFY-057', 'active');
INSERT INTO public.users (id, email, full_name, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000571', 'admin057@dropletai.services', 'Admin', 'admin', 'active'),
  ('a0000000-0000-4000-8000-000000000572', 'eng057@dropletai.services', 'Eng', 'engineer', 'active');

-- Full 5x5 matrix with an administrator actor, one fresh row per pair.
DO $$
DECLARE
  v_states text[] := ARRAY['requested', 'approved', 'shipped', 'delivered', 'cancelled'];
  v_from text;
  v_to text;
  v_allowed boolean;
  v_result text;
  v_status text;
BEGIN
  FOREACH v_from IN ARRAY v_states LOOP
    FOREACH v_to IN ARRAY v_states LOOP
      DELETE FROM public.spare_part_requests WHERE request_no = 'SPR-V57M';
      INSERT INTO public.spare_part_requests (id, request_no, site_id, status, approved_by)
      VALUES (
        '90000000-0000-4000-8000-000000000057', 'SPR-V57M',
        '50000000-0000-4000-8000-000000000057', v_from,
        CASE WHEN v_from IN ('approved', 'shipped', 'delivered')
          THEN 'a0000000-0000-4000-8000-000000000571'::uuid END
      );
      v_allowed := v_from = v_to OR (v_from, v_to) IN (
        ('requested', 'approved'), ('requested', 'cancelled'),
        ('approved', 'shipped'), ('approved', 'cancelled'),
        ('shipped', 'delivered')
      );
      v_result := pg_temp.patch_state(
        '90000000-0000-4000-8000-000000000057',
        'a0000000-0000-4000-8000-000000000571', v_to
      );
      SELECT status INTO v_status FROM public.spare_part_requests
      WHERE request_no = 'SPR-V57M';
      PERFORM pg_temp.check(
        v_result = CASE WHEN v_allowed THEN 'ok' ELSE '23514' END
          AND v_status = CASE WHEN v_allowed THEN v_to ELSE v_from END,
        format('%s -> %s %s', v_from, v_to,
          CASE WHEN v_allowed THEN 'allowed' ELSE 'rejected' END)
      );
    END LOOP;
  END LOOP;
END;
$$;

INSERT INTO public.spare_part_requests (id, request_no, site_id, status)
VALUES ('90000001-0000-4000-8000-000000000057', 'SPR-V571',
        '50000000-0000-4000-8000-000000000057', 'requested');

-- Engineers cannot approve, even though the command accepts internal actors.
SELECT pg_temp.check(
  pg_temp.patch_state('90000001-0000-4000-8000-000000000057', 'a0000000-0000-4000-8000-000000000572', 'approved') = '42501',
  'engineer approval is rejected by the database'
);
SELECT pg_temp.check(
  (SELECT status FROM public.spare_part_requests WHERE request_no = 'SPR-V571') = 'requested',
  'rejected approval leaves the request requested'
);
SELECT pg_temp.check(
  pg_temp.patch_state('90000001-0000-4000-8000-000000000057', 'a0000000-0000-4000-8000-000000000572', 'cancelled') = 'ok',
  'engineers may cancel a requested part request'
);

SELECT pg_temp.check(
  NOT has_function_privilege(r, 'public.spare_part_request_transition_allowed(text,text)', 'EXECUTE'),
  r || ' cannot execute the workflow helper'
) FROM unnest(ARRAY['anon', 'authenticated']) AS r;

ROLLBACK;
