-- Migration 055 — Customer membership and site-assignment foundation
--
-- The compatibility authorization model stores a single customer_id and one
-- global customer role on users. The PRD requires a user to hold independent
-- memberships in multiple customers, with a role, lifecycle, ticket scope,
-- optional approval capabilities, and per-site assignments for each one.
--
-- This migration is intentionally additive. It creates the new authorization
-- roots, snapshots every currently effective external access path, and denies
-- direct API-role access. Existing reads continue to use users.customer_id and
-- site_members until the policy evaluator and command APIs switch over in a
-- later migration.

BEGIN;

ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_id_customer_id_unique;
ALTER TABLE public.sites
  ADD CONSTRAINT sites_id_customer_id_unique UNIQUE (id, customer_id);

CREATE TABLE public.customer_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL
    REFERENCES public.customers(id) ON DELETE RESTRICT,
  organization_role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  ticket_visibility_scope text NOT NULL,
  approver_capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  effective_from timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  effective_to timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT customer_memberships_user_customer_unique
    UNIQUE (user_id, customer_id),
  CONSTRAINT customer_memberships_id_customer_unique
    UNIQUE (id, customer_id),
  CONSTRAINT customer_memberships_organization_role_check
    CHECK (
      organization_role IN (
        'organization_admin',
        'site_admin',
        'requester',
        'viewer'
      )
    ),
  CONSTRAINT customer_memberships_status_check
    CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  CONSTRAINT customer_memberships_ticket_visibility_scope_check
    CHECK (ticket_visibility_scope IN ('OWN', 'SITE', 'CUSTOMER')),
  CONSTRAINT customer_memberships_approver_capabilities_check
    CHECK (
      approver_capabilities <@ ARRAY[
        'onsite_appointment',
        'paid_service',
        'paid_parts',
        'out_of_scope_work'
      ]::text[]
    ),
  CONSTRAINT customer_memberships_effective_window_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT customer_memberships_version_check
    CHECK (version >= 1)
);

CREATE TABLE public.customer_site_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  site_id uuid NOT NULL,
  site_role text NOT NULL,
  object_scope text,
  effective_from timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  effective_to timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT customer_site_assignments_membership_site_unique
    UNIQUE (membership_id, site_id),
  CONSTRAINT customer_site_assignments_membership_customer_fkey
    FOREIGN KEY (membership_id, customer_id)
    REFERENCES public.customer_memberships(id, customer_id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_site_assignments_site_customer_fkey
    FOREIGN KEY (site_id, customer_id)
    REFERENCES public.sites(id, customer_id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_site_assignments_site_role_check
    CHECK (site_role IN ('site_admin', 'requester', 'viewer')),
  CONSTRAINT customer_site_assignments_object_scope_check
    CHECK (object_scope IS NULL OR object_scope IN ('OWN', 'SITE')),
  CONSTRAINT customer_site_assignments_effective_window_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT customer_site_assignments_version_check
    CHECK (version >= 1)
);

CREATE INDEX customer_memberships_customer_status_idx
  ON public.customer_memberships(customer_id, status, user_id);
CREATE INDEX customer_memberships_user_status_idx
  ON public.customer_memberships(user_id, status, customer_id);
CREATE INDEX customer_site_assignments_site_idx
  ON public.customer_site_assignments(site_id, membership_id);
CREATE INDEX customer_site_assignments_membership_idx
  ON public.customer_site_assignments(membership_id, site_id);

-- Backfill one membership for the compatibility home tenant and for every
-- customer reached by a regular customer's retained site memberships. The
-- latter preserves currently effective cross-customer assignments without
-- treating the legacy users.customer_id column as a permanent authorization
-- root. Customer managers retain only their home-tenant organization scope.
WITH membership_sources AS MATERIALIZED (
  SELECT
    app_user.id AS user_id,
    app_user.customer_id,
    TRUE AS is_home_customer
  FROM public.users AS app_user
  WHERE app_user.role IN ('customer_manager', 'customer')
    AND app_user.customer_id IS NOT NULL

  UNION ALL

  SELECT
    app_user.id AS user_id,
    site.customer_id,
    app_user.customer_id = site.customer_id AS is_home_customer
  FROM public.users AS app_user
  JOIN public.site_members AS legacy_assignment
    ON legacy_assignment.user_id = app_user.id
  JOIN public.sites AS site
    ON site.id = legacy_assignment.site_id
  WHERE app_user.role = 'customer'
), distinct_sources AS MATERIALIZED (
  SELECT
    source.user_id,
    source.customer_id,
    pg_catalog.bool_or(source.is_home_customer) AS is_home_customer
  FROM membership_sources AS source
  GROUP BY source.user_id, source.customer_id
), inserted_memberships AS (
  INSERT INTO public.customer_memberships (
    user_id,
    customer_id,
    organization_role,
    status,
    ticket_visibility_scope,
    effective_from
  )
  SELECT
    app_user.id,
    source.customer_id,
    CASE
      WHEN app_user.role = 'customer_manager'
        AND source.is_home_customer
        THEN 'organization_admin'
      WHEN EXISTS (
        SELECT 1
        FROM public.site_members AS legacy_assignment
        JOIN public.sites AS site
          ON site.id = legacy_assignment.site_id
        WHERE legacy_assignment.user_id = app_user.id
          AND site.customer_id = source.customer_id
          AND legacy_assignment.role IN ('owner', 'manager')
      ) THEN 'site_admin'
      WHEN EXISTS (
        SELECT 1
        FROM public.site_members AS legacy_assignment
        JOIN public.sites AS site
          ON site.id = legacy_assignment.site_id
        WHERE legacy_assignment.user_id = app_user.id
          AND site.customer_id = source.customer_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.site_members AS legacy_assignment
        JOIN public.sites AS site
          ON site.id = legacy_assignment.site_id
        WHERE legacy_assignment.user_id = app_user.id
          AND site.customer_id = source.customer_id
          AND legacy_assignment.role <> 'viewer'
      ) THEN 'viewer'
      ELSE 'requester'
    END,
    CASE app_user.status
      WHEN 'active' THEN 'active'
      WHEN 'invited' THEN 'invited'
      ELSE 'suspended'
    END,
    CASE
      WHEN app_user.role = 'customer_manager'
        AND source.is_home_customer
        THEN 'CUSTOMER'
      ELSE 'SITE'
    END,
    app_user.created_at
  FROM distinct_sources AS source
  JOIN public.users AS app_user
    ON app_user.id = source.user_id
  RETURNING *
)
INSERT INTO public.audit_logs (
  actor_id,
  actor_role,
  entity_type,
  entity_id,
  action,
  new_value,
  metadata
)
SELECT
  NULL,
  'system',
  'customer_membership',
  membership.id,
  'migrated',
  membership.status,
  pg_catalog.jsonb_build_object(
    'command', 'migration_055_backfill_customer_membership',
    'user_id', membership.user_id,
    'customer_id', membership.customer_id,
    'organization_role', membership.organization_role,
    'ticket_visibility_scope', membership.ticket_visibility_scope
  )
FROM inserted_memberships AS membership;

WITH inserted_assignments AS (
  INSERT INTO public.customer_site_assignments (
    membership_id,
    customer_id,
    site_id,
    site_role,
    object_scope,
    effective_from
  )
  SELECT
    membership.id,
    membership.customer_id,
    site.id,
    CASE legacy_assignment.role
      WHEN 'owner' THEN 'site_admin'
      WHEN 'manager' THEN 'site_admin'
      WHEN 'viewer' THEN 'viewer'
      ELSE 'requester'
    END,
    'SITE',
    legacy_assignment.created_at
  FROM public.site_members AS legacy_assignment
  JOIN public.sites AS site
    ON site.id = legacy_assignment.site_id
  JOIN public.customer_memberships AS membership
    ON membership.user_id = legacy_assignment.user_id
   AND membership.customer_id = site.customer_id
  RETURNING *
)
INSERT INTO public.audit_logs (
  actor_id,
  actor_role,
  entity_type,
  entity_id,
  action,
  new_value,
  metadata
)
SELECT
  NULL,
  'system',
  'customer_site_assignment',
  assignment.id,
  'migrated',
  assignment.site_role,
  pg_catalog.jsonb_build_object(
    'command', 'migration_055_backfill_customer_site_assignment',
    'membership_id', assignment.membership_id,
    'customer_id', assignment.customer_id,
    'site_id', assignment.site_id,
    'object_scope', assignment.object_scope
  )
FROM inserted_assignments AS assignment;

ALTER TABLE public.customer_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_site_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.customer_memberships,
  public.customer_site_assignments
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.customer_memberships,
  public.customer_site_assignments
TO service_role;

COMMENT ON TABLE public.customer_memberships IS
  'PRD identity authorization root: one user-to-customer membership with independent role, lifecycle, ticket scope, approvals, and effective dates. Migration 055 is additive and does not activate this model in application reads.';
COMMENT ON TABLE public.customer_site_assignments IS
  'Tenant-bound per-site authorization grants for a customer membership. Composite foreign keys make cross-customer assignments structurally impossible.';
COMMENT ON COLUMN public.users.customer_id IS
  'Compatibility-only home customer after migration 055. New authorization must resolve customer_memberships instead of treating this column as the durable access root.';
COMMENT ON TABLE public.site_members IS
  'Compatibility-only site access after migration 055. New authorization must resolve customer_site_assignments; retained rows remain historical input until cutover.';

COMMIT;
