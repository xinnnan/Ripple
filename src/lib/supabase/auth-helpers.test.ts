import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getAuthUser, requireAdmin, requireInternal } from "./auth-helpers";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface ReadResult {
  data: unknown;
  error: Record<string, unknown> | null;
}

function makeClient(options?: {
  authUser?: { id: string } | null;
  authError?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  profileError?: Record<string, unknown> | null;
}) {
  const profileResult: ReadResult = {
    data:
      options && "profile" in options
        ? options.profile ?? null
        : {
            role: "admin",
            email: "admin@dropletai.services",
            customer_id: null,
            full_name: "Admin User",
            status: "active",
          },
    error: options?.profileError ?? null,
  };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(profileResult),
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

const helpers = [
  ["requireAdmin", requireAdmin],
  ["requireInternal", requireInternal],
  ["getAuthUser", getAuthUser],
] as const;

async function expectSafeUnavailable(
  helper: () => Promise<unknown>,
  expectedContext: string
) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(helper()).resolves.toEqual({
    error: "Authentication service unavailable",
    status: 503,
  });
  expect(JSON.stringify(consoleError.mock.calls)).toContain(expectedContext);
  expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
    "sensitive provider detail"
  );

  consoleError.mockRestore();
}

describe("API authorization helper read integrity", () => {
  beforeEach(() => {
    createClient.mockReset();
  });

  it.each(helpers)("%s preserves the normal signed-out 401 path", async (_, helper) => {
    createClient.mockResolvedValue(
      makeClient({
        authUser: null,
        authError: { name: "AuthSessionMissingError", message: "normal" },
      })
    );

    await expect(helper()).resolves.toEqual({
      error: "Unauthorized",
      status: 401,
    });
  });

  it("preserves rejected-token errors as an unauthenticated path", async () => {
    createClient.mockResolvedValue(
      makeClient({
        authUser: null,
        authError: {
          name: "AuthApiError",
          status: 401,
          code: "bad_jwt",
          message: "invalid token detail",
        },
      })
    );

    await expect(getAuthUser()).resolves.toEqual({
      error: "Unauthorized",
      status: 401,
    });
  });

  it.each(helpers)("%s returns 503 for identity-provider failure", async (name, helper) => {
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

    await expectSafeUnavailable(helper, `${name}/auth`);
  });

  it.each(helpers)("%s returns 503 for profile-read failure", async (name, helper) => {
    createClient.mockResolvedValue(
      makeClient({
        profileError: {
          code: "XX000",
          message: "sensitive provider detail",
        },
      })
    );

    await expectSafeUnavailable(helper, `${name}/profile`);
  });

  it.each(helpers)("%s treats a missing profile as inactive", async (_, helper) => {
    createClient.mockResolvedValue(makeClient({ profile: null }));

    await expect(helper()).resolves.toEqual({
      error: "Forbidden: Account is not active",
      status: 403,
    });
  });

  it("preserves role-specific authorization and success shapes", async () => {
    createClient.mockResolvedValue(
      makeClient({
        profile: {
          role: "customer_manager",
          email: "manager@example.com",
          customer_id: "customer-1",
          full_name: "Manager User",
          status: "active",
        },
      })
    );

    await expect(requireAdmin()).resolves.toEqual({
      error: "Forbidden: Admin access required",
      status: 403,
    });
    await expect(requireInternal()).resolves.toEqual({
      error: "Forbidden: Internal access required",
      status: 403,
    });
    await expect(getAuthUser()).resolves.toMatchObject({
      userId: USER_ID,
      role: "customer_manager",
      customerId: "customer-1",
      isManager: true,
      isInternal: false,
    });
  });
});
