-- Migration 025 — Archive lifecycle + active-account enforcement
--
-- P0-G / SEC-006:
--   Retire physical customer, site, and user deletion. The domain functions
--   below preserve historical records and write the lifecycle audit entries
--   in the same PostgreSQL transaction as the status changes.
--
-- Additional containment discovered while implementing deactivation:
--   A public.users status change did not stop an existing JWT from using
--   direct PostgREST/Storage policies. Restrictive RLS policies now make
--   status='active' a mandatory condition for authenticated database access.
--
-- Apply after 024_create_sla_policies.sql.

-- ---------------------------------------------------------------------------
-- Active-account policy guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_is_active()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated;

-- A RESTRICTIVE policy is ANDed with every permissive policy on the table.
-- This closes existing-session and direct-PostgREST access without having to
-- duplicate account-state checks inside every historical policy.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customers',
    'sites',
    'users',
    'site_members',
    'tickets',
    'ticket_comments',
    'ticket_attachments',
    'ticket_events',
    'slack_channels',
    'slack_messages',
    'ai_suggestions',
    'knowledge_articles',
    'ticket_embeddings',
    'knowledge_embeddings',
    'spare_parts',
    'spare_part_inventory',
    'spare_part_requests',
    'spare_part_request_items',
    'field_service_orders',
    'field_service_engineers',
    'audit_logs',
    'sla_policies'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'Active accounts only',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT public.current_user_is_active()))
       WITH CHECK ((SELECT public.current_user_is_active()))',
      'Active accounts only',
      table_name
    );
  END LOOP;
END;
$$;

-- Archived/decommissioned tenant objects remain available to internal users
-- for historical support work, but external users must not reach them through
-- a still-valid membership or a direct PostgREST request.
CREATE OR REPLACE FUNCTION public.site_is_active(target_site_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sites
    WHERE id = target_site_id
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.ticket_site_is_active(target_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.sites s ON s.id = t.site_id
    WHERE t.id = target_ticket_id
      AND s.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.part_request_site_is_active(target_request_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.spare_part_requests r
    JOIN public.sites s ON s.id = r.site_id
    WHERE r.id = target_request_id
      AND s.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.field_order_site_is_active(target_order_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.field_service_orders o
    JOIN public.sites s ON s.id = o.site_id
    WHERE o.id = target_order_id
      AND s.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.site_is_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ticket_site_is_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.part_request_site_is_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.field_order_site_is_active(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.site_is_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_site_is_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.part_request_site_is_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.field_order_site_is_active(uuid) TO authenticated;

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.customers;
CREATE POLICY "External lifecycle visibility"
  ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR status IN ('active', 'trial')
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.sites;
CREATE POLICY "External lifecycle visibility"
  ON public.sites AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR status = 'active'
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.site_members;
CREATE POLICY "External lifecycle visibility"
  ON public.site_members AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.site_is_active(site_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.tickets;
CREATE POLICY "External lifecycle visibility"
  ON public.tickets AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.site_is_active(site_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.ticket_comments;
CREATE POLICY "External lifecycle visibility"
  ON public.ticket_comments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.ticket_site_is_active(ticket_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.ticket_attachments;
CREATE POLICY "External lifecycle visibility"
  ON public.ticket_attachments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.ticket_site_is_active(ticket_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.ticket_events;
CREATE POLICY "External lifecycle visibility"
  ON public.ticket_events AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.ticket_site_is_active(ticket_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.spare_part_inventory;
CREATE POLICY "External lifecycle visibility"
  ON public.spare_part_inventory AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.site_is_active(site_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.spare_part_requests;
CREATE POLICY "External lifecycle visibility"
  ON public.spare_part_requests AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.site_is_active(site_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.spare_part_request_items;
CREATE POLICY "External lifecycle visibility"
  ON public.spare_part_request_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.part_request_site_is_active(request_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.field_service_orders;
CREATE POLICY "External lifecycle visibility"
  ON public.field_service_orders AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.site_is_active(site_id))
  );

DROP POLICY IF EXISTS "External lifecycle visibility" ON public.field_service_engineers;
CREATE POLICY "External lifecycle visibility"
  ON public.field_service_engineers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (SELECT public.field_order_site_is_active(order_id))
  );

-- The application uploads and signs attachment objects through server routes.
-- Direct bucket access is authenticated-only and also obeys public.users
-- account state. Guest uploads continue through /api/upload using service_role.
DROP POLICY IF EXISTS "Users can upload attachments" ON storage.objects;
CREATE POLICY "Users can upload attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ripple-attachments'
    AND (SELECT public.current_user_is_active())
  );

DROP POLICY IF EXISTS "Users can read attachments" ON storage.objects;
CREATE POLICY "Users can read attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ripple-attachments'
    AND (SELECT public.current_user_is_active())
  );

-- Customer ticket creation is routed through the validated application API.
-- The old direct-table policies allowed arbitrary anonymous ticket rows and
-- attribution fields, bypassing Zod, rate limiting, scope, and audit logic.
DROP POLICY IF EXISTS "Anyone can create tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users create site tickets" ON public.tickets;
DROP POLICY IF EXISTS "View ticket by secure token" ON public.tickets;
REVOKE INSERT, UPDATE, DELETE ON public.tickets FROM anon, authenticated;

-- Keep self-service profile edits limited to the fields exposed by the
-- profile page. RLS identifies the row; column privileges constrain fields.
REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (full_name, phone, avatar_url) ON public.users TO authenticated;

-- ---------------------------------------------------------------------------
-- Transactional archive/deactivation commands
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.archive_customers(
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_missing_ids uuid[];
  v_actor_email text;
  v_actor_role text;
  v_customers_changed integer := 0;
  v_sites_changed integer := 0;
  v_users_changed integer := 0;
BEGIN
  SELECT email, role
  INTO v_actor_email, v_actor_role
  FROM public.users
  WHERE id = p_actor_id
    AND role = 'admin'
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active admin account required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (SELECT DISTINCT unnest(p_ids) AS id) requested;

  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'Archive batch must contain 1 to 200 unique ids'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(requested_id)
  INTO v_missing_ids
  FROM unnest(v_ids) AS requested_id
  LEFT JOIN public.customers c ON c.id = requested_id
  WHERE c.id IS NULL;

  IF v_missing_ids IS NOT NULL THEN
    RAISE EXCEPTION 'One or more customers no longer exist'
      USING ERRCODE = 'P0002';
  END IF;

  WITH previous AS MATERIALIZED (
    SELECT id, status AS old_status, customer_id
    FROM public.sites
    WHERE customer_id = ANY(v_ids)
      AND status <> 'decommissioned'
  ),
  updated AS (
    UPDATE public.sites AS s
    SET status = 'decommissioned'
    FROM previous
    WHERE s.id = previous.id
    RETURNING s.id, previous.old_status, previous.customer_id
  ),
  logged AS (
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    )
    SELECT
      p_actor_id, v_actor_email, v_actor_role, 'site', id,
      'archived', 'status', old_status, 'decommissioned',
      jsonb_build_object(
        'source', 'bulk-archive',
        'parent_customer_id', customer_id
      )
    FROM updated
    RETURNING id
  )
  SELECT count(*)::integer INTO v_sites_changed FROM logged;

  WITH previous AS MATERIALIZED (
    SELECT id, status AS old_status, customer_id
    FROM public.users
    WHERE customer_id = ANY(v_ids)
      AND role IN ('customer_manager', 'customer')
      AND status <> 'inactive'
  ),
  updated AS (
    UPDATE public.users AS u
    SET status = 'inactive'
    FROM previous
    WHERE u.id = previous.id
    RETURNING u.id, previous.old_status, previous.customer_id
  ),
  logged AS (
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    )
    SELECT
      p_actor_id, v_actor_email, v_actor_role, 'user', id,
      'deactivated', 'status', old_status, 'inactive',
      jsonb_build_object(
        'source', 'customer-archive',
        'parent_customer_id', customer_id
      )
    FROM updated
    RETURNING id
  )
  SELECT count(*)::integer INTO v_users_changed FROM logged;

  WITH previous AS MATERIALIZED (
    SELECT id, status AS old_status
    FROM public.customers
    WHERE id = ANY(v_ids)
      AND status <> 'inactive'
  ),
  updated AS (
    UPDATE public.customers AS c
    SET status = 'inactive'
    FROM previous
    WHERE c.id = previous.id
    RETURNING c.id, previous.old_status
  ),
  logged AS (
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    )
    SELECT
      p_actor_id, v_actor_email, v_actor_role, 'customer', id,
      'archived', 'status', old_status, 'inactive',
      jsonb_build_object('source', 'bulk-archive')
    FROM updated
    RETURNING id
  )
  SELECT count(*)::integer INTO v_customers_changed FROM logged;

  RETURN QUERY
  SELECT v_customers_changed, v_sites_changed, v_users_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_sites(
  p_ids uuid[],
  p_actor_id uuid
)
RETURNS TABLE(sites_changed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_missing_ids uuid[];
  v_actor_email text;
  v_actor_role text;
  v_sites_changed integer := 0;
BEGIN
  SELECT email, role
  INTO v_actor_email, v_actor_role
  FROM public.users
  WHERE id = p_actor_id
    AND role = 'admin'
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active admin account required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (SELECT DISTINCT unnest(p_ids) AS id) requested;

  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'Archive batch must contain 1 to 200 unique ids'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(requested_id)
  INTO v_missing_ids
  FROM unnest(v_ids) AS requested_id
  LEFT JOIN public.sites s ON s.id = requested_id
  WHERE s.id IS NULL;

  IF v_missing_ids IS NOT NULL THEN
    RAISE EXCEPTION 'One or more sites no longer exist'
      USING ERRCODE = 'P0002';
  END IF;

  WITH previous AS MATERIALIZED (
    SELECT id, status AS old_status
    FROM public.sites
    WHERE id = ANY(v_ids)
      AND status <> 'decommissioned'
  ),
  updated AS (
    UPDATE public.sites AS s
    SET status = 'decommissioned'
    FROM previous
    WHERE s.id = previous.id
    RETURNING s.id, previous.old_status
  ),
  logged AS (
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    )
    SELECT
      p_actor_id, v_actor_email, v_actor_role, 'site', id,
      'archived', 'status', old_status, 'decommissioned',
      jsonb_build_object('source', 'bulk-archive')
    FROM updated
    RETURNING id
  )
  SELECT count(*)::integer INTO v_sites_changed FROM logged;

  RETURN QUERY SELECT v_sites_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_users(
  p_ids uuid[],
  p_actor_id uuid
)
RETURNS TABLE(users_changed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_missing_ids uuid[];
  v_actor_email text;
  v_actor_role text;
  v_users_changed integer := 0;
BEGIN
  SELECT email, role
  INTO v_actor_email, v_actor_role
  FROM public.users
  WHERE id = p_actor_id
    AND role = 'admin'
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active admin account required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (SELECT DISTINCT unnest(p_ids) AS id) requested;

  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'Deactivation batch must contain 1 to 200 unique ids'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_id = ANY(v_ids) THEN
    RAISE EXCEPTION 'An administrator cannot deactivate their own account'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(requested_id)
  INTO v_missing_ids
  FROM unnest(v_ids) AS requested_id
  LEFT JOIN public.users u ON u.id = requested_id
  WHERE u.id IS NULL;

  IF v_missing_ids IS NOT NULL THEN
    RAISE EXCEPTION 'One or more users no longer exist'
      USING ERRCODE = 'P0002';
  END IF;

  WITH previous AS MATERIALIZED (
    SELECT id, status AS old_status
    FROM public.users
    WHERE id = ANY(v_ids)
      AND status <> 'inactive'
  ),
  updated AS (
    UPDATE public.users AS u
    SET status = 'inactive'
    FROM previous
    WHERE u.id = previous.id
    RETURNING u.id, previous.old_status
  ),
  logged AS (
    INSERT INTO public.audit_logs (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, field_name, old_value, new_value, metadata
    )
    SELECT
      p_actor_id, v_actor_email, v_actor_role, 'user', id,
      'deactivated', 'status', old_status, 'inactive',
      jsonb_build_object('source', 'bulk-deactivate')
    FROM updated
    RETURNING id
  )
  SELECT count(*)::integer INTO v_users_changed FROM logged;

  RETURN QUERY SELECT v_users_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_customers(uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_sites(uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_users(uuid[], uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.archive_customers(uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_sites(uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_users(uuid[], uuid) TO service_role;

COMMENT ON FUNCTION public.archive_customers(uuid[], uuid) IS
  'Atomically archives customers, decommissions their sites, deactivates their
   external users, and records attributable audit entries without deleting
   historical service records.';

COMMENT ON FUNCTION public.archive_sites(uuid[], uuid) IS
  'Atomically decommissions sites and records attributable audit entries while
   preserving tickets, memberships, parts, and field-service history.';

COMMENT ON FUNCTION public.deactivate_users(uuid[], uuid) IS
  'Atomically deactivates users and records attributable audit entries while
   preserving auth identity and historical references.';
