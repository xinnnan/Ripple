// Client-side scope helpers. Lives in its own file so that `scope.ts`
// (which imports next/headers via the server client) stays server-only.
// Re-exported from `scope.ts` for a single import path on the client.

import { createClient } from "./client";
import { isInternalUser } from "@/lib/roles";
import type { UserRole } from "@/types/ticket";
import {
  isUnauthenticatedAuthError,
  throwIdentityServiceUnavailable,
} from "./auth-read";

/**
 * Get the list of site_ids the current browser session is allowed to use.
 * Used by client components like the create-ticket modal.
 */
export async function getCurrentSiteIds(): Promise<string[]> {
  const supabase = createClient();
  const authResult = await supabase.auth.getUser();
  const {
    data: { user: authUser },
    error: authError,
  } = authResult;
  if (authError && !isUnauthenticatedAuthError(authError)) {
    throwIdentityServiceUnavailable("getCurrentSiteIds/auth", authError);
  }
  if (!authUser) return [];

  const profileResult = await supabase
    .from("users")
    .select("role, email, customer_id, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileResult.error) {
    throwIdentityServiceUnavailable(
      "getCurrentSiteIds/profile",
      profileResult.error
    );
  }
  const profile = profileResult.data;
  if (!profile || profile.status !== "active") return [];

  const role = (profile.role as UserRole | null) ?? "customer";
  const email = profile.email as string;
  const isInternal = isInternalUser({ role, email });

  if (isInternal) return []; // empty = no filter (sees all)

  // The browser must never construct a service-role client. RLS already
  // returns manager/customer sites according to the caller's JWT.
  const sitesResult = await supabase
    .from("sites")
    .select("id")
    .eq("status", "active");
  if (sitesResult.error) {
    throwIdentityServiceUnavailable(
      "getCurrentSiteIds/sites",
      sitesResult.error
    );
  }
  const sites = sitesResult.data;
  return (sites || []).map((s) => s.id as string);
}

/**
 * Full site list (id, code, name, customer name) the current browser session
 * is allowed to see. Used by client components like the create-ticket modal.
 * Returns the same shape regardless of role — the role only changes which
 * rows are returned.
 */
export async function getCurrentSites(): Promise<
  { id: string; site_code: string; site_name: string; customer_name: string }[]
> {
  const supabase = createClient();
  const authResult = await supabase.auth.getUser();
  const {
    data: { user: authUser },
    error: authError,
  } = authResult;
  if (authError && !isUnauthenticatedAuthError(authError)) {
    throwIdentityServiceUnavailable("getCurrentSites/auth", authError);
  }
  if (!authUser) return [];

  const profileResult = await supabase
    .from("users")
    .select("status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileResult.error) {
    throwIdentityServiceUnavailable(
      "getCurrentSites/profile",
      profileResult.error
    );
  }
  const profile = profileResult.data;
  if (!profile || profile.status !== "active") return [];

  type SiteRow = {
    id: string;
    site_code: string;
    site_name: string;
    customer: { name: string } | { name: string }[] | null;
  };
  // One RLS-scoped query covers internal users, customer managers, and
  // assigned customers without exposing the server-only secret key.
  const sitesResult = await supabase
    .from("sites")
    .select("id, site_code, site_name, customer:customers(name)")
    .eq("status", "active")
    .order("site_name");
  if (sitesResult.error) {
    throwIdentityServiceUnavailable(
      "getCurrentSites/sites",
      sitesResult.error
    );
  }
  const sites = (sitesResult.data || []) as SiteRow[];

  return sites.map((s) => {
    const customerData = Array.isArray(s.customer) ? s.customer[0] : s.customer;
    return {
      id: s.id,
      site_code: s.site_code,
      site_name: s.site_name,
      customer_name: (customerData as { name: string } | null)?.name || "",
    };
  });
}
