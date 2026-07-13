import { describe, it, expect } from "vitest";
import {
  INTERNAL_ROLES,
  ADMIN_ROLES,
  isInternalRole,
  isAdminRole,
  isCustomerManager,
  ROLE_LABELS,
} from "./roles";
import type { UserRole } from "@/types/ticket";

describe("role helpers", () => {
  it("INTERNAL_ROLES is exactly admin + engineer", () => {
    expect(new Set(INTERNAL_ROLES)).toEqual(new Set(["admin", "engineer"]));
  });

  it("ADMIN_ROLES is exactly admin", () => {
    expect(new Set(ADMIN_ROLES)).toEqual(new Set(["admin"]));
  });

  it("isInternalRole is true for admin and engineer", () => {
    expect(isInternalRole("admin")).toBe(true);
    expect(isInternalRole("engineer")).toBe(true);
    expect(isInternalRole("customer_manager")).toBe(false);
    expect(isInternalRole("customer")).toBe(false);
  });

  it("isAdminRole is true only for admin", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("engineer")).toBe(false);
    expect(isAdminRole("customer_manager")).toBe(false);
    expect(isAdminRole("customer")).toBe(false);
  });

  it("isCustomerManager is true only for customer_manager", () => {
    expect(isCustomerManager("customer_manager")).toBe(true);
    expect(isCustomerManager("admin")).toBe(false);
    expect(isCustomerManager("engineer")).toBe(false);
    expect(isCustomerManager("customer")).toBe(false);
  });

  it("ROLE_LABELS has an entry for every role", () => {
    const allRoles: UserRole[] = ["admin", "engineer", "customer_manager", "customer"];
    for (const r of allRoles) {
      expect(ROLE_LABELS[r]).toBeTruthy();
    }
  });

  it("admin is the only overlap between ADMIN_ROLES and INTERNAL_ROLES", () => {
    const overlap = ADMIN_ROLES.filter((r) => INTERNAL_ROLES.includes(r));
    expect(overlap).toEqual(["admin"]);
  });
});
