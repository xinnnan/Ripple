import { NextRequest, NextResponse } from "next/server";
import { generateSuggestion, type SuggestionType } from "@/lib/ai/suggest";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
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
  user_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    // Auth required. The AI endpoint hits a paid provider, so
    // anonymous calls should fail fast with 401, not 500.
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const body = await request.json();
    const data = suggestSchema.parse(body);

    const result = await generateSuggestion(
      data.ticket_id,
      data.suggestion_type as SuggestionType,
      data.user_id
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
