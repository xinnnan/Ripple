import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { createAdminClient, createClient, redirect } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));

import SitesPage from "@/app/(auth)/sites/page";
import TeamPage from "@/app/(auth)/team/page";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";

interface QueryError {
  code?: string;
  message?: string;
}

interface QueryResult {
  data: unknown[] | null;
  error: QueryError | null;
}

interface QueryCall {
  table: string;
  method: "select" | "eq" | "in" | "order";
  args: unknown[];
}

function makeQuery(
  table: string,
  result: QueryResult,
  calls: QueryCall[]
) {
  const query = Promise.resolve(result) as Promise<QueryResult> & {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
  };

  for (const method of ["select", "eq", "in", "order"] as const) {
    query[method] = vi.fn((...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    });
  }

  return query;
}

function makeAdminClient(results: Record<string, QueryResult>) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) =>
    makeQuery(
      table,
      results[table] ?? { data: [], error: null },
      calls
    )
  );
  return { client: { from }, calls };
}

function makeSessionClient(result: {
  data: { role: string; email: string; customer_id: string | null } | null;
  error: QueryError | null;
}) {
  const profileQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  profileQuery.select = vi.fn(() => profileQuery);
  profileQuery.eq = vi.fn(() => profileQuery);
  profileQuery.maybeSingle = vi.fn().mockResolvedValue(result);
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    from: vi.fn(() => profileQuery),
  };
}

function setProfile(role: "customer" | "customer_manager") {
  createClient.mockResolvedValue(
    makeSessionClient({
      data: {
        role,
        email: `${role}@example.com`,
        customer_id: CUSTOMER_ID,
      },
      error: null,
    })
  );
}

function expectCall(
  calls: QueryCall[],
  table: string,
  method: QueryCall["method"],
  ...args: unknown[]
) {
  expect(calls).toContainEqual({ table, method, args });
}

async function expectGenericReadFailure(renderPage: () => Promise<unknown>) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(renderPage()).rejects.toThrow(
    "Page data is temporarily unavailable"
  );

  expect(redirect).not.toHaveBeenCalled();
  expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
    "sensitive database detail"
  );
  consoleError.mockRestore();
}

describe("customer-facing page read integrity", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    createClient.mockReset();
    redirect.mockClear();
  });

  it.each([
    ["sites", SitesPage],
    ["team", TeamPage],
  ] as Array<[string, () => Promise<unknown>]>) (
    "surfaces a failed %s profile read before service-role access",
    async (_name, renderPage) => {
      createClient.mockResolvedValue(
        makeSessionClient({
          data: null,
          error: { code: "XX000", message: "sensitive database detail" },
        })
      );

      await expectGenericReadFailure(renderPage);

      expect(createAdminClient).not.toHaveBeenCalled();
    }
  );

  it("surfaces a failed manager site list", async () => {
    setProfile("customer_manager");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        sites: {
          data: null,
          error: { code: "XX000", message: "sensitive database detail" },
        },
      }).client
    );

    await expectGenericReadFailure(SitesPage);
  });

  it("surfaces a failed customer membership list", async () => {
    setProfile("customer");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        site_members: {
          data: null,
          error: { code: "XX000", message: "sensitive database detail" },
        },
      }).client
    );

    await expectGenericReadFailure(SitesPage);
  });

  it("surfaces failed active-site hydration for retained memberships", async () => {
    setProfile("customer");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        site_members: {
          data: [{ site_id: SITE_ID, role: "member" }],
          error: null,
        },
        sites: {
          data: null,
          error: { code: "XX000", message: "sensitive database detail" },
        },
      }).client
    );

    await expectGenericReadFailure(SitesPage);
  });

  it.each(["users", "sites"])(
    "surfaces a failed team %s read",
    async (failingTable) => {
      setProfile("customer_manager");
      createAdminClient.mockReturnValue(
        makeAdminClient({
          [failingTable]: {
            data: null,
            error: { code: "XX000", message: "sensitive database detail" },
          },
        }).client
      );

      await expectGenericReadFailure(TeamPage);
    }
  );

  it("surfaces a failed team membership read", async () => {
    setProfile("customer_manager");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        users: {
          data: [{ id: USER_ID, role: "customer" }],
          error: null,
        },
        site_members: {
          data: null,
          error: { code: "XX000", message: "sensitive database detail" },
        },
      }).client
    );

    await expectGenericReadFailure(TeamPage);
  });

  it("hydrates customer memberships through active tenant and site filters", async () => {
    setProfile("customer");
    const admin = makeAdminClient({
      site_members: {
        data: [{ site_id: SITE_ID, role: "member" }],
        error: null,
      },
      sites: { data: [], error: null },
    });
    createAdminClient.mockReturnValue(admin.client);

    await SitesPage();

    expectCall(admin.calls, "site_members", "eq", "user_id", USER_ID);
    expectCall(admin.calls, "sites", "in", "id", [SITE_ID]);
    expectCall(admin.calls, "sites", "eq", "status", "active");
    expectCall(
      admin.calls,
      "sites",
      "in",
      "customer.status",
      ["active", "trial"]
    );
  });

  it("keeps manager site hydration within the active customer organization", async () => {
    setProfile("customer_manager");
    const admin = makeAdminClient({});
    createAdminClient.mockReturnValue(admin.client);

    await SitesPage();

    expectCall(admin.calls, "sites", "eq", "customer_id", CUSTOMER_ID);
    expectCall(admin.calls, "sites", "eq", "status", "active");
    expectCall(
      admin.calls,
      "sites",
      "in",
      "customer.status",
      ["active", "trial"]
    );
  });

  it("keeps the team model tenant-scoped and lifecycle-filtered", async () => {
    setProfile("customer_manager");
    const admin = makeAdminClient({
      users: {
        data: [
          {
            id: USER_ID,
            email: "customer@example.com",
            full_name: "Customer User",
            role: "customer",
            status: "active",
            phone: null,
            created_at: "2026-08-03T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    createAdminClient.mockReturnValue(admin.client);

    await TeamPage();

    expectCall(admin.calls, "users", "eq", "customer_id", CUSTOMER_ID);
    expectCall(admin.calls, "sites", "eq", "customer_id", CUSTOMER_ID);
    expectCall(admin.calls, "sites", "eq", "status", "active");
    expectCall(
      admin.calls,
      "sites",
      "in",
      "customer.status",
      ["active", "trial"]
    );
    expectCall(admin.calls, "site_members", "in", "user_id", [USER_ID]);
  });
});
