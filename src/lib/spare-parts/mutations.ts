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

export class SparePartRequestMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "SparePartRequestMutationError";
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
      error?.code
    );
  }

  return data;
}
