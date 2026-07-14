// Ripple Assist — AI suggestion generator.
//
// Backed by an OpenAI-compatible endpoint (currently MiniMax).
// Tolerates the AI provider being missing or returning auth errors
// (verified 2026-07-14: the configured MINIMAX_API_KEY returns
// 401 invalid api key, see AGENTS.md §9). In that case we fall
// back to a structured mock so the rest of the system keeps working —
// engineers still get a row in the AI panel, the audit trail still
// records the call, and the UI can mark it as "AI offline".
//
// The provider is pluggable: change MINIMAX_BASE_URL + MINIMAX_MODEL
// in .env to switch (e.g. to OpenAI, Zhipu, or your own gateway).

import OpenAI from "openai";
import {
  SYSTEM_PROMPT,
  TICKET_SUMMARY_PROMPT,
  CUSTOMER_REPLY_PROMPT,
  CLOSURE_SUMMARY_PROMPT,
  buildTicketContext,
} from "./prompt";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Client construction (lazy, provider-pluggable)
// ---------------------------------------------------------------------------

let aiClient: OpenAI | null = null;
let aiClientInitTried = false;

function getAiClient(): OpenAI | null {
  if (aiClient) return aiClient;
  if (aiClientInitTried) return null;
  aiClientInitTried = true;
  const key = process.env.MINIMAX_API_KEY;
  if (!key) return null;
  aiClient = new OpenAI({
    apiKey: key,
    baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimax.chat/v1/",
  });
  return aiClient;
}

function getModel(): string {
  return process.env.MINIMAX_MODEL || "M2.7-highspeed";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuggestionType =
  | "summary"
  | "troubleshooting"
  | "similar_tickets"
  | "customer_reply_draft"
  | "escalation_summary"
  | "closure_summary"
  | "log_analysis";

export interface SuggestionResult {
  id: string | null;
  output_text: string;
  confidence_level: "high" | "medium" | "low";
  suggestion_type: SuggestionType;
  model_name: string;
  /** True when this suggestion is a mock fallback, not a real AI call. */
  _mock?: boolean;
  /** Reason for the mock fallback (no_key, auth_error, etc.). */
  _mock_reason?: "no_api_key" | "auth_error" | "provider_error";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateSuggestion(
  ticketId: string,
  suggestionType: SuggestionType,
  userId: string
): Promise<SuggestionResult> {
  const supabase = createAdminClient();

  // Fetch ticket with context
  const { data: ticket } = await supabase
    .from("tickets")
    .select(
      `
      *,
      customer:customers(name),
      site:sites(site_name),
      ticket_comments(id, body, visibility, created_at)
    `
    )
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found`);
  }

  // Choose the user prompt based on suggestion type.
  let userPrompt: string;
  switch (suggestionType) {
    case "summary":
    case "troubleshooting":
      userPrompt = TICKET_SUMMARY_PROMPT;
      break;
    case "customer_reply_draft":
      userPrompt = CUSTOMER_REPLY_PROMPT;
      break;
    case "closure_summary":
      userPrompt = CLOSURE_SUMMARY_PROMPT;
      break;
    default:
      userPrompt = TICKET_SUMMARY_PROMPT;
  }

  const context = buildTicketContext({
    ticket_no: ticket.ticket_no,
    title: ticket.title,
    description: ticket.description,
    severity: ticket.severity,
    status: ticket.status,
    request_type: ticket.request_type,
    asset_id: ticket.asset_id,
    area: ticket.area,
    impact: ticket.impact,
    customer_name: ticket.customer?.name,
    site_name: ticket.site?.site_name,
    comments: ticket.ticket_comments,
  });

  // ---------------------------------------------------------------------
  // 1. Try the real provider.
  // ---------------------------------------------------------------------
  const client = getAiClient();
  const model = getModel();
  let outputText = "";
  let confidence: "high" | "medium" | "low" = "low";
  let mockReason: "no_api_key" | "auth_error" | "provider_error" | null = null;

  if (!client) {
    mockReason = "no_api_key";
  } else {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `${userPrompt}\n\n${context}` },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });
      outputText = completion.choices[0]?.message?.content || "";
      confidence = detectConfidence(outputText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 401 / 403 / "invalid api key" → auth_error
      if (/401|unauthor|invalid api key|forbidden|403/i.test(msg)) {
        mockReason = "auth_error";
        console.warn(
          `[ai] provider returned auth error — falling back to mock. ` +
            `Check MINIMAX_API_KEY / MINIMAX_BASE_URL. (${msg})`
        );
      } else {
        mockReason = "provider_error";
        console.error(`[ai] provider error — falling back to mock:`, msg);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 2. Build a structured mock if we couldn't get a real answer.
  // ---------------------------------------------------------------------
  if (mockReason) {
    outputText = buildMockResponse(suggestionType, ticket, mockReason);
    confidence = "low";
  }

  // ---------------------------------------------------------------------
  // 3. Save the suggestion (real or mock) to ai_suggestions for audit.
  //    Mock rows are tagged with model_name prefixed "mock:" so the
  //    audit page can filter them.
  // ---------------------------------------------------------------------
  const suggestionRow = {
    ticket_id: ticketId,
    suggestion_type: suggestionType,
    model_name: mockReason ? `mock:${mockReason}` : model,
    prompt_version: "v1",
    output_text: outputText,
    confidence_level: confidence,
    created_by: userId,
  };

  const { data: suggestion, error } = await supabase
    .from("ai_suggestions")
    .insert(suggestionRow)
    .select()
    .single();

  if (error) {
    console.error("[ai] failed to save suggestion:", error);
  }

  return {
    id: suggestion?.id ?? null,
    output_text: outputText,
    confidence_level: confidence,
    suggestion_type: suggestionType,
    model_name: suggestionRow.model_name,
    ...(mockReason ? { _mock: true, _mock_reason: mockReason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Mock response — clearly labelled so engineers don't mistake it for real AI
// ---------------------------------------------------------------------------

function buildMockResponse(
  type: SuggestionType,
  ticket: {
    ticket_no: string;
    title: string;
    description: string;
    severity: string;
    request_type: string;
  },
  reason: "no_api_key" | "auth_error" | "provider_error"
): string {
  const reasonNote =
    reason === "no_api_key"
      ? "AI provider key is not configured (MINIMAX_API_KEY is blank)."
      : reason === "auth_error"
      ? "AI provider rejected the API key (401/403). Check MINIMAX_API_KEY / MINIMAX_BASE_URL."
      : "AI provider is unreachable or returned an error. The system stayed online so you can keep working.";

  const sections: Record<SuggestionType, string> = {
    summary: `**1. Issue Summary**\n${ticket.title}\n\n**2. Suggested Severity**\n${ticket.severity} (per the requester's input — please verify)\n\n**3. Likely Issue Categories**\n- (unavailable — AI assist offline)\n\n**4. Missing Information**\n- (unavailable — AI assist offline)\n\n**5. Recommended Next Steps**\n- Review the ticket description and any customer comments\n- Check the linked site / asset / asset logs\n- Reach out to the customer if the description is unclear\n\n**6. Similar Historical Tickets**\n- (unavailable — AI assist offline)\n\n**7. Customer Reply Draft**\n- (unavailable — AI assist offline)\n\n**8. Escalation Trigger**\n- Escalate to your team lead if the customer reports any safety concern or production stop.\n\n**9. Confidence**\nLow — mock response, no AI call was made.`,
    troubleshooting: `**Troubleshooting guidance unavailable — AI assist is offline.**\n\nPlease use the standard DropletAI runbook for this asset class. If unsure, ping the on-call engineer.`,
    similar_tickets: `_AI assist offline — cannot search historical tickets._\n\nUse the search bar on /tickets with keywords from the title and description.`,
    customer_reply_draft: `Hi,\n\nThanks for reaching out — we've received your ticket ${ticket.ticket_no} and an engineer will follow up shortly.\n\nBest,\nDropletAI Support`,
    escalation_summary: `_AI assist offline — escalation summary not available._\n\nPlease write a one-paragraph escalation note manually covering: impact, urgency, and what you need from the escalation path.`,
    closure_summary: `_AI assist offline — closure summary not available._\n\nPlease write a 1-2 sentence customer-facing resolution summary manually before resolving.`,
    log_analysis: `_AI assist offline — log analysis not available._\n\nPlease attach the relevant logs to the ticket and tag the on-call engineer.`,
  };

  return `⚠️ **Ripple Assist is offline (${reason})**\n${reasonNote}\n\n---\n\n${sections[type] ?? sections.summary}`;
}

// ---------------------------------------------------------------------------
// Confidence detection
// ---------------------------------------------------------------------------

function detectConfidence(text: string): "high" | "medium" | "low" {
  const lower = text.toLowerCase();
  if (lower.includes("confidence: high") || lower.includes("high confidence"))
    return "high";
  if (lower.includes("confidence: low") || lower.includes("low confidence"))
    return "low";
  return "medium";
}
