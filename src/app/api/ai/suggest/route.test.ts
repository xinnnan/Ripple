import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AiSuggestionRateLimitError,
  AiSuggestionTicketNotFoundError,
  AiSuggestionUnavailableError,
} from "@/lib/ai/errors";

const { getAuthUserMock, requestAiSuggestionMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn(),
  requestAiSuggestionMock: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: getAuthUserMock,
}));
vi.mock("@/lib/ai/service", () => ({
  requestAiSuggestion: requestAiSuggestionMock,
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

function request() {
  return new NextRequest("http://localhost/api/ai/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticket_id: TICKET_ID,
      suggestion_type: "troubleshooting",
    }),
  });
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
  requestAiSuggestionMock.mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    output_text: "Check controller logs.",
    confidence_level: "medium",
    suggestion_type: "troubleshooting",
    model_name: "test-model",
  });
});

describe("AI suggestion HTTP boundary", () => {
  it("returns private successful results and forces actor attribution", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requestAiSuggestionMock).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      suggestionType: "troubleshooting",
      actorId: USER_ID,
    });
  });

  it("rejects external users before paid service execution", async () => {
    getAuthUserMock.mockResolvedValueOnce({
      userId: USER_ID,
      role: "customer",
      email: "customer@example.com",
      customerId: "44444444-4444-4444-8444-444444444444",
      fullName: "Customer",
      isInternal: false,
      isManager: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requestAiSuggestionMock).not.toHaveBeenCalled();
  });

  it("returns a bounded durable-limit response with retry guidance", async () => {
    requestAiSuggestionMock.mockRejectedValueOnce(
      new AiSuggestionRateLimitError(Date.now() + 30_000)
    );

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("distinguishes a missing ticket from service unavailability", async () => {
    requestAiSuggestionMock.mockRejectedValueOnce(
      new AiSuggestionTicketNotFoundError()
    );
    const missing = await POST(request());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Ticket is not available for Ripple Assist.",
    });

    requestAiSuggestionMock.mockRejectedValueOnce(
      new AiSuggestionUnavailableError()
    );
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "Ripple Assist is temporarily unavailable. Please retry.",
    });
  });
});
