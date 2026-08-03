import { NextRequest, NextResponse } from "next/server";
import { SUGGESTION_TYPES } from "@/lib/ai/suggest";
import {
  AiSuggestionRateLimitError,
  requestAiSuggestion,
} from "@/lib/ai/service";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { z } from "zod";

const suggestSchema = z.object({
  ticket_id: z.string().uuid(),
  suggestion_type: z.enum(SUGGESTION_TYPES),
  // user_id is intentionally NOT accepted — the route forces
  // created_by = auth.userId on the ai_suggestions row. A previous
  // version trusted the body field, which let any logged-in user
  // log a suggestion as someone else. (Same pattern as the
  // ticket_events.actor_id fix in ccaaad5.)
});

export async function POST(request: NextRequest) {
  try {
    // Auth required. The AI endpoint hits a paid provider, so
    // anonymous calls should fail fast with 401, not 500.
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    // Internal-only. The AI suggestions panel on the ticket page
    // is only rendered for internal users, and the ai_suggestions
    // list is gated to internal via the page; this endpoint
    // matches that gate so a customer can't burn paid tokens
    // through the API directly. (See ticket detail page comment
    // for the rationale: troubleshooting + customer-reply drafts
    // are engineer-only material.)
    if (!auth.isInternal) {
      return NextResponse.json(
        { error: "Forbidden: AI suggestions are internal-only" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = suggestSchema.parse(body);

    const result = await requestAiSuggestion({
      ticketId: data.ticket_id,
      suggestionType: data.suggestion_type,
      actorId: auth.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiSuggestionRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("AI suggestion error:", error);
    return NextResponse.json(
      { error: "Failed to generate suggestion" },
      { status: 500 }
    );
  }
}
