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

import { PATCH } from "./[id]/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown, raw = false): NextRequest {
  return new NextRequest(`http://localhost/api/admin/users/${USER_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function context(id = USER_ID) {
  return { params: Promise.resolve({ id }) };
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

describe("admin user patch route", () => {
  it("requires an active administrator before invoking the command", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Forbidden", status: 403 });

    const response = await PATCH(request({ role: "engineer" }), context());

    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies and identifiers before invoking the command", async () => {
    const malformed = await PATCH(request("{", true), context());
    const invalidId = await PATCH(
      request({ role: "engineer" }),
      context("not-a-uuid")
    );

    expect(malformed.status).toBe(400);
    expect(invalidId.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("keeps inactive state behind the dedicated deactivation workflow", async () => {
    const response = await PATCH(request({ status: "inactive" }), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEACTIVATION_REQUIRED",
      replacement: "/api/admin/users/bulk-deactivate",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects self-demotion before invoking the command", async () => {
    const response = await PATCH(
      request({ role: "engineer" }),
      context(ADMIN_ID)
    );

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("routes valid changes through the atomic command", async () => {
    rpcMock.mockResolvedValueOnce({ data: USER_ID, error: null });

    const response = await PATCH(
      request({ full_name: "Updated User", role: "customer" }),
      context()
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("apply_admin_user_patch", {
      p_actor_id: ADMIN_ID,
      p_target_user_id: USER_ID,
      p_patch: { full_name: "Updated User", role: "customer" },
    });
  });

  it("maps guarded transitions without exposing database details", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "sensitive database detail" },
    });

    const response = await PATCH(request({ role: "admin" }), context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("USER_TRANSITION_REQUIRED");
    expect(body.error).not.toContain("sensitive database detail");
  });

  it("returns a generic error for unexpected command failures", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "sensitive database detail" },
    });

    const response = await PATCH(request({ full_name: "Updated" }), context());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to update user");
    expect(body.error).not.toContain("sensitive database detail");
  });
});
