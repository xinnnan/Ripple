import OpenAI from "openai";
import {
  SYSTEM_PROMPT,
  TICKET_SUMMARY_PROMPT,
  CUSTOMER_REPLY_PROMPT,
  CLOSURE_SUMMARY_PROMPT,
  buildTicketContext,
} from "./prompt";
import { createAdminClient } from "@/lib/supabase/admin";

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export type SuggestionType =
  | "summary"
  | "troubleshooting"
  | "similar_tickets"
  | "customer_reply_draft"
  | "escalation_summary"
  | "closure_summary"
  | "log_analysis";

export async function generateSuggestion(
  ticketId: string,
  suggestionType: SuggestionType,
  userId: string
) {
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

  // Select prompt based on suggestion type
  let userPrompt: string;
  switch (suggestionType) {
    case "summary":
    case "troubleshooting":
      userPrompt = `${TICKET_SUMMARY_PROMPT}\n\n${context}`;
      break;
    case "customer_reply_draft":
      userPrompt = `${CUSTOMER_REPLY_PROMPT}\n\n${context}`;
      break;
    case "closure_summary":
      userPrompt = `${CLOSURE_SUMMARY_PROMPT}\n\n${context}`;
      break;
    default:
      userPrompt = `${TICKET_SUMMARY_PROMPT}\n\n${context}`;
  }

  // Call OpenAI
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  });

  const outputText = completion.choices[0]?.message?.content || "";
  const confidence = detectConfidence(outputText);

  // Save suggestion to database
  const { data: suggestion, error } = await supabase
    .from("ai_suggestions")
    .insert({
      ticket_id: ticketId,
      suggestion_type: suggestionType,
      model_name: "gpt-4o",
      output_text: outputText,
      confidence_level: confidence,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to save AI suggestion:", error);
  }

  return {
    id: suggestion?.id,
    output_text: outputText,
    confidence_level: confidence,
    suggestion_type: suggestionType,
  };
}

function detectConfidence(text: string): "high" | "medium" | "low" {
  const lower = text.toLowerCase();
  if (lower.includes("confidence: high") || lower.includes("high confidence"))
    return "high";
  if (lower.includes("confidence: low") || lower.includes("low confidence"))
    return "low";
  return "medium";
}
