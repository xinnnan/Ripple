import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient, createClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getUserScope } from "./scope";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

interface QueryResult {
  data: unknown;
  error: Record<string, unknown> | null;
}

function success(data: unknown): QueryResult {
  return { data, error: null };
}

function failure(): QueryResult {
  return {
    data: null,
    error: { code: "XX000", message: "sensitive provider detail" },
  };
}

function makeQuery(result: QueryResult) {
  const query = Promise.resolve(result) as Promise<QueryResult> &
    Record<string, ReturnType<typeof vi.fn>>;
  for (const method of ["select", "eq", "in"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  return query;
}

function makeDataClient(options?: {
  authUser?: { id: string } | null;
  authError?: Record<string, unknown> | null;
  tables?: Record<string, QueryResult[]>;
}) {
  const queues = new Map(
    Object.entries(options?.tables ?? {}).map(([table, values]) => [
      table,
      [...values],
    ])
  );
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user:
            options && "authUser" in options
              ? options.authUser ?? null
              : { id: USER_ID },
        },
        error: options?.authError ?? null,
      }),
    },
    from: vi.fn((table: string) =>
      makeQuery(queues.get(table)?.shift() ?? success([]))
    ),
  };
}

function profile(role: "admin" | "customer_manager" | "customer") {
  return {
    role,
    email:
      role === "admin" ? "admin@dropletai.services" : "user@example.com",
    customer_id: role === "admin" ? null : CUSTOMER_ID,
    full_name: "Scope User",
    status: "active",
  };
}

async function expectSafeFailure(
  run: () => Promise<unknown>,
  context: string
) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(run()).rejects.toThrow("Account data is temporarily unavailable");
  expect(JSON.stringify(consoleError.mock.calls)).toContain(context);
  expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
    "sensitive provider detail"
  );

  consoleError.mockRestore();
}

describe("tenant scope read integrity", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    createClient.mockReset();
  });

  it("returns null only for the normal signed-out path", async () => {
    createClient.mockResolvedValue(
      makeDataClient({
        authUser: null,
        authError: { name: "AuthSessionMissingError" },
      })
    );

    await expect(getUserScope()).resolves.toBeNull();
  });

  it("returns null for an explicitly rejected token", async () => {
    createClient.mockResolvedValue(
      makeDataClient({
        authUser: null,
        authError: { name: "AuthApiError", status: 401, code: "bad_jwt" },
      })
    );

    await expect(getUserScope()).resolves.toBeNull();
  });

  it("surfaces identity-provider failures", async () => {
    createClient.mockResolvedValue(
      makeDataClient({
        authUser: null,
        authError: {
          name: "AuthRetryableFetchError",
          code: "XX000",
          status: 503,
          message: "sensitive provider detail",
        },
      })
    );

    await expectSafeFailure(getUserScope, "getUserScope/auth");
  });

  it("surfaces profile failures but preserves missing/inactive profiles", async () => {
    createClient.mockResolvedValue(
      makeDataClient({ tables: { users: [failure()] } })
    );
    await expectSafeFailure(getUserScope, "getUserScope/profile");

    createClient.mockResolvedValue(
      makeDataClient({ tables: { users: [success(null)] } })
    );
    await expect(getUserScope()).resolves.toBeNull();

    createClient.mockResolvedValue(
      makeDataClient({
        tables: {
          users: [success({ ...profile("customer"), status: "inactive" })],
        },
      })
    );
    await expect(getUserScope()).resolves.toBeNull();
  });

  it("surfaces manager site lookup failures", async () => {
    createClient.mockResolvedValue(
      makeDataClient({
        tables: { users: [success(profile("customer_manager"))] },
      })
    );
    createAdminClient.mockReturnValue(
      makeDataClient({ tables: { sites: [failure()] } })
    );

    await expectSafeFailure(getUserScope, "getUserScope/manager-sites");
  });

  it("surfaces customer membership failures", async () => {
    createClient.mockResolvedValue(
      makeDataClient({
        tables: {
          users: [success(profile("customer"))],
          site_members: [failure()],
        },
      })
    );

    await expectSafeFailure(getUserScope, "getUserScope/memberships");
  });

  it("surfaces active-site hydration failures", async () => {
    createClient.mockResolvedValue(
      makeDataClient({
        tables: {
          users: [success(profile("customer"))],
          site_members: [success([{ site_id: "site-a" }])],
        },
      })
    );
    createAdminClient.mockReturnValue(
      makeDataClient({ tables: { sites: [failure()] } })
    );

    await expectSafeFailure(getUserScope, "getUserScope/active-sites");
  });

  it("deduplicates memberships before hydrating current customer scope", async () => {
    const dataClient = makeDataClient({
      tables: {
        users: [success(profile("customer"))],
        site_members: [
          success([
            { site_id: "site-a" },
            { site_id: "site-a" },
            { site_id: "site-b" },
          ]),
        ],
      },
    });
    const adminClient = makeDataClient({
      tables: { sites: [success([{ id: "site-a" }])] },
    });
    createClient.mockResolvedValue(dataClient);
    createAdminClient.mockReturnValue(adminClient);

    await expect(getUserScope()).resolves.toMatchObject({
      role: "customer",
      siteIds: ["site-a"],
    });
    const sitesQuery = adminClient.from.mock.results[0]?.value;
    expect(sitesQuery.in).toHaveBeenCalledWith("id", ["site-a", "site-b"]);
  });

  it("returns all active organization sites for a manager", async () => {
    createClient.mockResolvedValue(
      makeDataClient({
        tables: { users: [success(profile("customer_manager"))] },
      })
    );
    createAdminClient.mockReturnValue(
      makeDataClient({
        tables: { sites: [success([{ id: "site-a" }, { id: "site-b" }])] },
      })
    );

    await expect(getUserScope()).resolves.toMatchObject({
      role: "customer_manager",
      customerId: CUSTOMER_ID,
      siteIds: ["site-a", "site-b"],
    });
  });
});
