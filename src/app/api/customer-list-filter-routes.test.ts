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
  requireAdmin: vi.fn(),
  requireInternal: vi.fn(),
}));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: getUserScopeMock,
  scopeSiteRows: (query: unknown) => query,
  scopeSites: (query: unknown) => query,
}));

import { GET as getSparePartRequests } from "./spare-part-requests/route";
import { GET as getFieldServiceOrders } from "./field-service-orders/route";
import { GET as getSites } from "./sites/route";

type QueryResult = { data: unknown; error: unknown };

function queryClient(result: QueryResult = { data: [], error: null }) {
  const methods: Record<string, ReturnType<typeof vi.fn>> = {};
  const builder = {
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  } as Record<string, unknown>;
  for (const method of ["select", "order", "eq", "in"]) {
    methods[method] = vi.fn(() => builder);
    builder[method] = methods[method];
  }
  return { client: { from: vi.fn(() => builder) }, methods };
}

const customerId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";
const ticketId = "33333333-3333-4333-8333-333333333333";
const externalScope = {
  userId: "44444444-4444-4444-8444-444444444444",
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

describe("customer-capable resource list routes", () => {
  it.each([
    [getSparePartRequests, "/api/spare-part-requests?status=unknown"],
    [getFieldServiceOrders, "/api/field-service-orders?service_type=unknown"],
    [getSites, "/api/sites?customer_id=not-a-uuid"],
  ])("rejects malformed filters before client creation: %s", async (handler, path) => {
    const response = await handler(new NextRequest(`http://localhost${path}`));

    expect(response.status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it.each([
    getSparePartRequests,
    getFieldServiceOrders,
  ])("rejects an out-of-scope site before client creation", async (handler) => {
    const response = await handler(
      new NextRequest(
        "http://localhost/resource?site_id=55555555-5555-4555-8555-555555555555"
      )
    );

    expect(response.status).toBe(403);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("applies validated spare-part request filters with private delivery", async () => {
    const query = queryClient();
    createAdminClientMock.mockReturnValue(query.client);
    const response = await getSparePartRequests(
      new NextRequest(
        `http://localhost/api/spare-part-requests?status=shipped&site_id=${siteId}&ticket_id=${ticketId}`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.eq).toHaveBeenCalledWith("status", "shipped");
    expect(query.methods.eq).toHaveBeenCalledWith("site_id", siteId);
    expect(query.methods.eq).toHaveBeenCalledWith("ticket_id", ticketId);
  });

  it("applies validated field-service filters with private delivery", async () => {
    const query = queryClient();
    createAdminClientMock.mockReturnValue(query.client);
    const response = await getFieldServiceOrders(
      new NextRequest(
        `http://localhost/api/field-service-orders?status=scheduled&site_id=${siteId}&ticket_id=${ticketId}&service_type=inspection`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.eq).toHaveBeenCalledWith("status", "scheduled");
    expect(query.methods.eq).toHaveBeenCalledWith("site_id", siteId);
    expect(query.methods.eq).toHaveBeenCalledWith("ticket_id", ticketId);
    expect(query.methods.eq).toHaveBeenCalledWith(
      "service_type",
      "inspection"
    );
  });

  it("applies an authorized customer filter to private site data", async () => {
    const query = queryClient();
    createAdminClientMock.mockReturnValue(query.client);
    const response = await getSites(
      new NextRequest(`http://localhost/api/sites?customer_id=${customerId}`)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.methods.eq).toHaveBeenCalledWith("customer_id", customerId);
  });

  it("rejects a foreign customer site-list filter before client creation", async () => {
    const response = await getSites(
      new NextRequest(
        "http://localhost/api/sites?customer_id=66666666-6666-4666-8666-666666666666"
      )
    );

    expect(response.status).toBe(403);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});
