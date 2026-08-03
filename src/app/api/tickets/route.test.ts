import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  createAdminClientMock,
  localRateLimitMock,
  distributedRateLimitMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  localRateLimitMock: vi.fn(),
  distributedRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({ getAuthUser: authMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.8",
  rateLimit: localRateLimitMock,
}));
vi.mock("@/lib/distributed-rate-limit", () => ({
  buildRateLimitBucketKey: () => "b".repeat(64),
  consumeDistributedRateLimit: distributedRateLimitMock,
  getRetryAfterSeconds: () => 29,
}));
vi.mock("@/lib/supabase/scope", () => ({
  canAccessSite: vi.fn(),
  getUserScope: vi.fn(),
  scopeTickets: vi.fn(),
}));
vi.mock("@/lib/tickets/create", () => ({
  createTicketCore: vi.fn(),
  resolveSiteByCode: vi.fn(),
}));

import { POST } from "./route";

function request(body: unknown = {}) {
  return new NextRequest("http://localhost/api/tickets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.8",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ error: "Unauthorized", status: 401 });
  createAdminClientMock.mockReturnValue({});
  localRateLimitMock.mockReturnValue({
    allowed: true,
    remaining: 9,
    resetAt: Date.now() + 60_000,
  });
  distributedRateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: "2026-08-01T12:01:00.000Z",
  });
});

describe("public ticket submission rate limit", () => {
  it("uses the fast local guard before the durable command", async () => {
    localRateLimitMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 10_000,
    });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(distributedRateLimitMock).not.toHaveBeenCalled();
  });

  it("enforces a shared durable submission limit", async () => {
    distributedRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: "2026-08-01T12:01:00.000Z",
    });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("29");
  });

  it("fails closed when durable enforcement is unavailable", async () => {
    distributedRateLimitMock.mockRejectedValueOnce(new Error("private detail"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Ticket submission is temporarily unavailable",
    });
    consoleError.mockRestore();
  });

  it("does not apply anonymous IP quotas to active authenticated users", async () => {
    authMock.mockResolvedValueOnce({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "customer",
      email: "customer@example.com",
      customerId: "22222222-2222-4222-8222-222222222222",
      fullName: "Customer",
      isInternal: false,
      isManager: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(localRateLimitMock).not.toHaveBeenCalled();
    expect(distributedRateLimitMock).not.toHaveBeenCalled();
  });
});
