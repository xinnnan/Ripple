import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createServerClient, verifyOtp, exchangeCodeForSession, profileLocale } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  profileLocale: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  createServerClient.mockImplementation((_url, _key, options) => ({
    auth: {
      verifyOtp: async (args: unknown) => {
        const result = await verifyOtp(args);
        if (!result.error) {
          options.cookies.setAll([
            { name: "sb-access-token", value: "session", options: { path: "/" } },
          ]);
        }
        return result;
      },
      exchangeCodeForSession,
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: profileLocale }),
      }),
    }),
  }));
  profileLocale.mockResolvedValue({ data: { locale: "en" }, error: null });
});

function get(query: string) {
  return GET(new NextRequest(`https://support.example.com/auth/callback?${query}`));
}

describe("auth callback", () => {
  it("verifies an emailed recovery token server-side and keeps the session cookie", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await get("token_hash=abc123&type=recovery&next=/reset-password");

    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    expect(response.headers.get("location")).toBe(
      "https://support.example.com/reset-password"
    );
    expect(response.headers.get("set-cookie")).toContain("sb-access-token=session");
  });

  it.each(["signup", "email_change", "magiclink", ""])(
    "rejects token type %s",
    async (type) => {
      const response = await get(`token_hash=abc123&type=${type}&next=/reset-password`);
      expect(verifyOtp).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toContain("/login?error=auth_callback_failed");
    }
  );

  it("sends expired or reused links to the stable recovery path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    verifyOtp.mockResolvedValue({ error: { status: 403, code: "otp_expired" } });

    const response = await get("token_hash=abc123&type=recovery&next=/reset-password");

    expect(response.headers.get("location")).toContain("/login?error=auth_callback_failed");
  });

  it("never redirects off-site", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const response = await get("token_hash=abc&type=recovery&next=//evil.example");
    expect(new URL(response.headers.get("location")!).host).toBe("support.example.com");
  });

  it("opens the set-password page in the invitation's language", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    profileLocale.mockResolvedValue({ data: { locale: "ko" }, error: null });

    const response = await get("token_hash=abc&type=recovery&next=/reset-password");

    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("ko");
  });

  it("keeps a language this device already chose", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    profileLocale.mockResolvedValue({ data: { locale: "ko" }, error: null });

    const response = await GET(
      new NextRequest(
        "https://support.example.com/auth/callback?token_hash=abc&type=recovery&next=/reset-password",
        { headers: { cookie: "NEXT_LOCALE=es" } }
      )
    );

    expect(response.cookies.get("NEXT_LOCALE")).toBeUndefined();
    expect(profileLocale).not.toHaveBeenCalled();
  });
});
