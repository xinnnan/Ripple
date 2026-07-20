-- Migration 023 — Kill the remaining site_members RLS recursion
--
-- Why:
--   Even after migration 022 added "Users can see own site
--   memberships", customers still can't read site_members. Direct
--   REST as a customer JWT returns:
--     42P17: infinite recursion detected in policy for relation
--     "site_members"
--
-- Root cause:
--   Migration 017 added "Customer managers see customer
--   site_members" on site_members. Its USING clause does:
--     SELECT 1 FROM users u JOIN sites s ON s.customer_id = u.customer_id
--     WHERE u.id = auth.uid() AND u.role = 'customer_manager'
--           AND s.id = site_members.site_id
--   To evaluate the join on sites, postgres checks RLS on sites.
--   sites has "Customer users can view own sites" which is
--     SELECT 1 FROM site_members sm WHERE sm.user_id = auth.uid()
--   To evaluate that, postgres checks RLS on site_members — and
--   we're back at the original 017 policy. Classic 3-table
--   recursion: site_members → sites → site_members → ...
--
--   Migration 022 fixed the `users` self-recursion (019) and added
--   a "Users can see own site memberships" policy, but the 017
--   site_members policy is still there and still recursive.
--
-- Fix:
--   Drop the 017 policy and replace with a SECURITY DEFINER
--   helper that does the lookup in one shot, bypassing RLS on
--   both `users` and `sites` (both have RLS enabled, both can
--   recursively reference each other and site_members).
--
-- Apply via Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Helper: given the calling auth.uid(), return true if the user is a
-- customer_manager whose customer_id matches the given site_id.
-- SECURITY DEFINER bypasses RLS on users + sites during this lookup.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_can_see_site(target_site_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.sites s ON s.customer_id = u.customer_id
    WHERE u.id = auth.uid()
      AND u.role = 'customer_manager'
      AND s.id = target_site_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_can_see_site(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Replace the recursive 017 site_members policy
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Customer managers see customer site_members" ON site_members;

CREATE POLICY "Customer managers see customer site_members" ON site_members
  FOR SELECT
  TO authenticated
  USING (public.current_user_can_see_site(site_id));

COMMENT ON POLICY "Customer managers see customer site_members" ON site_members IS
  'Was: SELECT 1 FROM users JOIN sites — both tables RLS-enabled, both
   can reference site_members → infinite recursion. Now uses a
   SECURITY DEFINER function that bypasses RLS for the lookup.';

COMMENT ON FUNCTION public.current_user_can_see_site(uuid) IS
  'Returns true when the calling auth.uid() is a customer_manager
   whose customer_id matches the given site_id. SECURITY DEFINER
   bypasses RLS on users + sites to avoid recursive policy eval.';

-- Verify the recursion is gone by re-running the customer probe
-- (the calling code does `auth.uid() = user_id` from policy 022,
--  which now works because 017 no longer evaluates recursively).
