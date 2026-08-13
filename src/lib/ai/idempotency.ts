import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
  normalizeIdempotencyKey,
} from "@/lib/idempotency";
import {
  isSuggestionType,
  type SuggestionResult,
  type SuggestionType,
} from "./suggest";

export const AI_SUGGESTION_IDEMPOTENCY_KEY_HEADER = IDEMPOTENCY_KEY_HEADER;

export type AiSuggestionRequestSource = "web" | "slack";

export type AiSuggestionRequestIdentity = {
  source: AiSuggestionRequestSource;
  idempotencyKey: string;
  ticketId: string;
  actorId: string;
  suggestionType: SuggestionType;
};

export type AiSuggestionReservation =
  | { state: "reserved" }
  | { state: "in_progress"; providerAttempted: boolean }
  | { state: "completed"; result: SuggestionResult };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mockFields(modelName: string): Pick<
  SuggestionResult,
  "_mock" | "_mock_reason"
> {
  const reason = modelName.startsWith("mock:")
    ? modelName.slice("mock:".length)
    : null;
  if (
    reason === "no_api_key" ||
    reason === "auth_error" ||
    reason === "provider_error"
  ) {
    return { _mock: true, _mock_reason: reason };
  }
  return {};
}

export function parseAiSuggestionReceipt(value: unknown): SuggestionResult {
  const candidate = record(value);
  const id = candidate?.id;
  const outputText = candidate?.output_text;
  const confidence = candidate?.confidence_level;
  const suggestionType = candidate?.suggestion_type;
  const modelName = candidate?.model_name;

  if (
    typeof id !== "string" ||
    !UUID_PATTERN.test(id) ||
    typeof outputText !== "string" ||
    outputText.length < 1 ||
    outputText.length > 20_000 ||
    (confidence !== "high" &&
      confidence !== "medium" &&
      confidence !== "low") ||
    typeof suggestionType !== "string" ||
    !isSuggestionType(suggestionType) ||
    typeof modelName !== "string" ||
    modelName.length < 1 ||
    modelName.length > 200
  ) {
    throw new Error("Invalid AI suggestion receipt");
  }

  return {
    id,
    output_text: outputText,
    confidence_level: confidence,
    suggestion_type: suggestionType,
    model_name: modelName,
    ...mockFields(modelName),
  };
}

function rpcIdentity(identity: AiSuggestionRequestIdentity) {
  return {
    p_source: identity.source,
    p_idempotency_key: identity.idempotencyKey,
    p_ticket_id: identity.ticketId,
    p_actor_id: identity.actorId,
    p_suggestion_type: identity.suggestionType,
  };
}

export function normalizeAiSuggestionIdempotencyKey(
  value: string | null | undefined
): string | null {
  return normalizeIdempotencyKey(value);
}

export function generateAiSuggestionIdempotencyKey(): string {
  return generateIdempotencyKey();
}

export function buildSlackAiSuggestionIdempotencyKey(viewId: string): string {
  const key = normalizeAiSuggestionIdempotencyKey(`slack:ai-view:${viewId}`);
  if (!key) throw new Error("Invalid Slack view identifier");
  return key;
}

export async function reserveAiSuggestionRequest(args: {
  supabase: SupabaseClient;
  identity: AiSuggestionRequestIdentity;
}): Promise<AiSuggestionReservation> {
  const { data, error } = await args.supabase.rpc(
    "reserve_ai_suggestion_request",
    rpcIdentity(args.identity)
  );
  if (error) throw error;

  const response = record(data);
  const state = response?.state;
  if (state === "reserved") return { state };
  if (state === "in_progress" || state === "provider_attempted") {
    return {
      state: "in_progress",
      providerAttempted: state === "provider_attempted",
    };
  }
  if (state === "completed") {
    return { state, result: parseAiSuggestionReceipt(response) };
  }
  throw new Error("Invalid AI suggestion reservation receipt");
}

export async function cancelAiSuggestionRequest(args: {
  supabase: SupabaseClient;
  identity: AiSuggestionRequestIdentity;
}): Promise<boolean> {
  const { data, error } = await args.supabase.rpc(
    "cancel_ai_suggestion_request",
    rpcIdentity(args.identity)
  );
  if (error) throw error;
  if (typeof data !== "boolean") {
    throw new Error("Invalid AI suggestion cancellation receipt");
  }
  return data;
}

export async function checkpointAiSuggestionProviderAttempt(args: {
  supabase: SupabaseClient;
  identity: AiSuggestionRequestIdentity;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "checkpoint_ai_suggestion_provider_attempt",
    rpcIdentity(args.identity)
  );
  if (error) throw error;
  if (typeof data !== "string" || !Number.isFinite(Date.parse(data))) {
    throw new Error("AI suggestion provider checkpoint was not accepted");
  }
  return data;
}

export async function completeAiSuggestionRequest(args: {
  supabase: SupabaseClient;
  identity: AiSuggestionRequestIdentity;
  result: SuggestionResult;
}): Promise<SuggestionResult> {
  const { data, error } = await args.supabase.rpc(
    "complete_ai_suggestion_request_atomic",
    {
      p_input: {
        source: args.identity.source,
        idempotency_key: args.identity.idempotencyKey,
        ticket_id: args.identity.ticketId,
        actor_id: args.identity.actorId,
        suggestion_type: args.identity.suggestionType,
        model_name: args.result.model_name,
        prompt_version: "v1",
        output_text: args.result.output_text,
        confidence_level: args.result.confidence_level,
      },
    }
  );
  if (error) throw error;
  return parseAiSuggestionReceipt(data);
}
