import type { SupabaseClient } from "@supabase/supabase-js";
import type { SPRPriority, SPRStatus } from "@/types/spare-parts";

export interface SparePartRequestPatch {
  status?: SPRStatus;
  notes?: string | null;
  priority?: SPRPriority;
  shipping_carrier?: string | null;
  shipping_tracking?: string | null;
}

export interface SparePartFulfillmentPatch {
  id: string;
  fulfilled_quantity: number;
}

export interface SparePartRequestCreateInput {
  ticket_id?: string | null;
  site_id: string;
  priority: SPRPriority;
  notes?: string | null;
}

export interface SparePartRequestCreateItem {
  spare_part_id: string;
  quantity: number;
  unit_price?: number | null;
  notes?: string | null;
}

/** Workflow outcomes migration 057's guard trigger can report. */
export type SparePartRequestFailureKind =
  | "invalid_transition"
  | "approval_forbidden";

export class SparePartRequestMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly kind?: SparePartRequestFailureKind
  ) {
    super(message);
    this.name = "SparePartRequestMutationError";
  }
}

export class InvalidSparePartRequestReplayError extends SparePartRequestMutationError {
  constructor() {
    super(
      "This spare-part request key was already used for different content.",
      "22023"
    );
    this.name = "InvalidSparePartRequestReplayError";
  }
}

/**
 * Apply request-header and line-item changes through one row-locked database
 * command. Migration 028 owns parent containment, quantity bounds, and audit
 * persistence so a partial update cannot escape the transaction.
 */
export async function applySparePartRequestPatch(args: {
  supabase: SupabaseClient;
  requestId: string;
  actorId: string;
  patch: SparePartRequestPatch;
  items?: SparePartFulfillmentPatch[];
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "apply_spare_part_request_patch",
    {
      p_request_id: args.requestId,
      p_actor_id: args.actorId,
      p_patch: args.patch,
      p_items: args.items ?? null,
    }
  );

  if (error || typeof data !== "string") {
    throw new SparePartRequestMutationError(
      "Atomic spare part request update failed",
      error?.code,
      classifySparePartRequestFailure(error)
    );
  }

  return data;
}

function classifySparePartRequestFailure(
  error: { code?: string; message?: string } | null
): SparePartRequestFailureKind | undefined {
  const message = error?.message ?? "";
  if (
    error?.code === "23514" &&
    message.startsWith("Invalid spare part request status transition")
  ) {
    return "invalid_transition";
  }
  if (
    error?.code === "42501" &&
    message === "Spare part request approval requires an administrator"
  ) {
    return "approval_forbidden";
  }
  return undefined;
}

/**
 * Create a request, all of its items, and its audit entry in one database
 * transaction. Migration 029 owns tenant containment, catalog validation,
 * price calculation, sequence allocation, and active-actor attribution;
 * migration 049 adds caller-key serialization and an exact-replay receipt.
 */
export async function createSparePartRequestAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  input: SparePartRequestCreateInput;
  items: SparePartRequestCreateItem[];
  idempotencyKey: string;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "create_spare_part_request_idempotent_atomic",
    {
      p_actor_id: args.actorId,
      p_input: args.input,
      p_items: args.items,
      p_idempotency_key: args.idempotencyKey,
    }
  );

  if (error || typeof data !== "string") {
    if (
      error?.code === "22023" &&
      error.message?.includes(
        "Spare part request idempotency key was already used"
      )
    ) {
      throw new InvalidSparePartRequestReplayError();
    }
    throw new SparePartRequestMutationError(
      "Atomic spare part request creation failed",
      error?.code
    );
  }

  return data;
}
