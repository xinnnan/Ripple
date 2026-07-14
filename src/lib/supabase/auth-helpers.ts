import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import {
  ADMIN_ROLES,
  INTERNAL_ROLES,
  isCustomerManager,
  isInternalUser,
} from "@/lib/roles";

export async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role, email, customer_id")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    return { error: "Forbidden: Admin access required", status: 403 } as const;
  }

  return { userId: authUser.id, role } as const;
}

/**
 * Require an internal user (admin or engineer).
 */
export async function requireInternal() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role, email, customer_id")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  const email = userProfile?.email as string | undefined;
  const customerId = userProfile?.customer_id as string | null;
  const isInternal = isInternalUser({ role, email });

  if (!isInternal) {
    return { error: "Forbidden: Internal access required", status: 403 } as const;
  }

  return { userId: authUser.id, role: role!, email: email!, customerId } as const;
}

/**
 * Get authenticated user info (any role).
 */
export async function getAuthUser() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role, email, customer_id, full_name")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  const email = userProfile?.email as string | undefined;
  const customerId = userProfile?.customer_id as string | null;
  const fullName = userProfile?.full_name as string | null;
  const isInternal = isInternalUser({ role, email });
  const isManager = role ? isCustomerManager(role) : false;

  return {
    userId: authUser.id,
    role: role!,
    email: email!,
    customerId,
    fullName,
    isInternal,
    isManager,
  } as const;
}
