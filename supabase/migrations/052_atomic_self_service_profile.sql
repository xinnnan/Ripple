-- Migration 052 — Atomic self-service profile updates
--
-- The profile page historically wrote public.users directly through a
-- column-level authenticated grant. That path could not bind the profile
-- change to audit evidence, and it also exposed avatar_url even though the
-- product has no avatar-editing workflow. Move the supported full_name/phone
-- update behind a service-role-only, row-locked command and remove the final
-- direct authenticated business-table write path.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_actor_id uuid,
  p_full_name text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_actor_status text;
  v_old_full_name text;
  v_old_phone text;
  v_full_name text;
  v_phone text;
  v_changed_fields text[] := ARRAY[]::text[];
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Actor id is required'
      USING ERRCODE = '22023';
  END IF;

  v_full_name := pg_catalog.btrim(p_full_name);
  v_phone := NULLIF(
    pg_catalog.btrim(COALESCE(p_phone, '')),
    ''
  );

  IF v_full_name IS NULL
    OR pg_catalog.char_length(v_full_name) < 1
    OR pg_catalog.char_length(v_full_name) > 200
    OR v_full_name ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Full name is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.char_length(COALESCE(v_phone, '')) > 50
    OR COALESCE(v_phone, '') ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Phone is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.email,
    actor.role,
    actor.status,
    actor.full_name,
    actor.phone
  INTO
    v_actor_email,
    v_actor_role,
    v_actor_status,
    v_old_full_name,
    v_old_phone
  FROM public.users AS actor
  WHERE actor.id = p_actor_id
  FOR UPDATE OF actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_status <> 'active' THEN
    RAISE EXCEPTION 'Active account required'
      USING ERRCODE = '42501';
  END IF;

  IF v_old_full_name IS DISTINCT FROM v_full_name THEN
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'full_name');
  END IF;
  IF v_old_phone IS DISTINCT FROM v_phone THEN
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'phone');
  END IF;

  IF pg_catalog.cardinality(v_changed_fields) > 0 THEN
    UPDATE public.users AS target
    SET
      full_name = v_full_name,
      phone = v_phone
    WHERE target.id = p_actor_id;

    IF v_old_full_name IS DISTINCT FROM v_full_name THEN
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
      ) VALUES (
        p_actor_id,
        v_actor_email,
        v_actor_role,
        'user',
        p_actor_id,
        'updated',
        'full_name',
        v_old_full_name,
        v_full_name,
        pg_catalog.jsonb_build_object(
          'source', 'self-service',
          'command', 'update_own_profile'
        )
      );
    END IF;

    IF v_old_phone IS DISTINCT FROM v_phone THEN
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
      ) VALUES (
        p_actor_id,
        v_actor_email,
        v_actor_role,
        'user',
        p_actor_id,
        'updated',
        'phone',
        v_old_phone,
        v_phone,
        pg_catalog.jsonb_build_object(
          'source', 'self-service',
          'command', 'update_own_profile'
        )
      );
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', p_actor_id,
    'full_name', v_full_name,
    'phone', v_phone,
    'changed_fields', pg_catalog.to_jsonb(v_changed_fields)
  );
END;
$$;

-- The legacy policy and its column-level grant are no longer needed. Read
-- policies remain unchanged; Auth continues to own password/email identity.
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
REVOKE UPDATE (full_name, phone, avatar_url)
ON TABLE public.users
FROM authenticated;

REVOKE ALL ON FUNCTION public.update_own_profile(uuid, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(uuid, text, text)
TO service_role;

COMMENT ON FUNCTION public.update_own_profile(uuid, text, text) IS
  'Atomically updates the active caller profile and writes one audit row per changed field; service role only.';

COMMIT;
