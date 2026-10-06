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
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));
vi.mock("./guest-reply-form", () => ({
  GuestReplyForm: (props: Record<string, unknown>) => (
    <div data-testid="guest-reply-form" data-props={JSON.stringify(props)} />
  ),
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

function chain(result: { data: unknown; error: unknown }) {
  const builder = Promise.resolve(result) as Promise<typeof result> &
    Record<string, unknown>;
  for (const method of ["select", "eq", "in", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return builder;
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    ticket_no: "RPL-000046",
    title: "Sorter jam",
    description: "Line 3 stopped",
    status: "waiting_customer",
    severity: "P2",
    impact: null,
    asset_id: null,
    area: null,
    customer_visible_summary: null,
    created_at: "2026-10-05T15:00:00Z",
    resolved_at: null,
    closed_at: null,
    customer: { name: "Acme" },
    site: { site_name: "Indy DC", timezone: "America/Chicago" },
    owner: { full_name: "Dana Engineer" },
    ...overrides,
  };
}

function mockTicket(ticket: Record<string, unknown>) {
  const results: Record<string, { data: unknown; error: unknown }> = {
    tickets: { data: ticket, error: null },
    ticket_comments: {
      data: [
        { id: "c1", body: "Please send logs", created_at: "2026-10-05T16:00:00Z", author: { full_name: "Dana Engineer", role: "engineer" } },
        { id: "c2", body: "Logs attached", created_at: "2026-10-05T17:00:00Z", author: null },
        { id: "c3", body: "Me too", created_at: "2026-10-05T18:00:00Z", author: { full_name: "Casey Customer", role: "customer" } },
      ],
      error: null,
    },
    ticket_attachments: {
      data: [{ id: "a1", file_name: "fault.log", file_type: "text/plain", file_size: 2048, created_at: "2026-10-05T17:00:00Z" }],
      error: null,
    },
    ticket_events: { data: [], error: null },
  };
  fromMock.mockImplementation((table: string) => chain(results[table]));
}

describe("public ticket conversation", () => {
  it("labels authors by relationship, not by array index", async () => {
    mockTicket(ticketRow());
    const html = await renderPage();

    expect(html).toContain("Dana Engineer");
    expect(html).toContain("DropletAI");
    expect(html).toContain("Ticket submitter");
    expect(html).toContain("Casey Customer");
    expect(html).not.toContain(">Support Team<");
  });

  it("shows times in the site timezone", async () => {
    mockTicket(ticketRow());
    expect(await renderPage()).toMatch(/CDT|CST/);
  });

  it("links attachments to the token-gated download route", async () => {
    mockTicket(ticketRow());
    const html = await renderPage();
    expect(html).toContain(
      `href="/api/public/tickets/RPL-000046/attachments/a1?token=${"a".repeat(64)}"`
    );
  });

  it("offers a reply form that knows the ticket is waiting on the customer", async () => {
    mockTicket(ticketRow());
    const html = await renderPage();
    const props = JSON.parse(
      html.match(/data-props="([^"]+)"/)![1].replace(/&quot;/g, '"')
    );
    expect(props).toEqual({
      ticketNo: "RPL-000046",
      token: "a".repeat(64),
      canReopen: false,
      awaitingCustomer: true,
    });
  });

  it("offers reopen on resolved tickets", async () => {
    mockTicket(ticketRow({ status: "resolved", resolved_at: "2026-10-04T12:00:00Z" }));
    const html = await renderPage();
    expect(html).toContain("&quot;canReopen&quot;:true");
  });

  it("points long-closed tickets to a new request instead of a reply form", async () => {
    mockTicket(ticketRow({ status: "closed", closed_at: "2026-01-01T00:00:00Z" }));
    const html = await renderPage();
    expect(html).not.toContain("guest-reply-form");
    expect(html).toContain('href="/submit"');
  });
});
