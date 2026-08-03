import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  createAdminClientMock,
  getUserScopeMock,
  requireInternalMock,
  getAuthUserMock,
  requireAdminMock,
  patchSpareMock,
  patchFieldMock,
  patchTeamMock,
  patchSiteMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserScopeMock: vi.fn(),
  requireInternalMock: vi.fn(),
  getAuthUserMock: vi.fn(),
  requireAdminMock: vi.fn(),
  patchSpareMock: vi.fn(),
  patchFieldMock: vi.fn(),
  patchTeamMock: vi.fn(),
  patchSiteMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: getAuthUserMock,
  requireAdmin: requireAdminMock,
  requireInternal: requireInternalMock,
}));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: getUserScopeMock,
  scopeSiteRows: (query: unknown) => query,
}));
vi.mock("@/lib/spare-parts/mutations", () => ({
  applySparePartRequestPatch: patchSpareMock,
  SparePartRequestMutationError: class extends Error {},
}));
vi.mock("@/lib/field-service/mutations", () => ({
  applyFieldServiceOrderPatch: patchFieldMock,
  FieldServiceOrderMutationError: class extends Error {},
}));
vi.mock("@/lib/team/mutations", () => ({
  applyTeamMemberPatch: patchTeamMock,
  TeamMemberMutationError: class extends Error {},
}));
vi.mock("@/lib/sites/mutations", () => ({
  applyAdminSitePatch: patchSiteMock,
  AdminSiteMutationError: class extends Error {},
}));

import {
  GET as getSparePartRequest,
  PATCH as patchSparePartRequest,
} from "./spare-part-requests/[id]/route";
import {
  GET as getFieldServiceOrder,
  PATCH as patchFieldServiceOrder,
} from "./field-service-orders/[id]/route";
import { PATCH as patchTeamMember } from "./team/[id]/route";
import { PATCH as patchAdminSite } from "./admin/sites/[id]/route";

type QueryResult = { data: unknown; error: unknown };

function queryClient(result: QueryResult) {
  const methods: Record<string, ReturnType<typeof vi.fn>> = {};
  const builder = {
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  } as Record<string, unknown>;
  for (const method of ["select", "eq", "in"]) {
    methods[method] = vi.fn(() => builder);
    builder[method] = methods[method];
  }
  return { client: { from: vi.fn(() => builder) }, methods };
}

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const scope = {
  userId: "22222222-2222-4222-8222-222222222222",
  role: "customer",
  email: "customer@example.com",
  fullName: "Customer",
  customerId: "33333333-3333-4333-8333-333333333333",
  isInternal: false,
  isManager: false,
  isCustomer: true,
  siteIds: ["44444444-4444-4444-8444-444444444444"],
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserScopeMock.mockResolvedValue(scope);
  requireInternalMock.mockResolvedValue({
    userId: scope.userId,
    role: "engineer",
    isInternal: true,
  });
  getAuthUserMock.mockResolvedValue({
    userId: scope.userId,
    role: "customer_manager",
    isManager: true,
    customerId: scope.customerId,
  });
  requireAdminMock.mockResolvedValue({
    userId: scope.userId,
    role: "admin",
  });
});

const detailHandlers = [getSparePartRequest, getFieldServiceOrder] as const;

describe("resource route identifiers", () => {
  it.each(detailHandlers)(
    "rejects malformed customer-capable detail ids before client creation",
    async (handler) => {
      const response = await handler(
        new NextRequest("http://localhost/resource/not-a-uuid"),
        { params: Promise.resolve({ id: "not-a-uuid" }) }
      );

      expect(response.status).toBe(400);
      expect(createAdminClientMock).not.toHaveBeenCalled();
    }
  );

  it.each(detailHandlers)(
    "distinguishes database failures from missing detail rows",
    async (handler) => {
      const query = queryClient({
        data: null,
        error: { code: "XX000", message: "private database detail" },
      });
      createAdminClientMock.mockReturnValue(query.client);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await handler(
        new NextRequest(`http://localhost/resource/${VALID_ID}`),
        { params: Promise.resolve({ id: VALID_ID }) }
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain("private database detail");
      consoleError.mockRestore();
    }
  );

  it.each(detailHandlers)("marks authenticated detail data private", async (handler) => {
    const query = queryClient({ data: { id: VALID_ID }, error: null });
    createAdminClientMock.mockReturnValue(query.client);

    const response = await handler(
      new NextRequest(`http://localhost/resource/${VALID_ID}`),
      { params: Promise.resolve({ id: VALID_ID }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    [patchSparePartRequest, patchSpareMock],
    [patchFieldServiceOrder, patchFieldMock],
    [patchTeamMember, patchTeamMock],
    [patchAdminSite, patchSiteMock],
  ] as const)(
    "rejects malformed mutation ids before body parsing and command access",
    async (handler, command) => {
      const response = await handler(
        new NextRequest("http://localhost/resource/not-a-uuid", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        { params: Promise.resolve({ id: "not-a-uuid" }) }
      );

      expect(response.status).toBe(400);
      expect(command).not.toHaveBeenCalled();
      expect(createAdminClientMock).not.toHaveBeenCalled();
    }
  );
});
