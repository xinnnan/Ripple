import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  EXTERNAL_TICKET_LIST_SELECT,
  INTERNAL_TICKET_LIST_SELECT,
} from "@/lib/resource-projections";

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
  canAccessSite: vi.fn(),
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

  for (const method of ["select", "order", "eq", "limit"]) {
    methods[method] = vi.fn(() => builder);
    builder[method] = methods[method];
  }
  return {
    client: { from: vi.fn(() => builder) },
    methods,
  };
}

const customerId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";
const externalScope = {
  userId: "33333333-3333-4333-8333-333333333333",
  role: "customer",
  email: "customer@example.com",
  fullName: "Customer",
  customerId,
  isInternal: false,
  isManager: false,
  isCustomer: true,
  siteIds: [siteId],
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUserMock.mockResolvedValue({
    userId: externalScope.userId,
    role: "customer",
    isInternal: false,
  });
  getUserScopeMock.mockResolvedValue(externalScope);
});

describe("GET /api/tickets", () => {
  it("rejects malformed filters before creating a service-role client", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/tickets?status=unknown")
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid ticket list filters",
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("uses the external projection and applies in-scope customer/site filters", async () => {
    const query = ticketQuery({ data: [], error: null });
    createAdminClientMock.mockReturnValue(query.client);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/tickets?customer_id=${customerId}&site_id=${siteId}&status=new&severity=P1&limit=25`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.select).toHaveBeenCalledWith(
      EXTERNAL_TICKET_LIST_SELECT
    );
    expect(query.methods.eq).toHaveBeenCalledWith("customer_id", customerId);
    expect(query.methods.eq).toHaveBeenCalledWith("site_id", siteId);
    expect(query.methods.eq).toHaveBeenCalledWith("status", "new");
    expect(query.methods.eq).toHaveBeenCalledWith("severity", "P1");
    expect(query.methods.limit).toHaveBeenCalledWith(25);
  });

  it("rejects out-of-scope site filters before creating a service-role client", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tickets?site_id=44444444-4444-4444-8444-444444444444"
      )
    );

    expect(response.status).toBe(403);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("retains the internal projection for internal callers", async () => {
    const query = ticketQuery({ data: [], error: null });
    createAdminClientMock.mockReturnValue(query.client);
    getUserScopeMock.mockResolvedValue({
      ...externalScope,
      role: "admin",
      isInternal: true,
      isCustomer: false,
      customerId: null,
      siteIds: [],
    });

    const response = await GET(new NextRequest("http://localhost/api/tickets"));

    expect(response.status).toBe(200);
    expect(query.methods.select).toHaveBeenCalledWith(
      INTERNAL_TICKET_LIST_SELECT
    );
  });

  it("contains database failures behind a generic response", async () => {
    const query = ticketQuery({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });
    createAdminClientMock.mockReturnValue(query.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(new NextRequest("http://localhost/api/tickets"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to fetch tickets" });
    expect(JSON.stringify(body)).not.toContain("private database detail");
    consoleError.mockRestore();
  });
});
