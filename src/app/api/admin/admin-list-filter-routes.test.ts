import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createAdminClientMock, requireAdminMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  requireAdminMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
}));

import { GET as getAudit } from "./audit/route";
import { GET as getInventory } from "./inventory/route";
import { GET as getSiteMembers } from "./site-members/route";
import { GET as getSpareParts } from "./spare-parts/route";

type QueryResult = { data: unknown; error: unknown };

function queryClient(result: QueryResult = { data: [], error: null }) {
  const methods: Record<string, ReturnType<typeof vi.fn>> = {};
  const builder = {
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  } as Record<string, unknown>;
  for (const method of ["select", "order", "eq", "limit", "or"]) {
    methods[method] = vi.fn(() => builder);
    builder[method] = methods[method];
  }
  return { client: { from: vi.fn(() => builder) }, methods };
}

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: ID,
    role: "admin",
    email: "admin@dropletai.services",
  });
});

describe("admin list filter routes", () => {
  it.each([
    [getAudit, "/api/admin/audit?limit=2junk"],
    [getInventory, "/api/admin/inventory?low_stock=yes"],
    [getSiteMembers, "/api/admin/site-members?site_id=not-a-uuid"],
    [getSpareParts, "/api/admin/spare-parts?category=unknown"],
  ])("rejects malformed filters before client creation: %s", async (handler, path) => {
    const response = await handler(new NextRequest(`http://localhost${path}`));

    expect(response.status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("applies strict audit filters with private delivery", async () => {
    const query = queryClient();
    createAdminClientMock.mockReturnValue(query.client);
    const response = await getAudit(
      new NextRequest(
        `http://localhost/api/admin/audit?entity_type=ticket&action=updated&actor_id=${ID}&limit=25`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.eq).toHaveBeenCalledWith("entity_type", "ticket");
    expect(query.methods.eq).toHaveBeenCalledWith("action", "updated");
    expect(query.methods.eq).toHaveBeenCalledWith("actor_id", ID);
    expect(query.methods.limit).toHaveBeenCalledWith(25);
  });

  it("applies both inventory stock states without broadening", async () => {
    const query = queryClient({
      data: [
        { id: "low", quantity: 1, min_quantity: 2 },
        { id: "ok", quantity: 2, min_quantity: 2 },
      ],
      error: null,
    });
    createAdminClientMock.mockReturnValue(query.client);
    const response = await getInventory(
      new NextRequest(
        `http://localhost/api/admin/inventory?site_id=${ID}&low_stock=false`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.eq).toHaveBeenCalledWith("site_id", ID);
    expect(body.data).toEqual([{ id: "ok", quantity: 2, min_quantity: 2 }]);
  });

  it("uses an explicit bounded site-membership projection", async () => {
    const query = queryClient();
    createAdminClientMock.mockReturnValue(query.client);
    const response = await getSiteMembers(
      new NextRequest(
        `http://localhost/api/admin/site-members?site_id=${ID}&limit=250`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.select).toHaveBeenCalledWith(
      expect.not.stringContaining("*")
    );
    expect(query.methods.limit).toHaveBeenCalledWith(250);
  });

  it("applies boolean and guarded spare-part search filters", async () => {
    const query = queryClient();
    createAdminClientMock.mockReturnValue(query.client);
    const response = await getSpareParts(
      new NextRequest(
        "http://localhost/api/admin/spare-parts?category=sensor&active=false&search=AMR_100%25"
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.eq).toHaveBeenCalledWith("category", "sensor");
    expect(query.methods.eq).toHaveBeenCalledWith("is_active", false);
    expect(query.methods.or).toHaveBeenCalledWith(
      "part_number.ilike.%AMR\\_100\\%%,part_name.ilike.%AMR\\_100\\%%"
    );
  });

  it("does not expose site-membership database errors", async () => {
    const query = queryClient({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });
    createAdminClientMock.mockReturnValue(query.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await getSiteMembers(
      new NextRequest("http://localhost/api/admin/site-members")
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to fetch site memberships" });
    expect(JSON.stringify(body)).not.toContain("private database detail");
    consoleError.mockRestore();
  });
});
