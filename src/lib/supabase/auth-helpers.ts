import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import {
  ADMIN_ROLES,
  isCustomerManager,
  isInternalUser,
} from "@/lib/roles";
import {
  identityServiceUnavailable,
  isUnauthenticatedAuthError,
} from "@/lib/supabase/auth-read";

export async function requireAdmin() {
  const supabase = await createClient();

  const authResult = await supabase.auth.getUser();
  const {
    data: { user: authUser },
    error: authError,
  } = authResult;

  if (authError && !isUnauthenticatedAuthError(authError)) {
    return identityServiceUnavailable("requireAdmin/auth", authError);
  }

  if (!authUser) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const profileResult = await supabase
    .from("users")
    .select("role, email, customer_id, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileResult.error) {
    return identityServiceUnavailable(
      "requireAdmin/profile",
      profileResult.error
    );
  }
  const userProfile = profileResult.data;

  if (!userProfile || userProfile.status !== "active") {
    return { error: "Forbidden: Account is not active", status: 403 } as const;
  }

  const role = userProfile?.role as UserRole | undefined;
  const email = userProfile?.email as string | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    return { error: "Forbidden: Admin access required", status: 403 } as const;
  }

  return { userId: authUser.id, role, email: email! } as const;
}

/**
 * Require an internal user (admin or engineer).
 */
export async function requireInternal() {
  const supabase = await createClient();

  const authResult = await supabase.auth.getUser();
  const {
    data: { user: authUser },
    error: authError,
  } = authResult;

  if (authError && !isUnauthenticatedAuthError(authError)) {
    return identityServiceUnavailable("requireInternal/auth", authError);
  }

  if (!authUser) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const profileResult = await supabase
    .from("users")
    .select("role, email, customer_id, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileResult.error) {
    return identityServiceUnavailable(
      "requireInternal/profile",
      profileResult.error
    );
  }
  const userProfile = profileResult.data;

  if (!userProfile || userProfile.status !== "active") {
    return { error: "Forbidden: Account is not active", status: 403 } as const;
  }

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

  const authResult = await supabase.auth.getUser();
  const {
    data: { user: authUser },
    error: authError,
  } = authResult;

  if (authError && !isUnauthenticatedAuthError(authError)) {
    return identityServiceUnavailable("getAuthUser/auth", authError);
  }

  if (!authUser) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const profileResult = await supabase
    .from("users")
    .select("role, email, customer_id, full_name, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileResult.error) {
    return identityServiceUnavailable(
      "getAuthUser/profile",
      profileResult.error
    );
  }
  const userProfile = profileResult.data;

  if (!userProfile || userProfile.status !== "active") {
    return { error: "Forbidden: Account is not active", status: 403 } as const;
  }

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
