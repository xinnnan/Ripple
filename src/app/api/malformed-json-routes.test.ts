import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getAuthUserMock,
  requireInternalMock,
  applyTicketPatchMock,
  recordTicketCommentMock,
  requestAiSuggestionMock,
  dispatchTicketOutboxMock,
  createAdminClientMock,
  MockInvalidTicketTransitionError,
  MockAiSuggestionRateLimitError,
} = vi.hoisted(() => {
  class InvalidTicketTransitionError extends Error {}
  class AiSuggestionRateLimitError extends Error {
    readonly retryAfterSeconds = 60;
  }

  return {
    getAuthUserMock: vi.fn(),
    requireInternalMock: vi.fn(),
    applyTicketPatchMock: vi.fn(),
    recordTicketCommentMock: vi.fn(),
    requestAiSuggestionMock: vi.fn(),
    dispatchTicketOutboxMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    MockInvalidTicketTransitionError: InvalidTicketTransitionError,
    MockAiSuggestionRateLimitError: AiSuggestionRateLimitError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: getAuthUserMock,
  requireInternal: requireInternalMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/tickets/mutations", () => ({
  applyTicketPatchWithSla: applyTicketPatchMock,
  recordTicketCommentWithSla: recordTicketCommentMock,
  InvalidTicketTransitionError: MockInvalidTicketTransitionError,
}));
vi.mock("@/lib/tickets/outbox", () => ({
  dispatchTicketOutboxBestEffort: dispatchTicketOutboxMock,
}));
vi.mock("@/lib/ai/service", () => ({
  AiSuggestionRateLimitError: MockAiSuggestionRateLimitError,
  requestAiSuggestion: requestAiSuggestionMock,
}));

import { POST as suggest } from "./ai/suggest/route";
import { PATCH as patchTicket } from "./tickets/[ticketId]/route";
import { POST as createComment } from "./tickets/[ticketId]/comments/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

function malformedRequest(path: string, method: "PATCH" | "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: "{",
  });
}

function params() {
  return { params: Promise.resolve({ ticketId: TICKET_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUserMock.mockResolvedValue({
    userId: USER_ID,
    role: "engineer",
    email: "engineer@dropletai.services",
    customerId: null,
    fullName: "Engineer",
    isInternal: true,
    isManager: false,
  });
  requireInternalMock.mockResolvedValue({
    userId: USER_ID,
    role: "engineer",
    email: "engineer@dropletai.services",
  });
  createAdminClientMock.mockReturnValue({});
});

describe("malformed JSON mutation boundaries", () => {
  it.each([
    {
      name: "ticket patch",
      call: () =>
        patchTicket(
          malformedRequest(`/api/tickets/${TICKET_ID}`, "PATCH"),
          params()
        ),
    },
    {
      name: "ticket comment",
      call: () =>
        createComment(
          malformedRequest(`/api/tickets/${TICKET_ID}/comments`, "POST"),
          params()
        ),
    },
    {
      name: "AI suggestion",
      call: () => suggest(malformedRequest("/api/ai/suggest", "POST")),
    },
  ])("returns a stable 400 for $name", async ({ call }) => {
    const response = await call();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(applyTicketPatchMock).not.toHaveBeenCalled();
    expect(recordTicketCommentMock).not.toHaveBeenCalled();
    expect(requestAiSuggestionMock).not.toHaveBeenCalled();
  });

  it("authorizes ticket patches before parsing the body", async () => {
    requireInternalMock.mockResolvedValueOnce({
      error: "Unauthorized",
      status: 401,
    });

    const response = await patchTicket(
      malformedRequest(`/api/tickets/${TICKET_ID}`, "PATCH"),
      params()
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it.each([
    {
      name: "ticket comments",
      call: () =>
        createComment(
          malformedRequest(`/api/tickets/${TICKET_ID}/comments`, "POST"),
          params()
        ),
    },
    {
      name: "AI suggestions",
      call: () => suggest(malformedRequest("/api/ai/suggest", "POST")),
    },
  ])("authorizes $name before parsing the body", async ({ call }) => {
    getAuthUserMock.mockResolvedValueOnce({
      error: "Unauthorized",
      status: 401,
    });

    const response = await call();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
