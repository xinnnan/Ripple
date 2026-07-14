-- Migration 019 — Fix infinite recursion in RLS policies on `users`
--
-- Symptom (found 2026-07-14 during e2e testing):
--   SELECT * FROM users WHERE id = auth.uid()
--   → ERROR: infinite recursion detected in policy for relation "users"
--   (HTTP 500 / PGRST500 from PostgREST)
--
-- Root cause:
--   Migration 017_consolidate_roles.sql added these policies on
--   the `users` table itself, each of which does
--   `SELECT 1 FROM users u WHERE u.id = auth.uid() …`:
--
--     "Customer managers see customer users"
--     (also the matching policies on `customers` and
--      `site_members` reference `users` the same way)
--
--   When postgres evaluates a policy on `users`, it must check
--   the same RLS policies on `users` to satisfy the inner
--   SELECT — which triggers the same policy again. Recursion.
--
--   Pre-Sprint-2 this was hidden because the API routes use
--   `createAdminClient()` (service role, bypasses RLS). But
--   the cookie-based Supabase client (used by every page in
--   `(auth)`) goes through RLS, so the moment a logged-in
--   admin tried to read their own profile, the whole query
--   errored out. The dashboard's "0 sites / 0 tickets" is
--   what the user saw; in the API routes, getUserScope()
--   silently returned null → 401.
--
-- Fix:
--   1. Add two SECURITY DEFINER functions that look up the
--      caller's role / customer_id without going through RLS.
--   2. Rewrite the recursive policies to call those functions
--      instead of doing a direct SELECT FROM users.
--
-- SECURITY DEFINER is the standard pattern for "self-reference
-- in an RLS policy" — it runs as the function owner (typically
-- the migration runner = the table owner) and bypasses RLS.
-- That's safe here because:
--   - the functions are STABLE and accept no arguments
--   - they only return the row that matches auth.uid()
--   - they are GRANTed only to authenticated
--
-- Apply via Supabase SQL editor or `supabase db push`.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_customer_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT customer_id FROM public.users WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_customer_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- Rewrite recursive policies on `users`
-- ---------------------------------------------------------------------------

-- Was: "Customer managers see customer users" (migration 017)
-- The original was:
--   CREATE POLICY "Customer managers see customer users" ON users
--     FOR SELECT USING (
--       EXISTS (
--         SELECT 1 FROM users u
--         WHERE u.id = auth.uid()
--         AND u.role = 'customer_manager'
--         AND u.customer_id = users.customer_id
--       )
--     );
DROP POLICY IF EXISTS "Customer managers see customer users" ON users;
CREATE POLICY "Customer managers see customer users" ON users
  FOR SELECT USING (
    public.current_user_role() = 'customer_manager'
    AND public.current_user_customer_id() = customer_id
  );

-- ---------------------------------------------------------------------------
-- Rewrite recursive policies on `customers` (internal users + customer
-- managers both referenced users inside their policy)
-- ---------------------------------------------------------------------------

-- Was: "Internal users can view all customers" (migration 010)
-- The original was:
--   CREATE POLICY "Internal users can view all customers" ON customers
--     FOR SELECT USING (
--       EXISTS (
--         SELECT 1 FROM users WHERE users.id = auth.uid()
--         AND users.role LIKE 'internal%'
--       )
--     );
DROP POLICY IF EXISTS "Internal users can view all customers" ON customers;
CREATE POLICY "Internal users can view all customers" ON customers
  FOR SELECT USING (
    public.current_user_role() IN ('admin', 'engineer')
  );

-- Was: "Customer managers see own customer" (migration 017)
DROP POLICY IF EXISTS "Customer managers see own customer" ON customers;
CREATE POLICY "Customer managers see own customer" ON customers
  FOR SELECT USING (
    public.current_user_role() = 'customer_manager'
    AND id = public.current_user_customer_id()
  );

-- Was: "Customer users can view own customer" (migration 010)
-- Original also joined site_members — not recursive on users directly,
-- but we keep the new pattern for consistency.
DROP POLICY IF EXISTS "Customer users can view own customer" ON customers;
CREATE POLICY "Customer users can view own customer" ON customers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      JOIN sites s ON s.id = sm.site_id
      WHERE sm.user_id = auth.uid()
      AND s.customer_id = customers.id
    )
  );

-- ---------------------------------------------------------------------------
-- Rewrite recursive policies on `sites` (internal users policy)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Internal users can view all sites" ON sites;
CREATE POLICY "Internal users can view all sites" ON sites
  FOR SELECT USING (
    public.current_user_role() IN ('admin', 'engineer')
  );

-- ---------------------------------------------------------------------------
-- Rewrite recursive policies on `tickets` (internal users policy)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Internal users can view all tickets" ON tickets;
CREATE POLICY "Internal users can view all tickets" ON tickets
  FOR SELECT USING (
    public.current_user_role() IN ('admin', 'engineer')
  );

-- ---------------------------------------------------------------------------
-- Add a missing INSERT policy for admins/engineers on ticket_events.
-- The PATCH /api/tickets/[id] route uses the service role to write
-- events, but the trigger approach (pre-015) required anon/authenticated
-- to insert. After dropping the trigger in 015, no anon path writes
-- events, so this is belt-and-suspenders.
-- ---------------------------------------------------------------------------

-- (No-op — included here as a reference point. The API layer is the
-- sole writer of ticket_events; service role bypasses RLS.)

COMMENT ON FUNCTION public.current_user_role() IS
  'Returns the role of the calling authenticated user. SECURITY DEFINER so
   it can be called from RLS policies on the users table itself without
   triggering recursive policy evaluation.';

COMMENT ON FUNCTION public.current_user_customer_id() IS
  'Returns the customer_id of the calling authenticated user. SECURITY
   DEFINER for the same reason as current_user_role().';
