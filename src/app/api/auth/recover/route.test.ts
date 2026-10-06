import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { afterCallbacks, consumeLimitMock, createAdminClientMock, linkMock, sendMock } =
  vi.hoisted(() => ({
    afterCallbacks: [] as Array<() => Promise<void>>,
    consumeLimitMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    linkMock: vi.fn(),
    sendMock: vi.fn(),
  }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => Promise<void>) => afterCallbacks.push(callback) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/tickets/public-access", () => ({ consumePublicTicketLimit: consumeLimitMock }));
vi.mock("@/lib/auth/account-links", () => ({ createPasswordSetupLink: linkMock }));
vi.mock("@/lib/email/send", () => ({ sendPasswordResetEmail: sendMock }));

import { POST } from "./route";

function users(row: unknown) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  return { from: vi.fn(() => builder), builder };
}

function post(body: unknown) {
  return POST(
    new NextRequest("https://support.dropletai.services/api/auth/recover", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.20" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

async function runAfter() {
  while (afterCallbacks.length) await afterCallbacks.shift()!();
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.stubEnv("RESEND_API_KEY", "re_real_key_value_123");
  consumeLimitMock.mockResolvedValue({ allowed: true });
  linkMock.mockResolvedValue("https://support.dropletai.services/auth/callback?token_hash=x");
  sendMock.mockResolvedValue({ sent: true, id: "e1" });
});

describe("POST /api/auth/recover", () => {
  it("answers identically for existing and unknown accounts", async () => {
    const existing = users({ id: "u", email: "ana@example.com", status: "active", locale: "es" });
    createAdminClientMock.mockReturnValue(existing);
    const known = await post({ email: "  Ana@Example.com " });

    createAdminClientMock.mockReturnValue(users(null));
    const unknown = await post({ email: "nobody@example.com" });

    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    // The account lookup only happens after the response is sent.
    expect(existing.builder.eq).not.toHaveBeenCalled();
    await runAfter();
    expect(existing.builder.eq).toHaveBeenCalledWith("email", "ana@example.com");
  });

  it("sends a link in the account's language after the response", async () => {
    createAdminClientMock.mockReturnValue(
      users({ id: "u", email: "ana@example.com", status: "active", locale: "es" })
    );
    await post({ email: "ana@example.com" });
    expect(sendMock).not.toHaveBeenCalled();

    await runAfter();

    expect(sendMock).toHaveBeenCalledWith({
      to: "ana@example.com",
      link: "https://support.dropletai.services/auth/callback?token_hash=x",
      locale: "es",
    });
  });

  it.each([null, { id: "u", email: "x@example.com", status: "inactive", locale: "en" }])(
    "sends nothing for unknown or inactive accounts (%j)",
    async (row) => {
      createAdminClientMock.mockReturnValue(users(row));
      await post({ email: "x@example.com" });
      await runAfter();
      expect(linkMock).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    }
  );

  it("limits per network and per address", async () => {
    createAdminClientMock.mockReturnValue(users(null));
    consumeLimitMock.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 900,
    });

    const response = await post({ email: "ana@example.com" });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(consumeLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "password-recovery", clientIp: "198.51.100.20" })
    );
    expect(consumeLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "password-recovery-email", clientIp: "ana@example.com" })
    );
  });

  it("hands delivery back to the browser when Ripple email is disabled", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    createAdminClientMock.mockReturnValue(users(null));
    const response = await post({ email: "ana@example.com" });
    expect(await response.json()).toEqual({ delivery: "provider" });
    await runAfter();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(["{", { email: "not-an-email" }, { email: "a@b.co", extra: 1 }])(
    "rejects invalid input %j",
    async (body) => {
      createAdminClientMock.mockReturnValue(users(null));
      expect((await post(body)).status).toBe(400);
    }
  );

  it("fails closed when the limiter is unavailable", async () => {
    createAdminClientMock.mockReturnValue(users(null));
    consumeLimitMock.mockRejectedValue(new Error("down"));
    expect((await post({ email: "ana@example.com" })).status).toBe(503);
  });
});
