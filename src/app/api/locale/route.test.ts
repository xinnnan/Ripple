import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createClientMock, createAdminClientMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("https://support.example.com/api/locale", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function signedIn(userId: string | null) {
  createClientMock.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: "ko", error: null });
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
});

describe("POST /api/locale", () => {
  it("sets a year-long, same-site language cookie for guests without touching the database", async () => {
    signedIn(null);
    const response = await post({ locale: "es" });

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("NEXT_LOCALE=es");
    expect(cookie).toMatch(/Max-Age=31536000/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("persists the preference for signed-in accounts so emails follow it", async () => {
    signedIn("11111111-1111-4111-8111-111111111111");
    const response = await post({ locale: "ko" });

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("set_user_locale_atomic", {
      p_actor_id: "11111111-1111-4111-8111-111111111111",
      p_user_id: "11111111-1111-4111-8111-111111111111",
      p_locale: "ko",
    });
  });

  it("still switches the interface when saving the preference fails", async () => {
    signedIn("11111111-1111-4111-8111-111111111111");
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "inactive" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await post({ locale: "zh" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: "zh", saved: false });
    expect(response.headers.get("set-cookie")).toContain("NEXT_LOCALE=zh");
  });

  it.each([{ locale: "fr" }, { locale: "en", extra: 1 }, {}, "{"])(
    "rejects invalid input %j",
    async (body) => {
      signedIn(null);
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  );
});
