import { describe, it, expect, vi } from "vitest";
import { scopeTickets, scopeSites, scopeCustomers } from "./scope";
import type { UserScope } from "./scope";

// Mock the query builder — chainable like the Supabase client
function mockQuery() {
  const q: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "gte", "lte", "or", "order", "range", "limit", "maybeSingle", "single"];
  for (const m of methods) {
    q[m] = vi.fn(() => q);
  }
  return q;
}

const internalScope: UserScope = {
  userId: "u1",
  role: "admin",
  email: "a@dropletai.services",
  fullName: "Admin",
  customerId: null,
  isInternal: true,
  isManager: false,
  isCustomer: false,
  siteIds: [],
};

const managerScope: UserScope = {
  userId: "u2",
  role: "customer_manager",
  email: "m@customer.com",
  fullName: "Manager",
  customerId: "cust-1",
  isInternal: false,
  isManager: true,
  isCustomer: false,
  siteIds: ["site-a", "site-b"],
};

const customerScope: UserScope = {
  userId: "u3",
  role: "customer",
  email: "c@customer.com",
  fullName: "Customer",
  customerId: "cust-1",
  isInternal: false,
  isManager: false,
  isCustomer: true,
  siteIds: ["site-a"],
};

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

describe("scopeTickets", () => {
  it("returns the query untouched for internal users", () => {
    const q = mockQuery();
    const out = scopeTickets(q, internalScope);
    expect(out).toBe(q);
    expect(q.in).not.toHaveBeenCalled();
    expect(q.eq).not.toHaveBeenCalled();
  });

  it("filters by site_id for customer_manager (via .in)", () => {
    const q = mockQuery();
    scopeTickets(q, managerScope);
    expect(q.in).toHaveBeenCalledWith("site_id", ["site-a", "site-b"]);
  });

  it("filters by site_id for customer (via .in)", () => {
    const q = mockQuery();
    scopeTickets(q, customerScope);
    expect(q.in).toHaveBeenCalledWith("site_id", ["site-a"]);
  });

  it("injects an impossible eq() when a non-internal user has no sites", () => {
    const scope: UserScope = {
      ...customerScope,
      siteIds: [], // no memberships
    };
    const q = mockQuery();
    scopeTickets(q, scope);
    expect(q.eq).toHaveBeenCalledWith("site_id", EMPTY_GUID);
    expect(q.in).not.toHaveBeenCalled();
  });
});

describe("scopeSites", () => {
  it("returns the query untouched for internal users", () => {
    const q = mockQuery();
    expect(scopeSites(q, internalScope)).toBe(q);
  });

  it("filters by id for non-internal users with sites", () => {
    const q = mockQuery();
    scopeSites(q, managerScope);
    expect(q.in).toHaveBeenCalledWith("id", ["site-a", "site-b"]);
  });

  it("injects an impossible eq() when non-internal user has no sites", () => {
    const q = mockQuery();
    scopeSites(q, { ...customerScope, siteIds: [] });
    expect(q.eq).toHaveBeenCalledWith("id", EMPTY_GUID);
  });
});

describe("scopeCustomers", () => {
  it("returns the query untouched for internal users", () => {
    const q = mockQuery();
    expect(scopeCustomers(q, internalScope)).toBe(q);
  });

  it("filters by id for managers using their customer_id", () => {
    const q = mockQuery();
    scopeCustomers(q, managerScope);
    expect(q.eq).toHaveBeenCalledWith("id", "cust-1");
  });

  it("filters by id for customers using their customer_id", () => {
    const q = mockQuery();
    scopeCustomers(q, customerScope);
    expect(q.eq).toHaveBeenCalledWith("id", "cust-1");
  });

  it("returns no rows when a customer has no customer_id (defence in depth)", () => {
    const q = mockQuery();
    scopeCustomers(q, { ...customerScope, customerId: null });
    expect(q.eq).toHaveBeenCalledWith("id", EMPTY_GUID);
  });
});
