-- Migration 037 — Repair qualified SQL expressions in atomic commands
--
-- Migrations 029, 030, 031, and 036 qualified COALESCE and NULLIF as though
-- they were ordinary pg_catalog functions. PostgreSQL implements both as SQL
-- expressions, so affected command paths fail with 42883 when those branches
-- execute. Positive staging probes were unavailable when the migrations were
-- introduced, which allowed the latent failures through contract-only gates.
--
-- Repair only the six allowlisted current command definitions. Reading the
-- deployed definitions preserves their complete bodies, defaults, security
-- mode, and empty search paths; the transaction rolls back if any expected
-- command is missing or a replacement cannot be compiled. Explicit grants are
-- re-hardened after replacement.

BEGIN;

DO $migration$
DECLARE
  v_signature text;
  v_command regprocedure;
  v_definition text;
  v_repaired text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_spare_part_request_atomic(uuid,jsonb,jsonb)',
    'public.create_field_service_order_atomic(uuid,jsonb,jsonb)',
    'public.apply_field_service_order_patch(uuid,uuid,jsonb,jsonb)',
    'public.apply_team_member_patch(uuid,uuid,jsonb,jsonb)',
    'public.create_admin_site_atomic(uuid,jsonb)',
    'public.apply_admin_site_patch(uuid,uuid,jsonb)'
  ]
  LOOP
    v_command := pg_catalog.to_regprocedure(v_signature);

    IF v_command IS NULL THEN
      RAISE EXCEPTION 'Expected command is missing: %', v_signature
        USING ERRCODE = '42883';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_command);
    v_repaired := pg_catalog.replace(
      pg_catalog.replace(
        v_definition,
        'pg_catalog.coalesce(',
        'COALESCE('
      ),
      'pg_catalog.nullif(',
      'NULLIF('
    );

    IF v_repaired IS DISTINCT FROM v_definition THEN
      EXECUTE v_repaired;
    END IF;
  END LOOP;
END;
$migration$;

REVOKE ALL ON FUNCTION public.create_spare_part_request_atomic(
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_field_service_order_atomic(
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_field_service_order_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_admin_site_atomic(
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_site_patch(
  uuid,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_spare_part_request_atomic(
  uuid,
  jsonb,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_field_service_order_atomic(
  uuid,
  jsonb,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_field_service_order_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_admin_site_atomic(
  uuid,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_site_patch(
  uuid,
  uuid,
  jsonb
) TO service_role;

COMMIT;
