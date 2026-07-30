import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FieldServiceEngineerInput,
  FieldServiceOrderCreateInput,
  FieldServiceOrderPatch,
} from "./contracts";

export class FieldServiceOrderMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "FieldServiceOrderMutationError";
  }
}

/**
 * Create an order, its complete engineer assignment set, and its audit entry
 * in one database transaction owned by migration 030.
 */
export async function createFieldServiceOrderAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  input: FieldServiceOrderCreateInput;
  engineers: FieldServiceEngineerInput[];
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "create_field_service_order_atomic",
    {
      p_actor_id: args.actorId,
      p_input: args.input,
      p_engineers: args.engineers,
    }
  );

  if (error || typeof data !== "string") {
    throw new FieldServiceOrderMutationError(
      "Atomic field service order creation failed",
      error?.code
    );
  }

  return data;
}

/**
 * Apply header changes and, when supplied, replace the complete engineer
 * assignment set inside one row-locked database transaction.
 */
export async function applyFieldServiceOrderPatch(args: {
  supabase: SupabaseClient;
  orderId: string;
  actorId: string;
  patch: FieldServiceOrderPatch;
  engineers?: FieldServiceEngineerInput[];
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "apply_field_service_order_patch",
    {
      p_order_id: args.orderId,
      p_actor_id: args.actorId,
      p_patch: args.patch,
      p_engineers: args.engineers ?? null,
    }
  );

  if (error || typeof data !== "string") {
    throw new FieldServiceOrderMutationError(
      "Atomic field service order update failed",
      error?.code
    );
  }

  return data;
}
