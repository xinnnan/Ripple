import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const {
  distributedRateLimitMock,
  fromMock,
} = vi.hoisted(() => ({
  distributedRateLimitMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.46" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "198.51.100.46",
  rateLimit: () => ({
    allowed: true,
    remaining: 29,
    resetAt: Date.now() + 60_000,
  }),
}));
vi.mock("@/lib/distributed-rate-limit", () => ({
  buildRateLimitBucketKey: () => "d".repeat(64),
  consumeDistributedRateLimit: distributedRateLimitMock,
  getRetryAfterSeconds: () => 37,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

import TicketViewPage from "./page";

async function renderPage(token = "a".repeat(64)) {
  const view = await TicketViewPage({
    params: Promise.resolve({ ticketId: "RPL-000046" }),
    searchParams: Promise.resolve({ token }),
  });
  return renderToStaticMarkup(view);
}

beforeEach(() => {
  vi.clearAllMocks();
  distributedRateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 29,
    resetAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

describe("public ticket view boundary", () => {
  it("does not call the distributed command or database without a token", async () => {
    const html = await renderPage("");

    expect(html).toContain("Access Denied");
    expect(distributedRateLimitMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("renders a retry state before ticket lookup when the distributed limit is exhausted", async () => {
    distributedRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 37_000).toISOString(),
    });

    const html = await renderPage();

    expect(html).toContain("Too Many Requests");
    expect(html).toContain("37 seconds");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fails closed with a generic unavailable state when the limiter fails", async () => {
    distributedRateLimitMock.mockRejectedValueOnce(new Error("private detail"));

    const html = await renderPage();

    expect(html).toContain("Ticket Lookup Unavailable");
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toContain("private detail");
    expect(fromMock).not.toHaveBeenCalled();
  });
});
