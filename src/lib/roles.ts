// Centralized role definitions and helpers for Ripple
import type { UserRole } from "@/types/ticket";

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
