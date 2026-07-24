import { NextRequest, NextResponse } from "next/server";
import { generateSuggestion, type SuggestionType } from "@/lib/ai/suggest";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { z } from "zod";

const suggestSchema = z.object({
  ticket_id: z.string().uuid(),
  suggestion_type: z.enum([
    "summary",
    "troubleshooting",
    "similar_tickets",
    "customer_reply_draft",
    "escalation_summary",
    "closure_summary",
    "log_analysis",
  ]),
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

    // Rate limit per user. The AI provider charges per call; an
    // internal user hammering this endpoint could burn the
    // monthly budget in minutes. 20 / min is generous for
    // interactive use, tight enough to catch a runaway script.
    const rl = rateLimit({
      key: `ai-suggest:${auth.userId}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a minute before asking again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    const body = await request.json();
    const data = suggestSchema.parse(body);

    const result = await generateSuggestion(
      data.ticket_id,
      data.suggestion_type as SuggestionType,
      auth.userId
    );

    return NextResponse.json(result);
  } catch (error) {
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
