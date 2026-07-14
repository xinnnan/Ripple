// Centralized role definitions and helpers for Ripple
import type { UserRole } from "@/types/ticket";
import { isInternalEmail } from "@/lib/utils";

// ============================================================
// Role constants
// ============================================================

export const INTERNAL_ROLES: UserRole[] = ["admin", "engineer"];
export const ADMIN_ROLES: UserRole[] = ["admin"];
export const CUSTOMER_MANAGER_ROLE: UserRole = "customer_manager";

// ============================================================
// Role check helpers
// ============================================================

export function isInternalRole(role: UserRole): boolean {
  return INTERNAL_ROLES.includes(role);
}

export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

export function isCustomerManager(role: UserRole): boolean {
  return role === "customer_manager";
}

/**
 * Returns true when the user is internal (admin / engineer).
 *
 * Trust order:
 *   1. The `role` column on `public.users` is the source of truth.
 *   2. If the role is not set yet (e.g. right after signup, before the
 *      handle_new_user trigger has run, or for a legacy guest user),
 *      fall back to the email domain check.
 *   3. If neither is available, the user is treated as external.
 *
 * This is the single helper every server check should call. Inline
 * `INTERNAL_ROLES.includes(role) || isInternalEmail(email)` patterns
 * are an anti-pattern — they drift and miss edge cases.
 */
export function isInternalUser(input: {
  role?: UserRole | null;
  email?: string | null;
}): boolean {
  if (input.role) return INTERNAL_ROLES.includes(input.role);
  if (input.email) return isInternalEmail(input.email);
  return false;
}

// ============================================================
// Role display
// ============================================================

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  engineer: "Engineer",
  customer_manager: "Customer Manager",
  customer: "Customer",
};

export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "engineer", label: "Engineer" },
  { value: "customer_manager", label: "Customer Manager" },
  { value: "customer", label: "Customer" },
];
