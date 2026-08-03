import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  createAdminClientMock,
  localRateLimitMock,
  distributedRateLimitMock,
  createTicketCoreMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  localRateLimitMock: vi.fn(),
  distributedRateLimitMock: vi.fn(),
  createTicketCoreMock: vi.fn(),
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
  createTicketCore: createTicketCoreMock,
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

function validRequest(idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.8",
  };
  if (idempotencyKey !== undefined) {
    headers["idempotency-key"] = idempotencyKey;
  }
  return new NextRequest("http://localhost/api/tickets", {
    method: "POST",
    headers,
    body: JSON.stringify({
      site_id: "11111111-1111-4111-8111-111111111111",
      title: "Stopped conveyor",
      description: "The main conveyor stopped during production.",
      request_type: "incident",
      severity: "P1",
      impact: "production_stopped",
      submitter_name: "Site Operator",
      submitter_email: "operator@example.com",
    }),
  });
}

function siteLookupClient() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { customer_id: "22222222-2222-4222-8222-222222222222" },
      error: null,
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return { from: vi.fn(() => query) };
}

function malformedRequest() {
  return new NextRequest("http://localhost/api/tickets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.8",
    },
    body: "{",
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
  createTicketCoreMock.mockResolvedValue({
    ticket_id: "33333333-3333-4333-8333-333333333333",
    ticket_no: "RPL-000123",
    secure_token: "a".repeat(64),
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

  it("consumes both anonymous guards before rejecting malformed JSON", async () => {
    const response = await POST(malformedRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(localRateLimitMock).toHaveBeenCalledOnce();
    expect(distributedRateLimitMock).toHaveBeenCalledOnce();
  });

  it("rejects unknown submission fields after consuming anonymous guards", async () => {
    const response = await POST(
      request({
        site_code: "INDY-01",
        title: "Stopped conveyor",
        description: "The main conveyor stopped during production.",
        request_type: "incident",
        severity: "P1",
        created_by: "11111111-1111-4111-8111-111111111111",
      })
    );

    expect(response.status).toBe(400);
    expect(localRateLimitMock).toHaveBeenCalledOnce();
    expect(distributedRateLimitMock).toHaveBeenCalledOnce();
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

  it("rejects authenticated malformed JSON without consuming anonymous quotas", async () => {
    authMock.mockResolvedValueOnce({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "customer",
      email: "customer@example.com",
      customerId: "22222222-2222-4222-8222-222222222222",
      fullName: "Customer",
      isInternal: false,
      isManager: false,
    });

    const response = await POST(malformedRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(localRateLimitMock).not.toHaveBeenCalled();
    expect(distributedRateLimitMock).not.toHaveBeenCalled();
  });

  it("forwards and echoes a valid caller idempotency key", async () => {
    createAdminClientMock.mockReturnValueOnce(siteLookupClient());
    const key = "12345678-1234-4234-8234-123456789abc";

    const response = await POST(validRequest(key));

    expect(response.status).toBe(201);
    expect(response.headers.get("idempotency-key")).toBe(key);
    expect(createTicketCoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: key })
    );
  });

  it("generates and returns a request key for legacy callers", async () => {
    createAdminClientMock.mockReturnValueOnce(siteLookupClient());

    const response = await POST(validRequest());

    expect(response.status).toBe(201);
    const key = response.headers.get("idempotency-key");
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(createTicketCoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: key })
    );
  });

  it("rejects unsafe caller keys before site or ticket writes", async () => {
    const response = await POST(validRequest("unsafe duplicate key"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid Idempotency-Key header",
    });
    expect(createTicketCoreMock).not.toHaveBeenCalled();
  });
});
