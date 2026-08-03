import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  EXTERNAL_SITE_SELECT,
  EXTERNAL_TICKET_COMMENT_SELECT,
  INTERNAL_TICKET_COMMENT_SELECT,
} from "@/lib/resource-projections";

const {
  createAdminClientMock,
  getAuthUserMock,
  getUserScopeMock,
  requireAdminMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getAuthUserMock: vi.fn(),
  getUserScopeMock: vi.fn(),
  requireAdminMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: getAuthUserMock,
  requireAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: getUserScopeMock,
  scopeSites: (query: unknown) => query,
  scopeTickets: (query: unknown) => query,
}));
vi.mock("@/lib/tickets/lookup", () => ({
  resolveTicketQuery: (query: unknown) => query,
}));

import { GET as getSites } from "./sites/route";
import { GET as getComments } from "./tickets/[ticketId]/comments/route";

type QueryResult = { data: unknown; error: unknown };

function adminClient(results: Record<string, QueryResult>) {
  const queries = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const from = vi.fn((table: string) => {
    const methods: Record<string, ReturnType<typeof vi.fn>> = {};
    const result = results[table] ?? { data: [], error: null };
    const builder = {
      then: (
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(result).then(onFulfilled, onRejected),
      maybeSingle: vi.fn(() => Promise.resolve(result)),
    } as Record<string, unknown>;

    for (const method of ["select", "eq", "in", "or", "order"]) {
      methods[method] = vi.fn(() => builder);
      builder[method] = methods[method];
    }
    methods.maybeSingle = builder.maybeSingle as ReturnType<typeof vi.fn>;
    queries.set(table, methods);
    return builder;
  });

  return { client: { from }, queries };
}

const externalScope = {
  userId: "customer-user",
  role: "customer",
  email: "customer@example.com",
  fullName: "Customer",
  customerId: "customer-org",
  isInternal: false,
  isManager: false,
  isCustomer: true,
  siteIds: ["site-a"],
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUserMock.mockResolvedValue({
    userId: "customer-user",
    role: "customer",
    isInternal: false,
  });
  getUserScopeMock.mockResolvedValue(externalScope);
});

describe("authenticated customer query projections", () => {
  it("selects only the external site allow-list for customer roles", async () => {
    const mock = adminClient({
      sites: { data: [{ id: "site-a" }], error: null },
    });
    createAdminClientMock.mockReturnValue(mock.client);

    const response = await getSites(
      new NextRequest("http://localhost/api/sites")
    );

    expect(response.status).toBe(200);
    expect(mock.queries.get("sites")?.select).toHaveBeenCalledWith(
      EXTERNAL_SITE_SELECT
    );
  });

  it("retains the full site projection only for internal callers", async () => {
    const mock = adminClient({ sites: { data: [], error: null } });
    createAdminClientMock.mockReturnValue(mock.client);
    getUserScopeMock.mockResolvedValue({
      ...externalScope,
      role: "engineer",
      isInternal: true,
      isCustomer: false,
      siteIds: [],
    });

    await getSites(new NextRequest("http://localhost/api/sites"));

    expect(mock.queries.get("sites")?.select).toHaveBeenCalledWith(
      "*, customer:customers(id, name)"
    );
  });

  it("selects customer-safe comment attribution and visibility", async () => {
    const mock = adminClient({
      tickets: { data: { id: "ticket-a" }, error: null },
      ticket_comments: {
        data: [{ id: "comment-a", body: "Update" }],
        error: null,
      },
    });
    createAdminClientMock.mockReturnValue(mock.client);

    const response = await getComments(
      new NextRequest("http://localhost/api/tickets/RPL-000001/comments"),
      { params: Promise.resolve({ ticketId: "RPL-000001" }) }
    );

    expect(response.status).toBe(200);
    expect(mock.queries.get("ticket_comments")?.select).toHaveBeenCalledWith(
      EXTERNAL_TICKET_COMMENT_SELECT
    );
    expect(mock.queries.get("ticket_comments")?.eq).toHaveBeenCalledWith(
      "visibility",
      "customer"
    );
  });

  it("uses the internal comment projection only for internal scope", async () => {
    const mock = adminClient({
      tickets: { data: { id: "ticket-a" }, error: null },
      ticket_comments: { data: [], error: null },
    });
    createAdminClientMock.mockReturnValue(mock.client);
    getUserScopeMock.mockResolvedValue({
      ...externalScope,
      role: "admin",
      isInternal: true,
      isCustomer: false,
      siteIds: [],
    });

    await getComments(
      new NextRequest(
        "http://localhost/api/tickets/RPL-000001/comments?visibility=internal"
      ),
      { params: Promise.resolve({ ticketId: "RPL-000001" }) }
    );

    expect(mock.queries.get("ticket_comments")?.select).toHaveBeenCalledWith(
      INTERNAL_TICKET_COMMENT_SELECT
    );
    expect(mock.queries.get("ticket_comments")?.eq).toHaveBeenCalledWith(
      "visibility",
      "internal"
    );
  });
});
