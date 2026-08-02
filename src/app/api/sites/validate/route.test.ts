import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  createAdminClientMock,
  localRateLimitMock,
  distributedRateLimitMock,
  maybeSingleMock,
  selectMock,
  eqMock,
  inMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  localRateLimitMock: vi.fn(),
  distributedRateLimitMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  inMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.8",
  rateLimit: localRateLimitMock,
}));
vi.mock("@/lib/distributed-rate-limit", () => ({
  buildRateLimitBucketKey: () => "a".repeat(64),
  consumeDistributedRateLimit: distributedRateLimitMock,
  getRetryAfterSeconds: () => 37,
}));

import { GET } from "./route";

function request(siteCode: string) {
  return new NextRequest(
    `http://localhost/api/sites/validate?site_code=${encodeURIComponent(siteCode)}`,
    { headers: { "x-forwarded-for": "203.0.113.8" } }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: selectMock,
    eq: eqMock,
    in: inMock,
    maybeSingle: maybeSingleMock,
  };
  selectMock.mockReturnValue(query);
  eqMock.mockReturnValue(query);
  inMock.mockReturnValue(query);
  createAdminClientMock.mockReturnValue({ from: vi.fn(() => query) });
  localRateLimitMock.mockReturnValue({
    allowed: true,
    remaining: 19,
    resetAt: Date.now() + 60_000,
  });
  distributedRateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 19,
    resetAt: "2026-08-01T12:01:00.000Z",
  });
  maybeSingleMock.mockResolvedValue({
    data: {
      site_name: "Indianapolis DC",
      site_code: "ADI-INDY-001",
      customer: { status: "active" },
    },
    error: null,
  });
});

describe("public site-code validation", () => {
  it("rejects malformed input after the local guard but before database access", async () => {
    const response = await GET(request("invalid site"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(localRateLimitMock).toHaveBeenCalledWith({
      key: "site-validate:203.0.113.8",
      limit: 20,
      windowMs: 60_000,
    });
    expect(distributedRateLimitMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("uses the fast local limit before the durable command", async () => {
    localRateLimitMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 12_000,
    });

    const response = await GET(request("ADI-INDY-001"));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(distributedRateLimitMock).not.toHaveBeenCalled();
  });

  it("enforces the durable limit across application instances", async () => {
    distributedRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: "2026-08-01T12:01:00.000Z",
    });

    const response = await GET(request("ADI-INDY-001"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(maybeSingleMock).not.toHaveBeenCalled();
  });

  it("fails closed when the durable limiter is unavailable", async () => {
    distributedRateLimitMock.mockRejectedValueOnce(new Error("private detail"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request("ADI-INDY-001"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Site validation is temporarily unavailable",
    });
    consoleError.mockRestore();
  });

  it("requires an active site under an active or trial customer", async () => {
    await GET(request("adi-indy-001"));

    expect(eqMock).toHaveBeenCalledWith("site_code", "ADI-INDY-001");
    expect(eqMock).toHaveBeenCalledWith("status", "active");
    expect(inMock).toHaveBeenCalledWith("customer.status", [
      "active",
      "trial",
    ]);
  });

  it("returns only the public display fields for a valid site", async () => {
    const response = await GET(request("ADI-INDY-001"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      valid: true,
      site: {
        site_name: "Indianapolis DC",
        site_code: "ADI-INDY-001",
      },
    });
    expect(body).not.toHaveProperty("customer");
    expect(body.site).not.toHaveProperty("customer");
    expect(body.site).not.toHaveProperty("id");
  });

  it("uses the same minimal response for an unknown lifecycle-scoped code", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await GET(request("UNKNOWN-001"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false });
  });

  it("does not expose database errors to public callers", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request("ADI-INDY-001"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "Site validation is temporarily unavailable",
    });
    expect(JSON.stringify(body)).not.toContain("private");
    consoleError.mockRestore();
  });
});
