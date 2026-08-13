import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SelfServiceProfileMutationError } from "@/lib/profile/mutations";

const { createAdminClient, getAuthUser, updateOwnProfile } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getAuthUser: vi.fn(),
  updateOwnProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/auth-helpers", () => ({ getAuthUser }));
vi.mock("@/lib/profile/mutations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/profile/mutations")>();
  return { ...original, updateOwnProfile };
});

import { PATCH } from "./route";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("self-service profile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({
      userId: ACTOR_ID,
      role: "customer",
      email: "alex@example.com",
      customerId: "22222222-2222-4222-8222-222222222222",
      fullName: "Alex",
      isInternal: false,
      isManager: false,
    });
    createAdminClient.mockReturnValue({ rpc: vi.fn() });
    updateOwnProfile.mockResolvedValue({
      id: ACTOR_ID,
      fullName: "Alex Rivera",
      phone: null,
      changedFields: ["full_name"],
    });
  });

  it("authenticates before parsing or creating a service client", async () => {
    getAuthUser.mockResolvedValue({ error: "Unauthorized", status: 401 });
    const malformed = new NextRequest("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await PATCH(malformed);

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(updateOwnProfile).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects malformed and broadened request bodies", async () => {
    const malformed = new NextRequest("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const malformedResponse = await PATCH(malformed);
    const broadenedResponse = await PATCH(
      request({
        full_name: "Alex",
        phone: null,
        role: "admin",
        actor_id: "33333333-3333-4333-8333-333333333333",
      })
    );

    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toEqual({
      error: "Invalid JSON body",
    });
    expect(broadenedResponse.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("uses only the authenticated actor and normalized allow-listed fields", async () => {
    const serviceClient = { rpc: vi.fn() };
    createAdminClient.mockReturnValue(serviceClient);

    const response = await PATCH(
      request({ full_name: "  Alex Rivera  ", phone: "   " })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(updateOwnProfile).toHaveBeenCalledWith({
      supabase: serviceClient,
      actorId: ACTOR_ID,
      fullName: "Alex Rivera",
      phone: null,
    });
    expect(await response.json()).toEqual({
      profile: {
        id: ACTOR_ID,
        full_name: "Alex Rivera",
        phone: null,
      },
      changed_fields: ["full_name"],
    });
  });

  it.each([
    ["P0002", 404, "PROFILE_NOT_FOUND"],
    ["42501", 403, "PROFILE_FORBIDDEN"],
    ["22023", 400, "PROFILE_INVALID"],
  ])("maps command code %s to a stable response", async (code, status, apiCode) => {
    updateOwnProfile.mockRejectedValue(
      new SelfServiceProfileMutationError("private detail", code)
    );

    const response = await PATCH(
      request({ full_name: "Alex Rivera", phone: null })
    );
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.code).toBe(apiCode);
    expect(JSON.stringify(body)).not.toContain("private detail");
  });

  it("contains unexpected command detail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    updateOwnProfile.mockRejectedValue(
      new SelfServiceProfileMutationError("sensitive database detail", "XX000")
    );

    const response = await PATCH(
      request({ full_name: "Alex Rivera", phone: null })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Unable to update profile" });
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
    expect(consoleError).toHaveBeenCalledWith(
      "update_own_profile RPC failed:",
      { code: "XX000" }
    );
    consoleError.mockRestore();
  });
});
