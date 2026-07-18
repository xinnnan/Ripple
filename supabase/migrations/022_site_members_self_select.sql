-- Migration 022 — site_members: users can see their own memberships
--
-- Why:
--   E2e test 07_tenant_isolation.mjs (2026-07-18) revealed that
--   `customer` and `customer_manager` users see ZERO tickets and
--   ZERO sites in /api/tickets and /api/sites, even their own.
--
-- Root cause:
--   site_members has RLS enabled but no explicit "users can read
--   their own memberships" policy. The only site_members policy
--   is from 017 ("Customer managers see customer site_members"),
--   which only matches customer_manager role.
--
--   getUserScope() in src/lib/supabase/scope.ts uses the cookie
--   Supabase client (RLS-enforced) to read site_members for the
--   site_id list. With RLS denying the read, the customer gets
--   siteIds = []. Then scopeTickets() injects
--   `eq('site_id', EMPTY_GUID)` which matches no rows — so the
--   user sees nothing, not even their own tickets.
--
--   Same for customer_manager — they can read their own
--   site_members, but the policy doesn't extend to their direct
--   memberships (only to "all site_members under my customer").
--   Both work today via the `isManager` branch which uses the
--   admin client, so customer_manager scope works. Only the
--   `customer` role is broken.
--
-- Fix:
--   Add the missing "user can see own memberships" policy. Also
--   add a matching one for "internal users can read all
--   site_members" so /api/admin/site-members etc. don't fail
--   RLS too.
--
-- Apply via Supabase SQL editor.

-- Customers and managers can see memberships that include them
DROP POLICY IF EXISTS "Users can see own site memberships" ON site_members;
CREATE POLICY "Users can see own site memberships" ON site_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Internal users (admin / engineer) can see all site memberships.
-- Without this, the admin /api/site-members endpoint would be RLS-blocked.
DROP POLICY IF EXISTS "Internal users can view all site_members" ON site_members;
CREATE POLICY "Internal users can view all site_members" ON site_members
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() IN ('admin', 'engineer')
  );

-- Internal users can also insert / update site_members
-- (admins manage customer-team mappings via /admin).
DROP POLICY IF EXISTS "Internal users can manage site_members" ON site_members;
CREATE POLICY "Internal users can manage site_members" ON site_members
  FOR ALL
  TO authenticated
  USING (
    public.current_user_role() IN ('admin', 'engineer')
  )
  WITH CHECK (
    public.current_user_role() IN ('admin', 'engineer')
  );

COMMENT ON POLICY "Users can see own site memberships" ON site_members IS
  'Customer-side scope filter depends on this — without it
   getUserScope() returns siteIds=[] and the customer sees
   nothing (not even their own tickets).';

COMMENT ON POLICY "Internal users can view all site_members" ON site_members IS
  'Lets admin / engineer query site_members directly without
   having to promote to createAdminClient() (which would bypass
   RLS for everything).';

COMMENT ON POLICY "Internal users can manage site_members" ON site_members IS
  'Lets admin /admin/team pages add and remove customer-team
   mappings without bypass-RLS shenanigans.';
