import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { middleware } from "./middleware";

function makeClient(role: string) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({
    data: { role, status: "active" },
    error: null,
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        error: null,
      }),
      signOut: vi.fn(),
    },
    from: vi.fn(() => query),
  };
}

async function runSettingsRequest(role: string, path = "/settings") {
  createServerClient.mockReturnValue(makeClient(role));
  return middleware(new NextRequest(`https://support.example.com${path}`));
}

describe("settings middleware authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["admin", "engineer"])(
    "allows active internal role %s",
    async (role) => {
      const response = await runSettingsRequest(role);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  );

  it.each(["customer_manager", "customer"])(
    "redirects external role %s away from settings",
    async (role) => {
      const response = await runSettingsRequest(role);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://support.example.com/dashboard?denied=internal"
      );
    }
  );

  it("applies the internal gate to future settings subroutes", async () => {
    const response = await runSettingsRequest(
      "customer",
      "/settings/integrations"
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://support.example.com/dashboard?denied=internal"
    );
  });
});
