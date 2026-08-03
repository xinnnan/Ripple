import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient }));

import { getCurrentSiteIds, getCurrentSites } from "./scope.client";

const USER_ID = "11111111-1111-4111-8111-111111111111";

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
  for (const method of ["select", "eq", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  return query;
}

function makeClient(options?: {
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

describe("browser scope read integrity", () => {
  beforeEach(() => {
    createClient.mockReset();
  });

  it.each([getCurrentSiteIds, getCurrentSites])(
    "preserves the signed-out empty-site path",
    async (helper) => {
      const client = makeClient({
        authUser: null,
        authError: { name: "AuthSessionMissingError" },
      });
      createClient.mockReturnValue(client);

      await expect(helper()).resolves.toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["getCurrentSiteIds", getCurrentSiteIds],
    ["getCurrentSites", getCurrentSites],
  ] as const)("%s surfaces identity-provider failure", async (name, helper) => {
    createClient.mockReturnValue(
      makeClient({
        authUser: null,
        authError: {
          name: "AuthRetryableFetchError",
          code: "XX000",
          status: 503,
          message: "sensitive provider detail",
        },
      })
    );

    await expectSafeFailure(helper, `${name}/auth`);
  });

  it.each([
    ["getCurrentSiteIds", getCurrentSiteIds],
    ["getCurrentSites", getCurrentSites],
  ] as const)("%s surfaces profile failure", async (name, helper) => {
    createClient.mockReturnValue(
      makeClient({ tables: { users: [failure()] } })
    );

    await expectSafeFailure(helper, `${name}/profile`);
  });

  it("returns no sites for an inactive browser profile", async () => {
    const client = makeClient({
      tables: { users: [success({ status: "inactive" })] },
    });
    createClient.mockReturnValue(client);

    await expect(getCurrentSites()).resolves.toEqual([]);
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("does not query sites for an internal site-id scope", async () => {
    const client = makeClient({
      tables: {
        users: [
          success({
            role: "admin",
            email: "admin@dropletai.services",
            customer_id: null,
            status: "active",
          }),
        ],
      },
    });
    createClient.mockReturnValue(client);

    await expect(getCurrentSiteIds()).resolves.toEqual([]);
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("surfaces site-list failure", async () => {
    createClient.mockReturnValue(
      makeClient({
        tables: {
          users: [success({ status: "active" })],
          sites: [failure()],
        },
      })
    );

    await expectSafeFailure(getCurrentSites, "getCurrentSites/sites");
  });

  it("maps object and array customer relations into one site contract", async () => {
    createClient.mockReturnValue(
      makeClient({
        tables: {
          users: [success({ status: "active" })],
          sites: [
            success([
              {
                id: "site-a",
                site_code: "A",
                site_name: "Alpha",
                customer: { name: "Acme" },
              },
              {
                id: "site-b",
                site_code: "B",
                site_name: "Beta",
                customer: [{ name: "Bravo" }],
              },
            ]),
          ],
        },
      })
    );

    await expect(getCurrentSites()).resolves.toEqual([
      {
        id: "site-a",
        site_code: "A",
        site_name: "Alpha",
        customer_name: "Acme",
      },
      {
        id: "site-b",
        site_code: "B",
        site_name: "Beta",
        customer_name: "Bravo",
      },
    ]);
  });

  it("returns the RLS-visible active site IDs for an external user", async () => {
    createClient.mockReturnValue(
      makeClient({
        tables: {
          users: [
            success({
              role: "customer",
              email: "user@example.com",
              customer_id: "customer-a",
              status: "active",
            }),
          ],
          sites: [success([{ id: "site-a" }, { id: "site-b" }])],
        },
      })
    );

    await expect(getCurrentSiteIds()).resolves.toEqual(["site-a", "site-b"]);
  });
});
