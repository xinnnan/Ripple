// Tenant isolation scope — single source of truth for "what can this user see".
//
// Why: the project deliberately uses `createAdminClient()` + code-level filtering
// (instead of RLS) for query flexibility. That means every new query must remember
// to apply the right `where customer_id / site_id` filter, or it leaks across tenants.
// This module centralises that logic so the filter can't be forgotten.
//
// Usage (server component / API route):
//
//   import { getUserScope, scopeTickets } from "@/lib/supabase/scope";
//
//   const scope = await getUserScope();
//   if (!scope) redirect("/login");
//
//   let query = supabase.from("tickets").select(...);
//   query = scopeTickets(query, scope);
//   const { data } = await query;
//
// Usage (client component):
//
//   import { getCurrentSiteIds } from "@/lib/supabase/scope";
//   const siteIds = await getCurrentSiteIds();

import { createClient } from "./server";
import { createClient as createBrowserClient } from "./client";
import { createAdminClient } from "./admin";
import { INTERNAL_ROLES, isCustomerManager } from "@/lib/roles";
import { isInternalEmail } from "@/lib/utils";
import type { UserRole } from "@/types/ticket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The view of the world a user is allowed to see.
 *
 * - `siteIds` is always populated for non-internal users. It is the *union* of
 *   sites the user is allowed to query — for `customer_manager` it's all
 *   sites under their `customer_id`; for `customer` it's their `site_members`.
 * - `internal` users get an empty `siteIds` (they can see everything).
 */
export type UserScope = {
  userId: string;
  role: UserRole;
  email: string;
  fullName: string | null;
  customerId: string | null;
  isInternal: boolean;
  isManager: boolean;
  isCustomer: boolean;
  /** All site_ids this user is allowed to see. Empty for internal users. */
  siteIds: string[];
};

// ---------------------------------------------------------------------------
// Server-side scope builder
// ---------------------------------------------------------------------------

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/**
 * Build a UserScope for the current request session. Returns `null` if there
 * is no authenticated user.
 *
 * The function uses `createClient()` (cookie-scoped, RLS-respecting) for the
 * initial profile + `site_members` fetch. For the manager's full site list it
 * promotes to `createAdminClient()` because `site_members` only shows the
 * caller's memberships, not the customer's full set.
 */
export async function getUserScope(): Promise<UserScope | null> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("role, email, customer_id, full_name")
    .eq("id", authUser.id)
    .single();

  if (!profile) return null;

  const role = (profile.role as UserRole | null) ?? ("customer" as UserRole);
  const email = profile.email as string;
  const customerId = (profile.customer_id as string | null) ?? null;
  const fullName = (profile.full_name as string | null) ?? null;

  const isInternal = role
    ? INTERNAL_ROLES.includes(role)
    : isInternalEmail(email);
  const isManager = isCustomerManager(role);
  const isCustomer = !isInternal && !isManager;

  let siteIds: string[] = [];

  if (isManager && customerId) {
    // Customer managers see ALL sites under their customer
    const admin = createAdminClient();
    const { data: sites } = await admin
      .from("sites")
      .select("id")
      .eq("customer_id", customerId)
      .eq("status", "active");
    siteIds = (sites || []).map((s) => s.id as string);
  } else if (isCustomer) {
    // Regular customers see only their assigned sites
    const { data: memberships } = await supabase
      .from("site_members")
      .select("site_id")
      .eq("user_id", authUser.id);
    siteIds = (memberships || []).map((m) => m.site_id as string);
  }

  return {
    userId: authUser.id,
    role,
    email,
    fullName,
    customerId,
    isInternal,
    isManager,
    isCustomer,
    siteIds,
  };
}

// ---------------------------------------------------------------------------
// Scope-aware query helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the given `query` already has the right tenant filter
 * applied for the current scope. Pages can use this for self-test in dev.
 */
export function assertScoped(
  tableName: string,
  query: { url: URL } | unknown
): void {
  // Soft check: this is a placeholder for future ESLint integration.
  // The real safety net is the convention: every multi-tenant query MUST
  // call one of the helpers below. See CONTRIBUTING / PR template.
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[scope] table=${tableName}`);
  }
}

/**
 * Apply the scope filter to a tickets query.
 *
 * Strategy: every visible ticket is reached via a `site_id`. So we filter on
 * `site_id` for all non-internal users. For internal users we add nothing.
 *
 * If a non-internal user has zero visible sites, we inject an impossible
 * `eq('site_id', EMPTY_GUID)` so the query returns no rows (defence in depth).
 */
export function scopeTickets<Q extends { in: Function; eq: Function }>(
  query: Q,
  scope: UserScope
): Q {
  if (scope.isInternal) return query;

  if (scope.siteIds.length === 0) {
    return query.eq("site_id", EMPTY_GUID) as Q;
  }
  return query.in("site_id", scope.siteIds) as Q;
}

/**
 * Apply scope to a sites query.
 */
export function scopeSites<Q extends { in: Function; eq: Function }>(
  query: Q,
  scope: UserScope
): Q {
  if (scope.isInternal) return query;

  if (scope.siteIds.length === 0) {
    return query.eq("id", EMPTY_GUID) as Q;
  }
  return query.in("id", scope.siteIds) as Q;
}

/**
 * Apply scope to a customers query.
 */
export function scopeCustomers<Q extends { eq: Function }>(
  query: Q,
  scope: UserScope
): Q {
  if (scope.isInternal) return query;
  if (scope.customerId) return query.eq("id", scope.customerId) as Q;
  // Non-internal user without a customerId — return no rows.
  return query.eq("id", EMPTY_GUID) as Q;
}

/**
 * Apply scope to a users query (admin-only table; usually we already gate this
 * behind `requireAdmin`, but the helper is here for completeness).
 */
export function scopeUsers<Q extends { eq: Function }>(
  query: Q,
  scope: UserScope
): Q {
  if (scope.isInternal) return query;
  if (scope.customerId) return query.eq("customer_id", scope.customerId) as Q;
  return query.eq("id", EMPTY_GUID) as Q;
}

// ---------------------------------------------------------------------------
// Client-side helpers (for client components / modals)
// ---------------------------------------------------------------------------

/**
 * Get the list of site_ids the current browser session is allowed to use.
 * Used by client components like the create-ticket modal.
 */
export async function getCurrentSiteIds(): Promise<string[]> {
  const supabase = createBrowserClient();
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
  const isInternal = role ? INTERNAL_ROLES.includes(role) : isInternalEmail(email);
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
