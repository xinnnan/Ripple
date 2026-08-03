import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireAdminMock,
  createAdminClientMock,
  createSiteMock,
  MockAdminSiteMutationError,
} = vi.hoisted(() => {
  class SiteMutationError extends Error {
    constructor(
      message: string,
      readonly code?: string
    ) {
      super(message);
      this.name = "AdminSiteMutationError";
    }
  }

  return {
    requireAdminMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    createSiteMock: vi.fn(),
    MockAdminSiteMutationError: SiteMutationError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: vi.fn(),
  requireAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: vi.fn(),
  scopeSites: (query: unknown) => query,
}));

vi.mock("@/lib/sites/mutations", () => ({
  AdminSiteMutationError: MockAdminSiteMutationError,
  createAdminSiteAtomic: createSiteMock,
}));

import { POST as createSite } from "./sites/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const SITE = {
  id: SITE_ID,
  customer_id: CUSTOMER_ID,
  site_name: "Indianapolis Distribution Center",
  site_code: "INDY-01",
  timezone: "America/Indiana/Indianapolis",
  address: "100 Industrial Way",
  status: "active",
  project_status: "pre_signoff",
};

function request(body: unknown, raw = false) {
  return new NextRequest("http://localhost/api/sites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function adminClient(hydration: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(hydration);
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, eq, single };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: ADMIN_ID,
    email: "admin@dropletai.services",
    role: "admin",
  });
  createSiteMock.mockResolvedValue(SITE_ID);
  createAdminClientMock.mockReturnValue(
    adminClient({ data: SITE, error: null }).client
  );
});

describe("atomic site creation route", () => {
  it("requires admin authorization before parsing or writing", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Forbidden", status: 403 });

    const response = await createSite(request("{", true));

    expect(response.status).toBe(403);
    expect(createSiteMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects malformed and out-of-contract input before client creation", async () => {
    const malformed = await createSite(request("{", true));
    const invalidCode = await createSite(
      request({
        customer_id: CUSTOMER_ID,
        site_name: "Indianapolis DC",
        site_code: "bad code",
      })
    );
    const unknown = await createSite(
      request({
        customer_id: CUSTOMER_ID,
        site_name: "Indianapolis DC",
        site_code: "INDY-01",
        unauthorized: true,
      })
    );

    expect(malformed.status).toBe(400);
    expect(invalidCode.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(createSiteMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("normalizes bounded site data before the atomic command", async () => {
    const response = await createSite(
      request({
        customer_id: CUSTOMER_ID,
        site_name: "  Indianapolis Distribution Center  ",
        site_code: "  indy-01  ",
        timezone: "America/Indiana/Indianapolis",
        address: "  100 Industrial Way  ",
      })
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createSiteMock).toHaveBeenCalledWith({
      supabase: expect.anything(),
      actorId: ADMIN_ID,
      input: {
        customer_id: CUSTOMER_ID,
        site_name: "Indianapolis Distribution Center",
        site_code: "INDY-01",
        timezone: "America/Indiana/Indianapolis",
        address: "100 Industrial Way",
        status: "active",
        project_status: "pre_signoff",
      },
    });
  });

  it("preserves committed success when response hydration fails", async () => {
    const hydration = adminClient({
      data: null,
      error: { code: "PGRST116", message: "sensitive detail" },
    });
    createAdminClientMock.mockReturnValueOnce(hydration.client);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await createSite(
      request({
        customer_id: CUSTOMER_ID,
        site_name: "Indianapolis DC",
        site_code: "INDY-01",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      site: { id: SITE_ID },
      warning: "Site created; detail refresh is temporarily unavailable",
    });
    expect(JSON.stringify(body)).not.toContain("sensitive detail");
    expect(consoleError).toHaveBeenCalledWith(
      "POST /api/sites hydration failed:",
      { code: "PGRST116" }
    );
    consoleError.mockRestore();
  });

  it("maps uniqueness conflicts without exposing database messages", async () => {
    createSiteMock.mockRejectedValueOnce(
      new MockAdminSiteMutationError("sensitive database detail", "23505")
    );

    const response = await createSite(
      request({
        customer_id: CUSTOMER_ID,
        site_name: "Indianapolis DC",
        site_code: "INDY-01",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Site code already exists");
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});
