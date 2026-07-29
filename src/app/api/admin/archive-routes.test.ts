import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAdminMock, rpcMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

import { POST as archiveCustomers } from "./customers/bulk-archive/route";
import { POST as archiveSites } from "./sites/bulk-archive/route";
import { POST as deactivateUsers } from "./users/bulk-deactivate/route";
import { POST as deleteCustomers } from "./customers/bulk-delete/route";
import { POST as deleteSites } from "./sites/bulk-delete/route";
import { POST as deleteUsers } from "./users/bulk-delete/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAdminMock.mockReset();
  rpcMock.mockReset();
  requireAdminMock.mockResolvedValue({
    userId: ADMIN_ID,
    role: "admin",
    email: "admin@dropletai.services",
  });
});

describe("retired hard-delete routes", () => {
  it.each([
    ["customer", deleteCustomers, "/api/admin/customers/bulk-archive"],
    ["site", deleteSites, "/api/admin/sites/bulk-archive"],
    ["user", deleteUsers, "/api/admin/users/bulk-deactivate"],
  ])("permanently disables %s deletion", async (_label, handler, replacement) => {
    const response = await handler();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: "HARD_DELETE_DISABLED",
      replacement,
    });
  });
});

describe("archive/deactivate commands", () => {
  it("requires an active admin before invoking a command", async () => {
    requireAdminMock.mockResolvedValueOnce({
      error: "Forbidden: Account is not active",
      status: 403,
    });

    const response = await archiveCustomers(request({ ids: [CUSTOMER_ID] }));

    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("validates identifiers before invoking a command", async () => {
    const response = await archiveSites(request({ ids: ["not-a-uuid"] }));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("archives customers through the transactional RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          customers_changed: 1,
          sites_changed: 2,
          users_changed: 3,
        },
      ],
      error: null,
    });

    const response = await archiveCustomers(
      request({ ids: [CUSTOMER_ID, CUSTOMER_ID] })
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("archive_customers", {
      p_ids: [CUSTOMER_ID, CUSTOMER_ID],
      p_actor_id: ADMIN_ID,
    });
    await expect(response.json()).resolves.toEqual({
      processed: 1,
      changed: 1,
      sites_decommissioned: 2,
      users_deactivated: 3,
    });
  });

  it("archives sites through the transactional RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ sites_changed: 1 }],
      error: null,
    });

    const response = await archiveSites(request({ ids: [SITE_ID] }));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("archive_sites", {
      p_ids: [SITE_ID],
      p_actor_id: ADMIN_ID,
    });
    await expect(response.json()).resolves.toEqual({
      processed: 1,
      changed: 1,
    });
  });

  it("rejects self-deactivation before invoking the database", async () => {
    const response = await deactivateUsers(request({ ids: [ADMIN_ID] }));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("deactivates users through the transactional RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ users_changed: 1 }],
      error: null,
    });

    const response = await deactivateUsers(request({ ids: [USER_ID] }));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("deactivate_users", {
      p_ids: [USER_ID],
      p_actor_id: ADMIN_ID,
    });
    await expect(response.json()).resolves.toEqual({
      processed: 1,
      changed: 1,
    });
  });

  it("does not expose database details when a command fails", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "sensitive database detail" },
    });

    const response = await archiveSites(request({ ids: [SITE_ID] }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toContain("sensitive database detail");
  });
});
