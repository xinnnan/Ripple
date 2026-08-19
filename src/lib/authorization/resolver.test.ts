import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  CustomerPolicyReadError,
  resolveCustomerPolicyForActorWithClient,
} from "./resolver";
import type { CustomerPolicyResourceRequest } from "./policy";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";

interface QueryCall {
  table: string;
  projection: string;
  filters: [string, unknown][];
}

type QueryResult = {
  data: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
};

function baseResults(): Record<string, QueryResult> {
  return {
    users: {
      data: { id: ACTOR_ID, status: "active" },
      error: null,
    },
    customers: {
      data: { id: CUSTOMER_ID, status: "active" },
      error: null,
    },
    customer_memberships: {
      data: {
        id: MEMBERSHIP_ID,
        user_id: ACTOR_ID,
        customer_id: CUSTOMER_ID,
        organization_role: "requester",
        status: "active",
        ticket_visibility_scope: "SITE",
        approver_capabilities: ["paid_parts"],
        effective_from: "2026-08-19T11:00:00.000Z",
        effective_to: null,
      },
      error: null,
    },
    sites: {
      data: { id: SITE_ID, customer_id: CUSTOMER_ID, status: "active" },
      error: null,
    },
    customer_site_assignments: {
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        membership_id: MEMBERSHIP_ID,
        customer_id: CUSTOMER_ID,
        site_id: SITE_ID,
        site_role: "requester",
        object_scope: null,
        effective_from: "2026-08-19T11:00:00.000Z",
        effective_to: null,
      },
      error: null,
    },
  };
}

function makeClient(results: Record<string, QueryResult>) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) => {
    const call: QueryCall = { table, projection: "", filters: [] };
    const query = {
      select(projection: string) {
        call.projection = projection;
        calls.push(call);
        return query;
      },
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return query;
      },
      async maybeSingle() {
        return results[table] ?? { data: null, error: null };
      },
    };
    return query;
  });
  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    from,
  };
}

function ticketReadRequest(): CustomerPolicyResourceRequest {
  return {
    customerId: CUSTOMER_ID,
    siteId: SITE_ID,
    action: "ticket.read",
    object: { visibility: "CUSTOMER_VISIBLE", actorIds: [] },
  };
}

describe("customer authorization resolver", () => {
  it("loads explicit tenant-bound projections and evaluates the request", async () => {
    const { client, calls } = makeClient(baseResults());
    await expect(
      resolveCustomerPolicyForActorWithClient(
        client,
        ACTOR_ID,
        ticketReadRequest(),
        new Date("2026-08-19T12:00:00.000Z")
      )
    ).resolves.toMatchObject({
      allowed: true,
      customerId: CUSTOMER_ID,
      siteId: SITE_ID,
      effectiveTicketScope: "SITE",
    });

    expect(calls.map(({ table }) => table)).toEqual([
      "users",
      "customers",
      "customer_memberships",
      "sites",
      "customer_site_assignments",
    ]);
    expect(calls.every(({ projection }) => !projection.includes("*"))).toBe(
      true
    );
    expect(
      calls.find(({ table }) => table === "customer_memberships")?.filters
    ).toEqual([
      ["user_id", ACTOR_ID],
      ["customer_id", CUSTOMER_ID],
    ]);
    expect(
      calls.find(({ table }) => table === "sites")?.filters
    ).toEqual([
      ["id", SITE_ID],
      ["customer_id", CUSTOMER_ID],
    ]);
    expect(
      calls.find(({ table }) => table === "customer_site_assignments")
        ?.filters
    ).toEqual([
      ["membership_id", MEMBERSHIP_ID],
      ["customer_id", CUSTOMER_ID],
      ["site_id", SITE_ID],
    ]);
  });

  it("does not query a site or assignment for a customer-level decision", async () => {
    const results = baseResults();
    results.customer_memberships.data = {
      ...results.customer_memberships.data,
      organization_role: "organization_admin",
      ticket_visibility_scope: "CUSTOMER",
    };
    const { client, calls } = makeClient(results);
    await expect(
      resolveCustomerPolicyForActorWithClient(
        client,
        ACTOR_ID,
        {
          customerId: CUSTOMER_ID,
          action: "customer.read",
        },
        new Date("2026-08-19T12:00:00.000Z")
      )
    ).resolves.toMatchObject({ allowed: true, siteId: null });
    expect(calls.map(({ table }) => table)).toEqual([
      "users",
      "customers",
      "customer_memberships",
    ]);
  });

  it("rejects malformed identifiers before constructing any database query", async () => {
    const { client, from } = makeClient(baseResults());
    await expect(
      resolveCustomerPolicyForActorWithClient(
        client,
        "not-a-uuid",
        ticketReadRequest()
      )
    ).resolves.toEqual({ allowed: false, reason: "INVALID_REQUEST" });
    expect(from).not.toHaveBeenCalled();
  });

  it("skips the assignment lookup and denies when no membership exists", async () => {
    const results = baseResults();
    results.customer_memberships = { data: null, error: null };
    const { client, calls } = makeClient(results);
    await expect(
      resolveCustomerPolicyForActorWithClient(
        client,
        ACTOR_ID,
        ticketReadRequest(),
        new Date("2026-08-19T12:00:00.000Z")
      )
    ).resolves.toEqual({
      allowed: false,
      reason: "MEMBERSHIP_NOT_FOUND",
    });
    expect(
      calls.some(({ table }) => table === "customer_site_assignments")
    ).toBe(false);
  });

  it("fails closed on malformed persisted authorization data", async () => {
    const results = baseResults();
    results.customer_memberships.data = {
      ...results.customer_memberships.data,
      organization_role: "root",
    };
    const { client } = makeClient(results);
    await expect(
      resolveCustomerPolicyForActorWithClient(
        client,
        ACTOR_ID,
        ticketReadRequest(),
        new Date("2026-08-19T12:00:00.000Z")
      )
    ).resolves.toEqual({
      allowed: false,
      reason: "MEMBERSHIP_INVALID",
    });
  });

  it("contains database diagnostics and throws one generic read error", async () => {
    const results = baseResults();
    results.customer_memberships = {
      data: null,
      error: {
        code: "XX000",
        name: "DatabaseError",
        message: "private SQL and tenant details",
      },
    };
    const { client } = makeClient(results);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      resolveCustomerPolicyForActorWithClient(
        client,
        ACTOR_ID,
        ticketReadRequest()
      )
    ).rejects.toEqual(new CustomerPolicyReadError());
    expect(consoleError).toHaveBeenCalledWith(
      "[authorization/customer_memberships] read failed:",
      { code: "XX000", name: "DatabaseError" }
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "private SQL"
    );
    consoleError.mockRestore();
  });
});
