-- Migration 056 — Synchronize compatibility authorization writes
--
-- Migration 055 created and backfilled the canonical customer_memberships and
-- customer_site_assignments roots, while production commands intentionally
-- continued to write users.customer_id and site_members. Without a bridge,
-- the first team/admin access change after the snapshot makes the canonical
-- resolver stale.
--
-- This migration preserves every current RPC signature and its already-live
-- actor/tenant/input guards. The prior functions are renamed and made
-- non-callable; service-only wrappers invoke them and then synchronize the
-- target user's complete compatibility access set into canonical rows in the
-- same transaction. Customer archival also synchronizes every external user
-- it deactivates. Canonical row identities and approval capabilities are
-- preserved, removed grants are closed instead of deleted, versions advance
-- only on a real change, and each changed canonical row receives one audit.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_customer_authorization_from_legacy(
  p_target_user_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_email text;
  v_actor_role text;
  v_target public.users%ROWTYPE;
  v_now timestamptz;
  v_source record;
  v_legacy_assignment record;
  v_membership_before public.customer_memberships%ROWTYPE;
  v_membership_after public.customer_memberships%ROWTYPE;
  v_assignment_before public.customer_site_assignments%ROWTYPE;
  v_assignment_after public.customer_site_assignments%ROWTYPE;
  v_membership_exists boolean;
  v_assignment_exists boolean;
  v_desired_organization_role text;
  v_desired_membership_status text;
  v_desired_ticket_scope text;
  v_desired_site_role text;
  v_memberships_changed integer := 0;
  v_assignments_changed integer := 0;
BEGIN
  IF p_target_user_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Target user and actor are required'
      USING ERRCODE = '22023';
  END IF;

  -- This global bridge lock keeps canonical row acquisition deterministic
  -- across the seven legacy commands while their existing target locks remain
  -- the primary same-user serialization boundary.
  PERFORM pg_catalog.pg_advisory_xact_lock(71618056001::bigint);

  SELECT actor.email, actor.role
  INTO v_actor_email, v_actor_role
  FROM public.users AS actor
  WHERE actor.id = p_actor_id
    AND actor.status = 'active'
    AND actor.role IN ('admin', 'customer_manager')
  FOR SHARE OF actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active authorization administrator required'
      USING ERRCODE = '42501';
  END IF;

  SELECT target.*
  INTO v_target
  FROM public.users AS target
  WHERE target.id = p_target_user_id
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authorization target user not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock the current canonical graph in stable order before deriving changes.
  PERFORM 1
  FROM public.customer_memberships AS membership
  WHERE membership.user_id = p_target_user_id
  ORDER BY membership.customer_id, membership.id
  FOR UPDATE OF membership;

  PERFORM 1
  FROM public.customer_site_assignments AS assignment
  JOIN public.customer_memberships AS membership
    ON membership.id = assignment.membership_id
  WHERE membership.user_id = p_target_user_id
  ORDER BY assignment.customer_id, assignment.site_id, assignment.id
  FOR UPDATE OF assignment;

  -- Take the authorization boundary timestamp only after every serialization
  -- lock is held, so a queued command cannot backdate revocation/reactivation.
  v_now := pg_catalog.clock_timestamp();

  v_desired_membership_status := CASE v_target.status
    WHEN 'active' THEN 'active'
    WHEN 'invited' THEN 'invited'
    ELSE 'suspended'
  END;

  -- A compatibility source is the external user's home tenant plus every
  -- tenant reached through a regular customer's retained site memberships.
  -- Customer managers deliberately keep home-tenant organization scope only.
  FOR v_source IN
    WITH membership_sources AS MATERIALIZED (
      SELECT
        v_target.customer_id AS customer_id,
        TRUE AS is_home_customer
      WHERE v_target.role IN ('customer_manager', 'customer')
        AND v_target.customer_id IS NOT NULL

      UNION ALL

      SELECT
        site.customer_id,
        v_target.customer_id = site.customer_id AS is_home_customer
      FROM public.site_members AS legacy_assignment
      JOIN public.sites AS site
        ON site.id = legacy_assignment.site_id
      WHERE v_target.role = 'customer'
        AND legacy_assignment.user_id = p_target_user_id
    )
    SELECT
      source.customer_id,
      pg_catalog.bool_or(source.is_home_customer) AS is_home_customer
    FROM membership_sources AS source
    GROUP BY source.customer_id
    ORDER BY source.customer_id
  LOOP
    v_desired_organization_role := CASE
      WHEN v_target.role = 'customer_manager'
        AND v_source.is_home_customer
        THEN 'organization_admin'
      WHEN EXISTS (
        SELECT 1
        FROM public.site_members AS legacy_assignment
        JOIN public.sites AS site
          ON site.id = legacy_assignment.site_id
        WHERE legacy_assignment.user_id = p_target_user_id
          AND site.customer_id = v_source.customer_id
          AND legacy_assignment.role IN ('owner', 'manager')
      ) THEN 'site_admin'
      WHEN EXISTS (
        SELECT 1
        FROM public.site_members AS legacy_assignment
        JOIN public.sites AS site
          ON site.id = legacy_assignment.site_id
        WHERE legacy_assignment.user_id = p_target_user_id
          AND site.customer_id = v_source.customer_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.site_members AS legacy_assignment
        JOIN public.sites AS site
          ON site.id = legacy_assignment.site_id
        WHERE legacy_assignment.user_id = p_target_user_id
          AND site.customer_id = v_source.customer_id
          AND legacy_assignment.role <> 'viewer'
      ) THEN 'viewer'
      ELSE 'requester'
    END;

    v_desired_ticket_scope := CASE
      WHEN v_target.role = 'customer_manager'
        AND v_source.is_home_customer
        THEN 'CUSTOMER'
      ELSE 'SITE'
    END;

    SELECT membership.*
    INTO v_membership_before
    FROM public.customer_memberships AS membership
    WHERE membership.user_id = p_target_user_id
      AND membership.customer_id = v_source.customer_id
    FOR UPDATE OF membership;
    v_membership_exists := FOUND;

    IF NOT v_membership_exists THEN
      INSERT INTO public.customer_memberships (
        user_id,
        customer_id,
        organization_role,
        status,
        ticket_visibility_scope,
        effective_from,
        created_by,
        approved_by
      )
      VALUES (
        p_target_user_id,
        v_source.customer_id,
        v_desired_organization_role,
        v_desired_membership_status,
        v_desired_ticket_scope,
        v_target.created_at,
        p_actor_id,
        p_actor_id
      )
      RETURNING * INTO v_membership_after;

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
        'customer_membership',
        v_membership_after.id,
        'created',
        'authorization_snapshot',
        NULL,
        pg_catalog.to_jsonb(v_membership_after)::text,
        pg_catalog.jsonb_build_object(
          'command', 'sync_customer_authorization_from_legacy',
          'target_user_id', p_target_user_id,
          'customer_id', v_source.customer_id,
          'version', v_membership_after.version
        )
      );
      v_memberships_changed := v_memberships_changed + 1;
    ELSIF
      v_membership_before.organization_role IS DISTINCT FROM
        v_desired_organization_role
      OR v_membership_before.status IS DISTINCT FROM
        v_desired_membership_status
      OR v_membership_before.ticket_visibility_scope IS DISTINCT FROM
        v_desired_ticket_scope
      OR v_membership_before.effective_to IS NOT NULL
      OR v_membership_before.revoked_by IS NOT NULL
    THEN
      UPDATE public.customer_memberships AS membership
      SET
        organization_role = v_desired_organization_role,
        status = v_desired_membership_status,
        ticket_visibility_scope = v_desired_ticket_scope,
        effective_from = CASE
          WHEN v_membership_before.status = 'revoked'
            OR v_membership_before.effective_to IS NOT NULL
            THEN v_now
          ELSE v_membership_before.effective_from
        END,
        effective_to = NULL,
        revoked_by = NULL,
        version = v_membership_before.version + 1,
        updated_at = v_now
      WHERE membership.id = v_membership_before.id
      RETURNING * INTO v_membership_after;

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
        'customer_membership',
        v_membership_after.id,
        CASE
          WHEN v_membership_before.status = 'revoked'
            OR v_membership_before.effective_to IS NOT NULL
            THEN 'reactivated'
          ELSE 'updated'
        END,
        'authorization_snapshot',
        pg_catalog.to_jsonb(v_membership_before)::text,
        pg_catalog.to_jsonb(v_membership_after)::text,
        pg_catalog.jsonb_build_object(
          'command', 'sync_customer_authorization_from_legacy',
          'target_user_id', p_target_user_id,
          'customer_id', v_source.customer_id,
          'version', v_membership_after.version
        )
      );
      v_memberships_changed := v_memberships_changed + 1;
    END IF;
  END LOOP;

  -- Synchronize every current regular-customer site grant. Retained canonical
  -- rows are reactivated in place rather than replaced.
  FOR v_legacy_assignment IN
    SELECT
      legacy_assignment.id AS legacy_assignment_id,
      legacy_assignment.site_id,
      legacy_assignment.role,
      legacy_assignment.created_at,
      site.customer_id,
      membership.id AS membership_id
    FROM public.site_members AS legacy_assignment
    JOIN public.sites AS site
      ON site.id = legacy_assignment.site_id
    JOIN public.customer_memberships AS membership
      ON membership.user_id = legacy_assignment.user_id
     AND membership.customer_id = site.customer_id
    WHERE v_target.role = 'customer'
      AND legacy_assignment.user_id = p_target_user_id
    ORDER BY site.customer_id, legacy_assignment.site_id
  LOOP
    v_desired_site_role := CASE v_legacy_assignment.role
      WHEN 'owner' THEN 'site_admin'
      WHEN 'manager' THEN 'site_admin'
      WHEN 'viewer' THEN 'viewer'
      ELSE 'requester'
    END;

    SELECT assignment.*
    INTO v_assignment_before
    FROM public.customer_site_assignments AS assignment
    WHERE assignment.membership_id = v_legacy_assignment.membership_id
      AND assignment.site_id = v_legacy_assignment.site_id
    FOR UPDATE OF assignment;
    v_assignment_exists := FOUND;

    IF NOT v_assignment_exists THEN
      INSERT INTO public.customer_site_assignments (
        membership_id,
        customer_id,
        site_id,
        site_role,
        object_scope,
        effective_from,
        created_by
      )
      VALUES (
        v_legacy_assignment.membership_id,
        v_legacy_assignment.customer_id,
        v_legacy_assignment.site_id,
        v_desired_site_role,
        'SITE',
        v_legacy_assignment.created_at,
        p_actor_id
      )
      RETURNING * INTO v_assignment_after;

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
        'customer_site_assignment',
        v_assignment_after.id,
        'created',
        'authorization_snapshot',
        NULL,
        pg_catalog.to_jsonb(v_assignment_after)::text,
        pg_catalog.jsonb_build_object(
          'command', 'sync_customer_authorization_from_legacy',
          'target_user_id', p_target_user_id,
          'legacy_assignment_id',
            v_legacy_assignment.legacy_assignment_id,
          'membership_id', v_assignment_after.membership_id,
          'customer_id', v_assignment_after.customer_id,
          'site_id', v_assignment_after.site_id,
          'version', v_assignment_after.version
        )
      );
      v_assignments_changed := v_assignments_changed + 1;
    ELSIF
      v_assignment_before.site_role IS DISTINCT FROM v_desired_site_role
      OR v_assignment_before.object_scope IS DISTINCT FROM 'SITE'
      OR v_assignment_before.effective_to IS NOT NULL
      OR v_assignment_before.revoked_by IS NOT NULL
    THEN
      UPDATE public.customer_site_assignments AS assignment
      SET
        site_role = v_desired_site_role,
        object_scope = 'SITE',
        effective_from = CASE
          WHEN v_assignment_before.effective_to IS NOT NULL
            THEN v_now
          ELSE v_assignment_before.effective_from
        END,
        effective_to = NULL,
        revoked_by = NULL,
        version = v_assignment_before.version + 1,
        updated_at = v_now
      WHERE assignment.id = v_assignment_before.id
      RETURNING * INTO v_assignment_after;

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
        'customer_site_assignment',
        v_assignment_after.id,
        CASE
          WHEN v_assignment_before.effective_to IS NOT NULL
            THEN 'reactivated'
          ELSE 'updated'
        END,
        'authorization_snapshot',
        pg_catalog.to_jsonb(v_assignment_before)::text,
        pg_catalog.to_jsonb(v_assignment_after)::text,
        pg_catalog.jsonb_build_object(
          'command', 'sync_customer_authorization_from_legacy',
          'target_user_id', p_target_user_id,
          'legacy_assignment_id',
            v_legacy_assignment.legacy_assignment_id,
          'membership_id', v_assignment_after.membership_id,
          'customer_id', v_assignment_after.customer_id,
          'site_id', v_assignment_after.site_id,
          'version', v_assignment_after.version
        )
      );
      v_assignments_changed := v_assignments_changed + 1;
    END IF;
  END LOOP;

  -- Close grants that the compatibility model no longer supplies. Assignment
  -- history is retained so a later re-add can reactivate the same row.
  FOR v_assignment_before IN
    SELECT assignment.*
    FROM public.customer_site_assignments AS assignment
    JOIN public.customer_memberships AS membership
      ON membership.id = assignment.membership_id
    WHERE membership.user_id = p_target_user_id
      AND assignment.effective_to IS NULL
      AND NOT (
        v_target.role = 'customer'
        AND EXISTS (
          SELECT 1
          FROM public.site_members AS legacy_assignment
          JOIN public.sites AS site
            ON site.id = legacy_assignment.site_id
          WHERE legacy_assignment.user_id = p_target_user_id
            AND legacy_assignment.site_id = assignment.site_id
            AND site.customer_id = assignment.customer_id
        )
      )
    ORDER BY assignment.customer_id, assignment.site_id, assignment.id
    FOR UPDATE OF assignment
  LOOP
    UPDATE public.customer_site_assignments AS assignment
    SET
      effective_to = CASE
        WHEN v_now > v_assignment_before.effective_from THEN v_now
        ELSE v_assignment_before.effective_from + INTERVAL '1 microsecond'
      END,
      revoked_by = p_actor_id,
      version = v_assignment_before.version + 1,
      updated_at = v_now
    WHERE assignment.id = v_assignment_before.id
    RETURNING * INTO v_assignment_after;

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
      'customer_site_assignment',
      v_assignment_after.id,
      'revoked',
      'authorization_snapshot',
      pg_catalog.to_jsonb(v_assignment_before)::text,
      pg_catalog.to_jsonb(v_assignment_after)::text,
      pg_catalog.jsonb_build_object(
        'command', 'sync_customer_authorization_from_legacy',
        'target_user_id', p_target_user_id,
        'membership_id', v_assignment_after.membership_id,
        'customer_id', v_assignment_after.customer_id,
        'site_id', v_assignment_after.site_id,
        'version', v_assignment_after.version
      )
    );
    v_assignments_changed := v_assignments_changed + 1;
  END LOOP;

  -- A non-home membership with no retained site path no longer exists in the
  -- compatibility model. Revoke it; keep home memberships for regular
  -- customers even when their assignment set is empty.
  FOR v_membership_before IN
    SELECT membership.*
    FROM public.customer_memberships AS membership
    WHERE membership.user_id = p_target_user_id
      AND (
        membership.status <> 'revoked'
        OR membership.effective_to IS NULL
      )
      AND NOT (
        (
          v_target.role IN ('customer_manager', 'customer')
          AND v_target.customer_id IS NOT NULL
          AND membership.customer_id = v_target.customer_id
        )
        OR (
          v_target.role = 'customer'
          AND EXISTS (
            SELECT 1
            FROM public.site_members AS legacy_assignment
            JOIN public.sites AS site
              ON site.id = legacy_assignment.site_id
            WHERE legacy_assignment.user_id = p_target_user_id
              AND site.customer_id = membership.customer_id
          )
        )
      )
    ORDER BY membership.customer_id, membership.id
    FOR UPDATE OF membership
  LOOP
    UPDATE public.customer_memberships AS membership
    SET
      status = 'revoked',
      effective_to = CASE
        WHEN v_now > v_membership_before.effective_from THEN v_now
        ELSE v_membership_before.effective_from + INTERVAL '1 microsecond'
      END,
      revoked_by = p_actor_id,
      version = v_membership_before.version + 1,
      updated_at = v_now
    WHERE membership.id = v_membership_before.id
    RETURNING * INTO v_membership_after;

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
      'customer_membership',
      v_membership_after.id,
      'revoked',
      'authorization_snapshot',
      pg_catalog.to_jsonb(v_membership_before)::text,
      pg_catalog.to_jsonb(v_membership_after)::text,
      pg_catalog.jsonb_build_object(
        'command', 'sync_customer_authorization_from_legacy',
        'target_user_id', p_target_user_id,
        'customer_id', v_membership_after.customer_id,
        'version', v_membership_after.version
      )
    );
    v_memberships_changed := v_memberships_changed + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'target_user_id', p_target_user_id,
    'memberships_changed', v_memberships_changed,
    'assignments_changed', v_assignments_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_customer_authorization_from_legacy(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the verified implementations behind names that no API role can
-- execute. The wrappers below keep every current application RPC contract.
ALTER FUNCTION public.apply_team_member_patch(uuid, uuid, jsonb, jsonb)
  RENAME TO apply_team_member_patch_legacy_056;
ALTER FUNCTION public.add_admin_site_membership_atomic(uuid, uuid, uuid, text)
  RENAME TO add_admin_site_membership_atomic_legacy_056;
ALTER FUNCTION public.remove_admin_site_membership_atomic(uuid, uuid)
  RENAME TO remove_admin_site_membership_atomic_legacy_056;
ALTER FUNCTION public.apply_admin_user_patch(uuid, uuid, jsonb)
  RENAME TO apply_admin_user_patch_legacy_056;
ALTER FUNCTION public.deactivate_users(uuid[], uuid)
  RENAME TO deactivate_users_legacy_056;
ALTER FUNCTION public.finalize_team_user_creation(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) RENAME TO finalize_team_user_creation_legacy_056;
ALTER FUNCTION public.archive_customers(uuid[], uuid)
  RENAME TO archive_customers_legacy_056;

REVOKE ALL ON FUNCTION public.apply_team_member_patch_legacy_056(
  uuid,
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_admin_site_membership_atomic_legacy_056(
  uuid,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_admin_site_membership_atomic_legacy_056(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_admin_user_patch_legacy_056(
  uuid,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deactivate_users_legacy_056(
  uuid[],
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_team_user_creation_legacy_056(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.archive_customers_legacy_056(
  uuid[],
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.apply_team_member_patch(
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
  v_result uuid;
BEGIN
  v_result := public.apply_team_member_patch_legacy_056(
    p_actor_id,
    p_target_user_id,
    p_patch,
    p_site_ids
  );
  PERFORM public.sync_customer_authorization_from_legacy(
    p_target_user_id,
    p_actor_id
  );
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.add_admin_site_membership_atomic(
  p_actor_id uuid,
  p_user_id uuid,
  p_site_id uuid,
  p_role text DEFAULT 'member'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result uuid;
BEGIN
  v_result := public.add_admin_site_membership_atomic_legacy_056(
    p_actor_id,
    p_user_id,
    p_site_id,
    p_role
  );
  PERFORM public.sync_customer_authorization_from_legacy(
    p_user_id,
    p_actor_id
  );
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.remove_admin_site_membership_atomic(
  p_actor_id uuid,
  p_membership_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result uuid;
  v_target_user_id uuid;
BEGIN
  SELECT membership.user_id
  INTO v_target_user_id
  FROM public.site_members AS membership
  WHERE membership.id = p_membership_id;

  v_result := public.remove_admin_site_membership_atomic_legacy_056(
    p_actor_id,
    p_membership_id
  );
  PERFORM public.sync_customer_authorization_from_legacy(
    v_target_user_id,
    p_actor_id
  );
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.apply_admin_user_patch(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_patch jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result uuid;
BEGIN
  v_result := public.apply_admin_user_patch_legacy_056(
    p_actor_id,
    p_target_user_id,
    p_patch
  );
  PERFORM public.sync_customer_authorization_from_legacy(
    p_target_user_id,
    p_actor_id
  );
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.deactivate_users(
  p_ids uuid[],
  p_actor_id uuid
)
RETURNS TABLE(users_changed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_user_id uuid;
  v_users_changed integer;
BEGIN
  SELECT legacy.users_changed
  INTO v_users_changed
  FROM public.deactivate_users_legacy_056(p_ids, p_actor_id) AS legacy;

  FOR v_target_user_id IN
    SELECT DISTINCT supplied.id
    FROM pg_catalog.unnest(p_ids) AS supplied(id)
    ORDER BY supplied.id
  LOOP
    PERFORM public.sync_customer_authorization_from_legacy(
      v_target_user_id,
      p_actor_id
    );
  END LOOP;

  RETURN QUERY SELECT v_users_changed;
END;
$$;

CREATE FUNCTION public.finalize_team_user_creation(
  p_actor_id uuid,
  p_target_user_id uuid,
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
  v_result uuid;
BEGIN
  v_result := public.finalize_team_user_creation_legacy_056(
    p_actor_id,
    p_target_user_id,
    p_full_name,
    p_phone,
    p_site_ids
  );
  PERFORM public.sync_customer_authorization_from_legacy(
    p_target_user_id,
    p_actor_id
  );
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.archive_customers(
  p_ids uuid[],
  p_actor_id uuid
)
RETURNS TABLE(
  customers_changed integer,
  sites_changed integer,
  users_changed integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_user_id uuid;
  v_customers_changed integer;
  v_sites_changed integer;
  v_users_changed integer;
BEGIN
  SELECT
    legacy.customers_changed,
    legacy.sites_changed,
    legacy.users_changed
  INTO
    v_customers_changed,
    v_sites_changed,
    v_users_changed
  FROM public.archive_customers_legacy_056(p_ids, p_actor_id) AS legacy;

  FOR v_target_user_id IN
    SELECT target.id
    FROM public.users AS target
    WHERE target.customer_id = ANY(p_ids)
      AND target.role IN ('customer_manager', 'customer')
    ORDER BY target.id
  LOOP
    PERFORM public.sync_customer_authorization_from_legacy(
      v_target_user_id,
      p_actor_id
    );
  END LOOP;

  RETURN QUERY
  SELECT v_customers_changed, v_sites_changed, v_users_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_admin_site_membership_atomic(
  uuid,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_admin_site_membership_atomic(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_user_patch(
  uuid,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_users(
  uuid[],
  uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_team_user_creation(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_customers(
  uuid[],
  uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_admin_site_membership_atomic(
  uuid,
  uuid,
  uuid,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_admin_site_membership_atomic(
  uuid,
  uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_user_patch(
  uuid,
  uuid,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_users(
  uuid[],
  uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_team_user_creation(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_customers(
  uuid[],
  uuid
) TO service_role;

COMMENT ON FUNCTION public.sync_customer_authorization_from_legacy(
  uuid,
  uuid
) IS
  'Internal migration-056 bridge that derives canonical memberships and site assignments from one user compatibility graph with versions and exact audit.';
COMMENT ON FUNCTION public.apply_team_member_patch(
  uuid,
  uuid,
  jsonb,
  jsonb
) IS
  'Migration-056 wrapper: atomically applies the verified team patch and synchronizes canonical customer authorization.';
COMMENT ON FUNCTION public.add_admin_site_membership_atomic(
  uuid,
  uuid,
  uuid,
  text
) IS
  'Migration-056 wrapper: atomically adds verified legacy site access and synchronizes canonical customer authorization.';
COMMENT ON FUNCTION public.remove_admin_site_membership_atomic(
  uuid,
  uuid
) IS
  'Migration-056 wrapper: atomically removes verified legacy site access and closes the canonical assignment.';
COMMENT ON FUNCTION public.apply_admin_user_patch(
  uuid,
  uuid,
  jsonb
) IS
  'Migration-056 wrapper: atomically applies the verified admin user patch and synchronizes canonical lifecycle and roles.';
COMMENT ON FUNCTION public.deactivate_users(
  uuid[],
  uuid
) IS
  'Migration-056 wrapper: atomically deactivates users and suspends their canonical memberships.';
COMMENT ON FUNCTION public.finalize_team_user_creation(
  uuid,
  uuid,
  text,
  text,
  uuid[]
) IS
  'Migration-056 wrapper: atomically finalizes the verified team user and creates canonical membership and site assignments.';
COMMENT ON FUNCTION public.archive_customers(
  uuid[],
  uuid
) IS
  'Migration-056 wrapper: atomically archives verified customer aggregates and suspends every affected canonical external membership.';

COMMIT;
