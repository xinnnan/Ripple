// Client-side scope helpers. Lives in its own file so that `scope.ts`
// (which imports next/headers via the server client) stays server-only.
// Re-exported from `scope.ts` for a single import path on the client.

import { createClient } from "./client";
import { createAdminClient } from "./admin";
import { isCustomerManager, isInternalUser } from "@/lib/roles";
import type { UserRole } from "@/types/ticket";

/**
 * Get the list of site_ids the current browser session is allowed to use.
 * Used by client components like the create-ticket modal.
 */
export async function getCurrentSiteIds(): Promise<string[]> {
  const supabase = createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return [];

  const { data: profile } = await supabase
    .from("users")
    .select("role, email, customer_id")
    .eq("id", authUser.id)
    .single();
  if (!profile) return [];

  const role = (profile.role as UserRole | null) ?? "customer";
  const email = profile.email as string;
  const customerId = (profile.customer_id as string | null) ?? null;
  const isInternal = isInternalUser({ role, email });
  const isManager = isCustomerManager(role);

  if (isInternal) return []; // empty = no filter (sees all)

  if (isManager && customerId) {
    const admin = createAdminClient();
    const { data: sites } = await admin
      .from("sites")
      .select("id")
      .eq("customer_id", customerId)
      .eq("status", "active");
    return (sites || []).map((s) => s.id as string);
  }

  const { data: memberships } = await supabase
    .from("site_members")
    .select("site_id")
    .eq("user_id", authUser.id);
  return (memberships || []).map((m) => m.site_id as string);
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
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return [];

  const { data: profile } = await supabase
    .from("users")
    .select("role, email, customer_id")
    .eq("id", authUser.id)
    .single();
  if (!profile) return [];

  const role = (profile.role as UserRole | null) ?? "customer";
  const email = profile.email as string;
  const customerId = (profile.customer_id as string | null) ?? null;
  const isInternal = isInternalUser({ role, email });
  const isManager = isCustomerManager(role);

  const admin = createAdminClient();
  type SiteRow = {
    id: string;
    site_code: string;
    site_name: string;
    customer: { name: string } | { name: string }[] | null;
  };
  let sites: SiteRow[] = [];

  if (isInternal) {
    const { data } = await admin
      .from("sites")
      .select("id, site_code, site_name, customer:customers(name)")
      .eq("status", "active")
      .order("site_name");
    sites = (data || []) as SiteRow[];
  } else if (isManager && customerId) {
    const { data } = await admin
      .from("sites")
      .select("id, site_code, site_name, customer:customers(name)")
      .eq("customer_id", customerId)
      .eq("status", "active")
      .order("site_name");
    sites = (data || []) as SiteRow[];
  } else {
    const { data: memberships } = await supabase
      .from("site_members")
      .select("site_id, sites(id, site_code, site_name, customer:customers(name))")
      .eq("user_id", authUser.id);
    sites = (memberships || []).map((m) => {
      const s = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as unknown as {
        id: string; site_code: string; site_name: string;
        customer: { name: string }[] | null;
      };
      return {
        id: s.id,
        site_code: s.site_code,
        site_name: s.site_name,
        customer: s.customer as { name: string } | { name: string }[] | null,
      };
    });
  }

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
