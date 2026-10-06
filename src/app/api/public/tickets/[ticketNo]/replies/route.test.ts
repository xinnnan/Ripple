import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createAdminClientMock, consumeLimitMock, findTicketMock, replyMock, dispatchMock } =
  vi.hoisted(() => ({
    createAdminClientMock: vi.fn(),
    consumeLimitMock: vi.fn(),
    findTicketMock: vi.fn(),
    replyMock: vi.fn(),
    dispatchMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/tickets/outbox", () => ({ dispatchTicketOutboxBestEffort: dispatchMock }));
vi.mock("@/lib/tickets/public-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tickets/public-access")>();
  return { ...actual, consumePublicTicketLimit: consumeLimitMock, findPublicTicketId: findTicketMock };
});
vi.mock("@/lib/tickets/customer-replies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tickets/customer-replies")>();
  return { ...actual, recordGuestTicketReply: replyMock };
});

import { POST } from "./route";
import {
  InvalidCustomerReplyReplayError,
  PublicTicketNotFoundError,
  TicketNotReopenableError,
} from "@/lib/tickets/customer-replies";

const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = "b".repeat(64);
const KEY = "guest-attempt-123456";

function post(body: unknown, options: { key?: string | null; raw?: boolean; ticketNo?: string } = {}) {
  const ticketNo = options.ticketNo ?? "RPL-000046";
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" };
  if (options.key !== null) headers["Idempotency-Key"] = options.key ?? KEY;
  return POST(
    new NextRequest(`https://support.example.com/api/public/tickets/${ticketNo}/replies`, {
      method: "POST",
      headers,
      body: options.raw ? String(body) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ ticketNo }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({});
  consumeLimitMock.mockResolvedValue({ allowed: true });
  findTicketMock.mockResolvedValue({ id: TICKET_ID });
  replyMock.mockResolvedValue(COMMENT_ID);
  dispatchMock.mockResolvedValue(undefined);
});

describe("guest ticket reply", () => {
  it("records a trimmed reply, drains the outbox, and echoes the request key", async () => {
    const response = await post({ token: TOKEN, body: "  Here is the log  " });

    expect(response.status).toBe(201);
    expect(response.headers.get("idempotency-key")).toBe(KEY);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ comment: { id: COMMENT_ID } });
    expect(replyMock).toHaveBeenCalledWith({
      supabase: {},
      ticketNo: "RPL-000046",
      secureToken: TOKEN,
      body: "Here is the log",
      reopen: false,
      idempotencyKey: KEY,
    });
    expect(dispatchMock).toHaveBeenCalledWith({ aggregateId: TICKET_ID });
  });

  it("passes the reopen choice through", async () => {
    await post({ token: TOKEN, body: "Still broken", reopen: true });
    expect(replyMock).toHaveBeenCalledWith(expect.objectContaining({ reopen: true }));
  });

  it.each([
    ["malformed JSON", "{", { raw: true }],
    ["missing token", { body: "x" }, {}],
    ["bad token", { token: "nope", body: "x" }, {}],
    ["blank body", { token: TOKEN, body: "   " }, {}],
    ["oversized body", { token: TOKEN, body: "x".repeat(10_001) }, {}],
    ["unknown fields", { token: TOKEN, body: "x", author_id: "a" }, {}],
    ["bad ticket number", { token: TOKEN, body: "x" }, { ticketNo: "RPL-x" }],
    ["missing request key", { token: TOKEN, body: "x" }, { key: null }],
    ["oversized request key", { token: TOKEN, body: "x" }, { key: "k".repeat(181) }],
  ])("rejects %s before any write", async (_, body, options) => {
    const response = await post(body, options as Parameters<typeof post>[1]);
    expect(response.status).toBe(400);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("throttles before resolving the ticket", async () => {
    consumeLimitMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const response = await post({ token: TOKEN, body: "x" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(findTicketMock).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter is unavailable", async () => {
    consumeLimitMock.mockRejectedValue(new Error("down"));
    expect((await post({ token: TOKEN, body: "x" })).status).toBe(503);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a wrong link without writing", async () => {
    findTicketMock.mockResolvedValue(null);
    expect((await post({ token: TOKEN, body: "x" })).status).toBe(404);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it.each([
    [new TicketNotReopenableError(), 409],
    [new InvalidCustomerReplyReplayError(), 409],
    [new PublicTicketNotFoundError(), 404],
    [new Error("boom"), 503],
  ])("maps %s to %i", async (error, status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    replyMock.mockRejectedValue(error);
    expect((await post({ token: TOKEN, body: "x", reopen: true })).status).toBe(status);
  });
});
