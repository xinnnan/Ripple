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

import { PATCH } from "./[id]/slack/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown, raw = false): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/users/${USER_ID}/slack`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw ? String(body) : JSON.stringify(body),
    }
  );
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

describe("administrator Slack identity route", () => {
  it("requires an active administrator before database access", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Forbidden", status: 403 });

    const response = await PATCH(
      request({ slack_user_id: "U012ABCDEF0" }),
      context()
    );

    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, invalid users, and unknown fields", async () => {
    const malformed = await PATCH(request("{", true), context());
    const invalidUser = await PATCH(
      request({ slack_user_id: "U012ABCDEF0" }),
      context("not-a-uuid")
    );
    const unknownField = await PATCH(
      request({ slack_user_id: "U012ABCDEF0", role: "admin" }),
      context()
    );

    expect(malformed.status).toBe(400);
    expect(invalidUser.status).toBe(400);
    expect(unknownField.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each(["", "U123", "B012ABCDEF0", "U012-ABCDEF", "U012 ABCDEF"])(
    "rejects an invalid Slack member ID: %j",
    async (slackUserId) => {
      const response = await PATCH(
        request({ slack_user_id: slackUserId }),
        context()
      );

      expect(response.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    }
  );

  it("normalizes and routes a valid mapping through the atomic command", async () => {
    rpcMock.mockResolvedValueOnce({ data: USER_ID, error: null });

    const response = await PATCH(
      request({ slack_user_id: "  u012abcdef0  " }),
      context()
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_admin_user_slack_identity",
      {
        p_actor_id: ADMIN_ID,
        p_target_user_id: USER_ID,
        p_slack_user_id: "U012ABCDEF0",
      }
    );
  });

  it("supports an explicit unlink without overloading an empty string", async () => {
    rpcMock.mockResolvedValueOnce({ data: USER_ID, error: null });

    const response = await PATCH(
      request({ slack_user_id: null }),
      context()
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_admin_user_slack_identity",
      expect.objectContaining({ p_slack_user_id: null })
    );
  });

  it.each([
    ["23505", 409, "SLACK_IDENTITY_IN_USE"],
    ["55000", 409, "SLACK_IDENTITY_INACTIVE_USER"],
    ["42501", 403, "SLACK_IDENTITY_FORBIDDEN"],
    ["P0002", 404, "USER_NOT_FOUND"],
    ["22023", 400, "SLACK_IDENTITY_INVALID"],
  ])(
    "maps command code %s to a bounded response",
    async (code, status, responseCode) => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code, message: "private database detail" },
      });

      const response = await PATCH(
        request({ slack_user_id: "U012ABCDEF0" }),
        context()
      );
      const body = await response.json();

      expect(response.status).toBe(status);
      expect(body.code).toBe(responseCode);
      expect(JSON.stringify(body)).not.toContain("private database detail");
    }
  );

  it("contains unexpected command failures", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await PATCH(
      request({ slack_user_id: "U012ABCDEF0" }),
      context()
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to update Slack identity");
    expect(body.error).not.toContain("private database detail");
    expect(consoleError).toHaveBeenCalledWith(
      "apply_admin_user_slack_identity RPC failed:",
      { code: "XX000" }
    );
    consoleError.mockRestore();
  });
});
