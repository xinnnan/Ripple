import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createAdminClientMock, getAuthUserMock, getUserScopeMock } = vi.hoisted(
  () => ({
    createAdminClientMock: vi.fn(),
    getAuthUserMock: vi.fn(),
    getUserScopeMock: vi.fn(),
  })
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: getAuthUserMock,
}));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: getUserScopeMock,
  scopeTickets: (query: unknown) => query,
}));

import { GET } from "./route";

type QueryResult = { data: unknown; error: unknown };

function ticketQuery(result: QueryResult) {
  const methods: Record<string, ReturnType<typeof vi.fn>> = {};
  const builder = {
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  } as Record<string, unknown>;

  for (const method of [
    "select",
    "order",
    "in",
    "eq",
    "gte",
    "lte",
    "lt",
    "not",
    "or",
    "is",
  ]) {
    methods[method] = vi.fn(() => builder);
    builder[method] = methods[method];
  }

  return {
    client: { from: vi.fn(() => builder) },
    methods,
  };
}

const internalScope = {
  userId: "admin-user",
  role: "admin",
  email: "admin@dropletai.services",
  fullName: "Admin",
  customerId: null,
  isInternal: true,
  isManager: false,
  isCustomer: false,
  siteIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUserMock.mockResolvedValue({
    userId: "admin-user",
    role: "admin",
    isInternal: true,
  });
  getUserScopeMock.mockResolvedValue(internalScope);
});

describe("GET /api/tickets/export", () => {
  it("rejects malformed filters before creating a service-role client", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/tickets/export?severity=P0")
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid export filters" });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("applies the canonical multi-value and ownership filters", async () => {
    const query = ticketQuery({ data: [], error: null });
    createAdminClientMock.mockReturnValue(query.client);
    const customerId = "11111111-1111-4111-8111-111111111111";
    const siteId = "22222222-2222-4222-8222-222222222222";
    const ownerId = "33333333-3333-4333-8333-333333333333";

    const response = await GET(
      new NextRequest(
        `http://localhost/api/tickets/export?status=new,in_progress&severity=P1,P2&customer=${customerId}&site=${siteId}&owner=${ownerId}&range=30d`
      )
    );

    expect(response.status).toBe(200);
    expect(query.methods.in).toHaveBeenCalledWith("status", [
      "new",
      "in_progress",
    ]);
    expect(query.methods.in).toHaveBeenCalledWith("severity", ["P1", "P2"]);
    expect(query.methods.eq).toHaveBeenCalledWith("customer_id", customerId);
    expect(query.methods.eq).toHaveBeenCalledWith("site_id", siteId);
    expect(query.methods.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(query.methods.gte).toHaveBeenCalledWith(
      "created_at",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
  });

  it("returns an Excel-safe, private UTF-8 CSV for live relation shapes", async () => {
    const query = ticketQuery({
      data: [
        {
          ticket_no: "RPL-000001",
          title: "=WEBSERVICE(\"https://example.invalid\")",
          description: "Line one\rLine two",
          customer: { name: "Customer A" },
          site: [{ site_code: "A-1", site_name: "Alpha" }],
          owner: { full_name: "Engineer A" },
        },
      ],
      error: null,
    });
    createAdminClientMock.mockReturnValue(query.client);

    const response = await GET(
      new NextRequest("http://localhost/api/tickets/export")
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain("Customer A,A-1,Alpha,Engineer A");
    expect(csv).toContain("'=");
    expect(csv).toContain("\r\n");
  });

  it("contains database failures behind a generic response", async () => {
    const query = ticketQuery({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });
    createAdminClientMock.mockReturnValue(query.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      new NextRequest("http://localhost/api/tickets/export")
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to export tickets" });
    expect(JSON.stringify(body)).not.toContain("private database detail");
    consoleError.mockRestore();
  });
});
