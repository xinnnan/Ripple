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

describe("middleware profile availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function clientWithProfileResult(result: {
    data: unknown;
    error: unknown;
  }) {
    const client = makeClient("admin");
    const query = client.from() as Record<string, ReturnType<typeof vi.fn>>;
    query.maybeSingle.mockResolvedValue(result);
    createServerClient.mockReturnValue(client);
    return client;
  }

  it("fails closed with 503 instead of revoking the session on a read error", async () => {
    const client = clientWithProfileResult({
      data: null,
      error: { code: "57014", message: "canceling statement due to timeout" },
    });

    const response = await middleware(
      new NextRequest("https://support.example.com/tickets")
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("canceling statement");
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("still renders sign-in pages when the profile read is unavailable", async () => {
    const client = clientWithProfileResult({
      data: null,
      error: { code: "08006" },
    });

    const response = await middleware(
      new NextRequest("https://support.example.com/login")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("revokes the session when the profile is genuinely missing", async () => {
    const client = clientWithProfileResult({ data: null, error: null });

    const response = await middleware(
      new NextRequest("https://support.example.com/tickets")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://support.example.com/login?account=inactive"
    );
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("preserves the requested query string in the sign-in continuation", async () => {
    const client = makeClient("admin");
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    createServerClient.mockReturnValue(client);

    const response = await middleware(
      new NextRequest("https://support.example.com/tickets?status=new&page=2")
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/tickets?status=new&page=2");
  });
});
