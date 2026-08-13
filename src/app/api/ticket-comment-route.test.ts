import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getAuthUserMock,
  getUserScopeMock,
  createAdminClientMock,
  recordCommentMock,
  dispatchOutboxMock,
} = vi.hoisted(() => ({
  getAuthUserMock: vi.fn(),
  getUserScopeMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  recordCommentMock: vi.fn(),
  dispatchOutboxMock: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: getAuthUserMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: getUserScopeMock,
  scopeTickets: (query: unknown) => query,
}));
vi.mock("@/lib/tickets/lookup", () => ({
  resolveTicketQuery: (query: unknown) => query,
}));
vi.mock("@/lib/tickets/mutations", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/tickets/mutations")
  >();
  return { ...actual, recordTicketCommentWithSla: recordCommentMock };
});
vi.mock("@/lib/tickets/outbox", () => ({
  dispatchTicketOutboxBestEffort: dispatchOutboxMock,
}));

import { POST } from "./tickets/[ticketId]/comments/route";
import { InvalidTicketCommentReplayError } from "@/lib/tickets/mutations";
import { TICKET_IDEMPOTENCY_KEY_HEADER } from "@/lib/tickets/idempotency";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";

function request(
  body: unknown,
  raw = false,
  idempotencyKey?: string
) {
  return new NextRequest(
    `http://localhost/api/tickets/${TICKET_ID}/comments`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(idempotencyKey
          ? { [TICKET_IDEMPOTENCY_KEY_HEADER]: idempotencyKey }
          : {}),
      },
      body: raw ? String(body) : JSON.stringify(body),
    }
  );
}

function context() {
  return { params: Promise.resolve({ ticketId: TICKET_ID }) };
}

function client(args?: {
  lookup?: { data: unknown; error: unknown };
  hydration?: { data: unknown; error: unknown };
}) {
  const lookup = args?.lookup ?? {
    data: { id: TICKET_ID, site_id: SITE_ID },
    error: null,
  };
  const hydration = args?.hydration ?? {
    data: { id: COMMENT_ID, ticket_id: TICKET_ID, body: "Update" },
    error: null,
  };
  const maybeSingle = vi.fn().mockResolvedValue(lookup);
  const single = vi.fn().mockResolvedValue(hydration);
  let call = 0;
  const from = vi.fn(() => {
    call += 1;
    if (call === 1) {
      const lookupBuilder: Record<string, unknown> = { maybeSingle };
      lookupBuilder.select = vi.fn(() => lookupBuilder);
      return lookupBuilder;
    }
    const hydrationBuilder: Record<string, unknown> = { single };
    hydrationBuilder.select = vi.fn(() => hydrationBuilder);
    hydrationBuilder.eq = vi.fn(() => hydrationBuilder);
    return hydrationBuilder;
  });
  return { client: { from }, from, maybeSingle, single };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUserMock.mockResolvedValue({
    userId: USER_ID,
    role: "engineer",
    isInternal: true,
  });
  getUserScopeMock.mockResolvedValue({
    userId: USER_ID,
    role: "engineer",
    isInternal: true,
    siteIds: [],
  });
  recordCommentMock.mockResolvedValue(COMMENT_ID);
  dispatchOutboxMock.mockResolvedValue({ claimed: 1, delivered: 1 });
  createAdminClientMock.mockReturnValue(client().client);
});

describe("ticket comment route settlement", () => {
  it("rejects blank, unknown, and oversized fields before database access", async () => {
    const blank = await POST(request({ body: "   " }), context());
    const unknown = await POST(
      request({ body: "Update", author_id: USER_ID }),
      context()
    );
    const oversized = await POST(
      request({ body: "x".repeat(10_001) }),
      context()
    );

    expect(blank.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(recordCommentMock).not.toHaveBeenCalled();
  });

  it("trims comments and prevents external callers from elevating visibility", async () => {
    getAuthUserMock.mockResolvedValueOnce({
      userId: USER_ID,
      role: "customer",
      isInternal: false,
    });
    getUserScopeMock.mockResolvedValueOnce({
      userId: USER_ID,
      role: "customer",
      isInternal: false,
      siteIds: [SITE_ID],
    });

    const response = await POST(
      request(
        { body: "  Production update  ", visibility: "internal" },
        false,
        "web:comment:attempt-1234"
      ),
      context()
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(recordCommentMock).toHaveBeenCalledWith({
      supabase: expect.anything(),
      ticketId: TICKET_ID,
      actorId: USER_ID,
      body: "Production update",
      visibility: "customer",
      source: "web",
      isAutomated: false,
      idempotencyKey: "web:comment:attempt-1234",
    });
    expect(dispatchOutboxMock).toHaveBeenCalledWith({
      aggregateId: TICKET_ID,
    });
    expect(response.headers.get(TICKET_IDEMPOTENCY_KEY_HEADER)).toBe(
      "web:comment:attempt-1234"
    );
  });

  it("rejects malformed request keys before database access", async () => {
    const response = await POST(
      request({ body: "Update" }, false, "unsafe key"),
      context()
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid Idempotency-Key header",
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(recordCommentMock).not.toHaveBeenCalled();
  });

  it("returns a stable conflict for altered request-key reuse", async () => {
    recordCommentMock.mockRejectedValueOnce(
      new InvalidTicketCommentReplayError()
    );

    const response = await POST(
      request(
        { body: "Changed update" },
        false,
        "web:comment:attempt-1234"
      ),
      context()
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: "This comment request key was already used for different content.",
    });
    expect(dispatchOutboxMock).not.toHaveBeenCalled();
  });

  it("distinguishes a failed lookup from a missing ticket", async () => {
    const mock = client({
      lookup: {
        data: null,
        error: { code: "XX000", message: "sensitive lookup detail" },
      },
    });
    createAdminClientMock.mockReturnValueOnce(mock.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ body: "Update" }), context());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load ticket");
    expect(JSON.stringify(body)).not.toContain("sensitive lookup detail");
    expect(recordCommentMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("preserves committed success when response hydration fails", async () => {
    const mock = client({
      hydration: {
        data: null,
        error: { code: "PGRST116", message: "sensitive hydration detail" },
      },
    });
    createAdminClientMock.mockReturnValueOnce(mock.client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ body: "Update" }), context());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      comment: { id: COMMENT_ID, ticket_id: TICKET_ID },
      warning: "Comment added; detail refresh is temporarily unavailable",
    });
    expect(JSON.stringify(body)).not.toContain("sensitive hydration detail");
    expect(consoleError).toHaveBeenCalledWith(
      "POST /api/tickets/[ticketId]/comments hydration failed:",
      { code: "PGRST116" }
    );
    consoleError.mockRestore();
  });
});
