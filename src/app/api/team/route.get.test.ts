import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthUserMock, createAdminClientMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { GET } from "./route";

type QueryResult = { data: unknown[] | null; error: unknown };

function adminClient(results: Record<string, QueryResult>) {
  const queries = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const from = vi.fn((table: string) => {
    const methods: Record<string, ReturnType<typeof vi.fn>> = {};
    const builder = {
      then: (
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve(
          results[table] ?? { data: [], error: null }
        ).then(onFulfilled, onRejected),
    } as Record<string, unknown>;

    for (const method of ["select", "eq", "order", "in"]) {
      methods[method] = vi.fn(() => builder);
      builder[method] = methods[method];
    }
    queries.set(table, methods);
    return builder;
  });

  return { client: { from }, from, queries };
}

beforeEach(() => {
  getAuthUserMock.mockReset();
  createAdminClientMock.mockReset();
  getAuthUserMock.mockResolvedValue({
    userId: "manager",
    role: "customer_manager",
    isManager: true,
    customerId: "customer-org",
  });
});

describe("GET /api/team", () => {
  it("returns manager-wide active access and suppresses archived memberships", async () => {
    const mock = adminClient({
      users: {
        data: [
          {
            id: "manager",
            email: "manager@example.com",
            full_name: "Manager",
            role: "customer_manager",
            status: "active",
            phone: null,
            created_at: "2026-08-03T00:00:00.000Z",
          },
          {
            id: "customer-user",
            email: "user@example.com",
            full_name: "User",
            role: "customer",
            status: "active",
            phone: null,
            created_at: "2026-08-03T00:00:00.000Z",
          },
        ],
        error: null,
      },
      sites: {
        data: [
          { id: "site-a", site_name: "Alpha", site_code: "ALPHA" },
          { id: "site-b", site_name: "Beta", site_code: "BETA" },
        ],
        error: null,
      },
      site_members: {
        data: [
          { user_id: "customer-user", site_id: "site-a" },
          { user_id: "customer-user", site_id: "archived-site" },
        ],
        error: null,
      },
    });
    createAdminClientMock.mockReturnValue(mock.client);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].sites.map((site: { site_id: string }) => site.site_id))
      .toEqual(["site-a", "site-b"]);
    expect(body.data[1].sites).toEqual([
      { site_id: "site-a", site_name: "Alpha", site_code: "ALPHA" },
    ]);
    expect(mock.queries.get("sites")?.eq).toHaveBeenCalledWith(
      "status",
      "active"
    );
    expect(mock.queries.get("site_members")?.select).toHaveBeenCalledWith(
      "user_id, site_id"
    );
  });

  it("returns an empty roster without issuing an empty membership query", async () => {
    const mock = adminClient({
      users: { data: [], error: null },
      sites: { data: [], error: null },
    });
    createAdminClientMock.mockReturnValue(mock.client);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
    expect(mock.from).not.toHaveBeenCalledWith("site_members");
  });
});
