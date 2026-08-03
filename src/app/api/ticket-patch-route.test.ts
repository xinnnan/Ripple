import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireInternalMock,
  createAdminClientMock,
  applyPatchMock,
  dispatchOutboxMock,
  MockInvalidTransitionError,
} = vi.hoisted(() => {
  class InvalidTransitionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "InvalidTicketTransitionError";
    }
  }
  return {
    requireInternalMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    applyPatchMock: vi.fn(),
    dispatchOutboxMock: vi.fn(),
    MockInvalidTransitionError: InvalidTransitionError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireInternal: requireInternalMock,
  getAuthUser: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: vi.fn(),
  scopeTickets: (query: unknown) => query,
}));
vi.mock("@/lib/tickets/lookup", () => ({
  resolveTicketQuery: (query: unknown) => query,
}));
vi.mock("@/lib/tickets/mutations", () => ({
  applyTicketPatchWithSla: applyPatchMock,
  InvalidTicketTransitionError: MockInvalidTransitionError,
}));
vi.mock("@/lib/tickets/outbox", () => ({
  dispatchTicketOutboxBestEffort: dispatchOutboxMock,
}));

import { PATCH } from "./tickets/[ticketId]/route";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown, raw = false) {
  return new NextRequest(`http://localhost/api/tickets/${TICKET_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function context(ticketId = TICKET_ID) {
  return { params: Promise.resolve({ ticketId }) };
}

function client(args?: {
  lookup?: { data: unknown; error: unknown };
  hydration?: { data: unknown; error: unknown };
}) {
  const lookup = args?.lookup ?? {
    data: { id: TICKET_ID, status: "in_progress", severity: "P2", owner_id: ACTOR_ID },
    error: null,
  };
  const hydration = args?.hydration ?? {
    data: { id: TICKET_ID, status: "resolved" },
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
  requireInternalMock.mockResolvedValue({
    userId: ACTOR_ID,
    role: "engineer",
    email: "engineer@dropletai.services",
  });
  applyPatchMock.mockResolvedValue(TICKET_ID);
  dispatchOutboxMock.mockResolvedValue({ delivered: 1 });
  createAdminClientMock.mockReturnValue(client().client);
});

describe("ticket patch route settlement", () => {
  it("authenticates before parsing or creating a service-role client", async () => {
    requireInternalMock.mockResolvedValueOnce({ error: "Forbidden", status: 403 });

    const response = await PATCH(request("{", true), context());

    expect(response.status).toBe(403);
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(applyPatchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown and oversized patch fields before database access", async () => {
    const unknown = await PATCH(request({ actor_id: ACTOR_ID }), context());
    const oversized = await PATCH(
      request({ customer_visible_summary: "x".repeat(20_001) }),
      context()
    );

    expect(unknown.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("accepts nullable optional summaries and sends normalized data atomically", async () => {
    const response = await PATCH(
      request({
        status: "resolved",
        customer_visible_summary: "  Operations restored  ",
        internal_summary: null,
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(applyPatchMock).toHaveBeenCalledWith({
      supabase: expect.anything(),
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      patch: {
        status: "resolved",
        customer_visible_summary: "Operations restored",
        internal_summary: null,
      },
      source: "web",
    });
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

    const response = await PATCH(request({ severity: "P1" }), context());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load ticket");
    expect(JSON.stringify(body)).not.toContain("sensitive lookup detail");
    expect(applyPatchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "PATCH /api/tickets/[ticketId] lookup failed:",
      { code: "XX000" }
    );
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

    const response = await PATCH(request({ severity: "P1" }), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ticket: { id: TICKET_ID },
      warning: "Ticket updated; detail refresh is temporarily unavailable",
    });
    expect(dispatchOutboxMock).toHaveBeenCalledWith({ aggregateId: TICKET_ID });
    expect(JSON.stringify(body)).not.toContain("sensitive hydration detail");
    expect(consoleError).toHaveBeenCalledWith(
      "PATCH /api/tickets/[ticketId] hydration failed:",
      { code: "PGRST116" }
    );
    consoleError.mockRestore();
  });
});
