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

import DashboardPage from "@/app/(auth)/dashboard/page";

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
  count?: number | null;
}

interface QueryCall {
  table: string;
  method: "select" | "eq" | "in" | "is" | "order" | "limit";
  args: unknown[];
}

function success(data: unknown[] = [], count: number | null = null): QueryResult {
  return { data, error: null, count };
}

function failure(): QueryResult {
  return {
    data: null,
    error: { code: "XX000", message: "sensitive database detail" },
    count: null,
  };
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
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };

  for (const method of [
    "select",
    "eq",
    "in",
    "is",
    "order",
    "limit",
  ] as const) {
    query[method] = vi.fn((...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    });
  }

  return query;
}

function makeAdminClient(results: Record<string, QueryResult[]>) {
  const calls: QueryCall[] = [];
  const queues = new Map(
    Object.entries(results).map(([table, tableResults]) => [
      table,
      [...tableResults],
    ])
  );
  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? success();
    return makeQuery(table, result, calls);
  });
  return { client: { from }, calls, from };
}

function makeSessionClient(result: {
  data: {
    role: string;
    full_name: string;
    email: string;
    customer_id: string | null;
  } | null;
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

function setProfile(role: "admin" | "customer_manager" | "customer") {
  createClient.mockResolvedValue(
    makeSessionClient({
      data: {
        role,
        full_name: "Test User",
        email:
          role === "admin" ? "admin@dropletai.services" : `${role}@example.com`,
        customer_id: role === "admin" ? null : CUSTOMER_ID,
      },
      error: null,
    })
  );
}

async function renderDashboardVariant() {
  const variant = await DashboardPage();
  if (!React.isValidElement(variant) || typeof variant.type !== "function") {
    throw new Error("Expected an async dashboard variant");
  }
  const renderVariant = variant.type as (
    props: Record<string, unknown>
  ) => Promise<unknown>;
  return renderVariant(variant.props as Record<string, unknown>);
}

async function expectGenericReadFailure(render: () => Promise<unknown>) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(render()).rejects.toThrow("Page data is temporarily unavailable");

  expect(redirect).not.toHaveBeenCalled();
  expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
    "sensitive database detail"
  );
  consoleError.mockRestore();
}

function expectCall(
  calls: QueryCall[],
  table: string,
  method: QueryCall["method"],
  ...args: unknown[]
) {
  expect(calls).toContainEqual({ table, method, args });
}

describe("dashboard read integrity", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    createClient.mockReset();
    redirect.mockClear();
  });

  it("surfaces a failed profile read before selecting a dashboard variant", async () => {
    createClient.mockResolvedValue(
      makeSessionClient({
        data: null,
        error: { code: "XX000", message: "sensitive database detail" },
      })
    );

    await expectGenericReadFailure(DashboardPage);

    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("surfaces failed internal metrics instead of reporting zero", async () => {
    setProfile("admin");
    const admin = makeAdminClient({
      tickets: [success([], 0), failure(), success([], 0), success()],
    });
    createAdminClient.mockReturnValue(admin.client);

    await expectGenericReadFailure(renderDashboardVariant);
  });

  it("surfaces a failed manager site scope", async () => {
    setProfile("customer_manager");
    createAdminClient.mockReturnValue(
      makeAdminClient({ sites: [failure()] }).client
    );

    await expectGenericReadFailure(renderDashboardVariant);
  });

  it("surfaces failed manager ticket metrics", async () => {
    setProfile("customer_manager");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        sites: [
          success([
            {
              id: SITE_ID,
              site_name: "Main Site",
              site_code: "MAIN",
              project_status: "steady_state",
            },
          ]),
        ],
        tickets: [success(), failure(), success(), success()],
      }).client
    );

    await expectGenericReadFailure(renderDashboardVariant);
  });

  it("surfaces a failed manager team count", async () => {
    setProfile("customer_manager");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        sites: [success()],
        users: [failure()],
      }).client
    );

    await expectGenericReadFailure(renderDashboardVariant);
  });

  it("surfaces a failed customer membership read", async () => {
    setProfile("customer");
    createAdminClient.mockReturnValue(
      makeAdminClient({ site_members: [failure()] }).client
    );

    await expectGenericReadFailure(renderDashboardVariant);
  });

  it("surfaces failed active-site hydration for a customer membership", async () => {
    setProfile("customer");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        site_members: [success([{ site_id: SITE_ID }])],
        sites: [failure()],
      }).client
    );

    await expectGenericReadFailure(renderDashboardVariant);
  });

  it("surfaces failed customer ticket metrics", async () => {
    setProfile("customer");
    createAdminClient.mockReturnValue(
      makeAdminClient({
        site_members: [success([{ site_id: SITE_ID }])],
        sites: [
          success([
            {
              id: SITE_ID,
              site_name: "Main Site",
              site_code: "MAIN",
              project_status: "steady_state",
            },
          ]),
        ],
        tickets: [success(), failure(), success()],
      }).client
    );

    await expectGenericReadFailure(renderDashboardVariant);
  });

  it("does not issue manager ticket queries for a legitimate empty site scope", async () => {
    setProfile("customer_manager");
    const admin = makeAdminClient({
      sites: [success()],
      users: [success([], 0)],
    });
    createAdminClient.mockReturnValue(admin.client);

    await renderDashboardVariant();

    expect(admin.from).not.toHaveBeenCalledWith("tickets");
  });

  it("hydrates customer scope only through active tenant and site rows", async () => {
    setProfile("customer");
    const admin = makeAdminClient({
      site_members: [success([{ site_id: SITE_ID }, { site_id: SITE_ID }])],
      sites: [success()],
    });
    createAdminClient.mockReturnValue(admin.client);

    await renderDashboardVariant();

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
    expect(admin.from).not.toHaveBeenCalledWith("tickets");
  });

  it("keeps manager sites within the active customer organization", async () => {
    setProfile("customer_manager");
    const admin = makeAdminClient({
      sites: [success()],
      users: [success([], 0)],
    });
    createAdminClient.mockReturnValue(admin.client);

    await renderDashboardVariant();

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
});
