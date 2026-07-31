import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireAdminMock,
  getAuthUserMock,
  provisionAdminUserMock,
  provisionTeamUserMock,
  MockUserProvisioningError,
} = vi.hoisted(() => {
  class ProvisioningError extends Error {
    constructor(
      message: string,
      readonly phase: "auth" | "finalize" | "reconcile",
      readonly code?: string,
      readonly reconciliationRequired = false
    ) {
      super(message);
      this.name = "UserProvisioningError";
    }
  }
  return {
    requireAdminMock: vi.fn(),
    getAuthUserMock: vi.fn(),
    provisionAdminUserMock: vi.fn(),
    provisionTeamUserMock: vi.fn(),
    MockUserProvisioningError: ProvisioningError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ client: "admin" }),
}));

vi.mock("@/lib/users/provisioning", () => ({
  UserProvisioningError: MockUserProvisioningError,
  provisionAdminUser: provisionAdminUserMock,
  provisionTeamUser: provisionTeamUserMock,
}));

import { POST as createAdminUser } from "./admin/users/route";
import { POST as createTeamUser } from "./team/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SITE_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

function request(path: string, body: unknown, raw = false) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAdminMock.mockReset();
  getAuthUserMock.mockReset();
  provisionAdminUserMock.mockReset();
  provisionTeamUserMock.mockReset();
  requireAdminMock.mockResolvedValue({
    userId: ADMIN_ID,
    email: "admin@dropletai.services",
    role: "admin",
  });
  getAuthUserMock.mockResolvedValue({
    userId: MANAGER_ID,
    email: "manager@example.com",
    role: "customer_manager",
    isManager: true,
    customerId: CUSTOMER_ID,
  });
});

describe("admin user provisioning route", () => {
  it("requires administrator authorization before provisioning", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Forbidden", status: 403 });

    const response = await createAdminUser(
      request("/api/admin/users", { role: "engineer" })
    );

    expect(response.status).toBe(403);
    expect(provisionAdminUserMock).not.toHaveBeenCalled();
  });

  it("rejects customer roles, weak passwords, and malformed JSON", async () => {
    const invalid = await createAdminUser(
      request("/api/admin/users", {
        email: "user@example.com",
        password: "short",
        full_name: "User",
        role: "customer",
      })
    );
    const malformed = await createAdminUser(
      request("/api/admin/users", "{", true)
    );

    expect(invalid.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(provisionAdminUserMock).not.toHaveBeenCalled();
  });

  it("passes valid internal accounts to the secure provisioner", async () => {
    provisionAdminUserMock.mockResolvedValueOnce({
      id: USER_ID,
      email: "engineer@example.com",
    });

    const response = await createAdminUser(
      request("/api/admin/users", {
        email: "engineer@example.com",
        password: "a-secure-password-123",
        full_name: "New Engineer",
        role: "engineer",
      })
    );

    expect(response.status).toBe(201);
    expect(provisionAdminUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        email: "engineer@example.com",
        fullName: "New Engineer",
        role: "engineer",
      })
    );
  });

  it("maps duplicate Auth identities without exposing provider details", async () => {
    provisionAdminUserMock.mockRejectedValueOnce(
      new MockUserProvisioningError(
        "sensitive provider detail",
        "auth",
        "email_exists"
      )
    );

    const response = await createAdminUser(
      request("/api/admin/users", {
        email: "existing@example.com",
        password: "a-secure-password-123",
        full_name: "Existing",
        role: "admin",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("USER_EMAIL_EXISTS");
    expect(body.error).not.toContain("sensitive provider detail");
  });
});

describe("team user provisioning route", () => {
  it("requires an active customer manager with a tenant", async () => {
    getAuthUserMock.mockResolvedValueOnce({
      userId: USER_ID,
      isManager: false,
      customerId: null,
    });

    const response = await createTeamUser(
      request("/api/team", { email: "user@example.com" })
    );

    expect(response.status).toBe(403);
    expect(provisionTeamUserMock).not.toHaveBeenCalled();
  });

  it("passes the manager tenant and complete site set to the provisioner", async () => {
    provisionTeamUserMock.mockResolvedValueOnce({
      id: USER_ID,
      email: "customer@example.com",
    });

    const response = await createTeamUser(
      request("/api/team", {
        email: "customer@example.com",
        password: "a-secure-password-123",
        full_name: "New Customer",
        site_ids: [SITE_ID],
      })
    );

    expect(response.status).toBe(201);
    expect(provisionTeamUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: MANAGER_ID,
        customerId: CUSTOMER_ID,
        siteIds: [SITE_ID],
      })
    );
  });

  it("surfaces ambiguous outcomes as an operator reconciliation error", async () => {
    provisionTeamUserMock.mockRejectedValueOnce(
      new MockUserProvisioningError(
        "unknown outcome",
        "reconcile",
        undefined,
        true
      )
    );

    const response = await createTeamUser(
      request("/api/team", {
        email: "customer@example.com",
        password: "a-secure-password-123",
        full_name: "New Customer",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("USER_PROVISIONING_RECONCILIATION_REQUIRED");
    expect(body.error).not.toContain("unknown outcome");
  });
});
