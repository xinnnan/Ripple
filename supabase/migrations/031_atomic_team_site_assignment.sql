-- Migration 031 — Atomic team-member site assignment
--
-- Closes INT-006:
--   * profile/status changes, membership set-diff, and audit rows commit
--     together;
--   * retained memberships keep their existing owner/manager/member/viewer
--     role instead of being deleted and recreated as member;
--   * only active customer managers may change customer users in their own
--     active/trial tenant;
--   * every desired site must be active and belong to that same tenant.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_team_member_patch(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_patch jsonb,
  p_site_ids jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_actor_customer_id uuid;
  v_target public.users%ROWTYPE;
  v_after public.users%ROWTYPE;
  v_new_full_name text;
  v_new_status text;
  v_site_ids uuid[];
  v_site_id uuid;
  v_old_site_ids jsonb;
  v_new_site_ids jsonb;
BEGIN
  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
  THEN
    RAISE EXCEPTION 'Team member patch must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_site_ids IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_site_ids) <> 'array'
  THEN
    RAISE EXCEPTION 'Site assignments must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch = '{}'::jsonb AND p_site_ids IS NULL THEN
    RAISE EXCEPTION 'Team member update must contain a change'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN ('full_name', 'status')
  ) THEN
    RAISE EXCEPTION 'Team member patch contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF p_site_ids IS NOT NULL
    AND pg_catalog.jsonb_array_length(p_site_ids) > 100
  THEN
    RAISE EXCEPTION 'At most 100 sites may be assigned'
      USING ERRCODE = '22023';
  END IF;

  IF p_site_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_site_ids) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'Every site assignment must be a UUID string'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.role, u.customer_id
  INTO v_actor_email, v_actor_role, v_actor_customer_id
  FROM public.users AS u
  JOIN public.customers AS c ON c.id = u.customer_id
  WHERE u.id = p_actor_id
    AND u.status = 'active'
    AND u.role = 'customer_manager'
    AND c.status IN ('active', 'trial')
  FOR SHARE OF u, c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active customer manager account required'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.*
  INTO v_target
  FROM public.users AS u
  WHERE u.id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_target.customer_id IS DISTINCT FROM v_actor_customer_id
  THEN
    RAISE EXCEPTION 'Team member not found in customer organization'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target.role <> 'customer' THEN
    RAISE EXCEPTION 'Customer managers may modify customer users only'
      USING ERRCODE = '42501';
  END IF;

  v_new_full_name := CASE
    WHEN p_patch ? 'full_name'
      THEN pg_catalog.btrim(p_patch ->> 'full_name')
    ELSE v_target.full_name
  END;
  IF v_new_full_name IS NULL
    OR v_new_full_name = ''
    OR pg_catalog.char_length(v_new_full_name) > 200
  THEN
    RAISE EXCEPTION 'Team member name is required and must fit 200 characters'
      USING ERRCODE = '22023';
  END IF;

  v_new_status := CASE
    WHEN p_patch ? 'status' THEN p_patch ->> 'status'
    ELSE v_target.status
  END;
  IF v_new_status IS NULL
    OR v_new_status NOT IN ('active', 'inactive', 'invited')
  THEN
    RAISE EXCEPTION 'Unsupported team member status'
      USING ERRCODE = '22023';
  END IF;

  IF p_site_ids IS NOT NULL THEN
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(p_site_ids)
          AS supplied(value)
        GROUP BY supplied.value::uuid
        HAVING pg_catalog.count(*) > 1
      ) THEN
        RAISE EXCEPTION 'Duplicate site assignment'
          USING ERRCODE = '22023';
      END IF;

      SELECT pg_catalog.coalesce(
        pg_catalog.array_agg(supplied.value::uuid ORDER BY supplied.value::uuid),
        ARRAY[]::uuid[]
      )
      INTO v_site_ids
      FROM pg_catalog.jsonb_array_elements_text(p_site_ids)
        AS supplied(value);
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Every site assignment must be a UUID'
          USING ERRCODE = '22023';
    END;

    FOREACH v_site_id IN ARRAY v_site_ids
    LOOP
      PERFORM 1
      FROM public.sites AS s
      WHERE s.id = v_site_id
        AND s.customer_id = v_actor_customer_id
        AND s.status = 'active'
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Every assigned site must be active and in the customer organization'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    -- The target row lock serializes commands for this user. Lock existing
    -- child rows in stable site order as an additional guard for direct
    -- service-role maintenance that touches the same set.
    PERFORM 1
    FROM public.site_members AS sm
    WHERE sm.user_id = p_target_user_id
    ORDER BY sm.site_id
    FOR UPDATE;

    SELECT pg_catalog.coalesce(
      pg_catalog.jsonb_agg(sm.site_id ORDER BY sm.site_id),
      '[]'::jsonb
    )
    INTO v_old_site_ids
    FROM public.site_members AS sm
    WHERE sm.user_id = p_target_user_id;
  END IF;

  UPDATE public.users AS u
  SET
    full_name = v_new_full_name,
    status = v_new_status
  WHERE u.id = p_target_user_id
  RETURNING u.* INTO v_after;

  IF p_site_ids IS NOT NULL THEN
    DELETE FROM public.site_members AS sm
    WHERE sm.user_id = p_target_user_id
      AND NOT (sm.site_id = ANY(v_site_ids));

    INSERT INTO public.site_members (
      site_id,
      user_id,
      role
    )
    SELECT
      desired.site_id,
      p_target_user_id,
      'member'
    FROM pg_catalog.unnest(v_site_ids) AS desired(site_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.site_members AS sm
      WHERE sm.user_id = p_target_user_id
        AND sm.site_id = desired.site_id
    )
    ORDER BY desired.site_id;

    SELECT pg_catalog.coalesce(
      pg_catalog.jsonb_agg(sm.site_id ORDER BY sm.site_id),
      '[]'::jsonb
    )
    INTO v_new_site_ids
    FROM public.site_members AS sm
    WHERE sm.user_id = p_target_user_id;
  END IF;

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
  )
  SELECT
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'user',
    p_target_user_id,
    'updated',
    changed.field_name,
    changed.old_value,
    changed.new_value,
    pg_catalog.jsonb_build_object(
      'target_email', v_target.email,
      'customer_id', v_actor_customer_id,
      'command', 'apply_team_member_patch'
    )
  FROM (
    VALUES
      ('full_name', v_target.full_name, v_after.full_name),
      ('status', v_target.status::text, v_after.status::text)
  ) AS changed(field_name, old_value, new_value)
  WHERE changed.old_value IS DISTINCT FROM changed.new_value;

  IF p_site_ids IS NOT NULL
    AND v_old_site_ids IS DISTINCT FROM v_new_site_ids
  THEN
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
    )
    VALUES (
      p_actor_id,
      v_actor_email,
      v_actor_role,
      'user',
      p_target_user_id,
      'updated',
      'site_ids',
      v_old_site_ids::text,
      v_new_site_ids::text,
      pg_catalog.jsonb_build_object(
        'target_email', v_target.email,
        'customer_id', v_actor_customer_id,
        'command', 'apply_team_member_patch'
      )
    );
  END IF;

  RETURN p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) TO service_role;

COMMENT ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) IS
  'Atomically updates one customer team member, applies a validated site-set
   diff that preserves retained membership roles, and writes audit evidence.';

COMMIT;
