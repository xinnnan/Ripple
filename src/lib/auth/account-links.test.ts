import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPasswordSetupLink } from "./account-links";

function admin(result: { data: unknown; error: unknown }) {
  const generateLink = vi.fn().mockResolvedValue(result);
  return {
    client: { auth: { admin: { generateLink } } } as unknown as SupabaseClient,
    generateLink,
  };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://support.dropletai.services");
});
afterEach(() => vi.unstubAllEnvs());

describe("createPasswordSetupLink", () => {
  it("builds a same-origin callback link from the hashed recovery token", async () => {
    const { client, generateLink } = admin({
      data: { properties: { hashed_token: "hashed-abc" } },
      error: null,
    });

    const link = await createPasswordSetupLink(client, "user@example.com");

    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "user@example.com" });
    const url = new URL(link!);
    expect(url.origin).toBe("https://support.dropletai.services");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("token_hash")).toBe("hashed-abc");
    expect(url.searchParams.get("type")).toBe("recovery");
    expect(url.searchParams.get("next")).toBe("/reset-password");
  });

  it("returns null for unknown accounts or provider failures", async () => {
    expect(
      await createPasswordSetupLink(
        admin({ data: null, error: { status: 404, code: "user_not_found" } }).client,
        "nobody@example.com"
      )
    ).toBeNull();
    expect(
      await createPasswordSetupLink(admin({ data: { properties: {} }, error: null }).client, "x@example.com")
    ).toBeNull();
  });
});
