import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { appShell, createClient, redirect } = vi.hoisted(() => ({
  appShell: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/app-shell", () => ({ AppShell: appShell }));

import AuthLayout from "@/app/(auth)/layout";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function makeClient(options?: {
  authUser?: { id: string } | null;
  authError?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  profileError?: Record<string, unknown> | null;
}) {
  const result = {
    data:
      options && "profile" in options
        ? options.profile ?? null
        : {
            role: "admin",
            email: "admin@dropletai.services",
            status: "active",
          },
    error: options?.profileError ?? null,
  };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user:
            options && "authUser" in options
              ? options.authUser ?? null
              : { id: USER_ID },
        },
        error: options?.authError ?? null,
      }),
    },
    from: vi.fn(() => query),
  };
}

async function expectSafeFailure(context: string) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(AuthLayout({ children: "content" })).rejects.toThrow(
    "Account data is temporarily unavailable"
  );
  expect(redirect).not.toHaveBeenCalled();
  expect(JSON.stringify(consoleError.mock.calls)).toContain(context);
  expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
    "sensitive provider detail"
  );

  consoleError.mockRestore();
}

describe("authenticated layout identity-read integrity", () => {
  beforeEach(() => {
    createClient.mockReset();
    redirect.mockClear();
  });

  it("redirects a normal signed-out request to login", async () => {
    createClient.mockResolvedValue(
      makeClient({
        authUser: null,
        authError: { name: "AuthSessionMissingError" },
      })
    );

    await expect(AuthLayout({ children: "content" })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects a rejected token to login", async () => {
    createClient.mockResolvedValue(
      makeClient({
        authUser: null,
        authError: { name: "AuthApiError", status: 401, code: "bad_jwt" },
      })
    );

    await expect(AuthLayout({ children: "content" })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("surfaces identity-provider failure instead of redirecting", async () => {
    createClient.mockResolvedValue(
      makeClient({
        authUser: null,
        authError: {
          name: "AuthRetryableFetchError",
          code: "XX000",
          status: 503,
          message: "sensitive provider detail",
        },
      })
    );

    await expectSafeFailure("auth-layout/auth");
  });

  it("surfaces profile-read failure instead of claiming inactivity", async () => {
    createClient.mockResolvedValue(
      makeClient({
        profileError: {
          code: "XX000",
          message: "sensitive provider detail",
        },
      })
    );

    await expectSafeFailure("auth-layout/profile");
  });

  it.each([null, { role: "customer", email: "user@example.com", status: "inactive" }])(
    "redirects a missing or inactive profile to the inactive account path",
    async (profile) => {
      createClient.mockResolvedValue(makeClient({ profile }));

      await expect(AuthLayout({ children: "content" })).rejects.toThrow(
        "NEXT_REDIRECT"
      );
      expect(redirect).toHaveBeenCalledWith("/login?account=inactive");
    }
  );

  it("builds the shell from an active profile", async () => {
    createClient.mockResolvedValue(makeClient());

    const result = await AuthLayout({ children: "content" });

    expect(result.type).toBe(appShell);
    expect(result.props).toMatchObject({
      role: "admin",
      email: "admin@dropletai.services",
      isAdmin: true,
      isManager: false,
      isInternal: true,
      children: "content",
    });
  });
});
