import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerLifecycleStatus = "active" | "trial";

export interface AdminCustomerRecord {
  id: string;
  name: string;
  domain: string | null;
  status: "active" | "inactive" | "trial";
  created_at: string;
}

export interface AdminCustomerCreateInput {
  name: string;
  domain?: string | null;
  status: CustomerLifecycleStatus;
}

export interface AdminCustomerPatch {
  name?: string;
  domain?: string | null;
  status?: CustomerLifecycleStatus;
}

export class AdminCustomerMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminCustomerMutationError";
  }
}

function parseCustomerRecord(
  data: unknown,
  failureMessage: string,
  code?: string
): AdminCustomerRecord {
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { id?: unknown }).id !== "string" ||
    typeof (data as { name?: unknown }).name !== "string" ||
    typeof (data as { status?: unknown }).status !== "string" ||
    typeof (data as { created_at?: unknown }).created_at !== "string"
  ) {
    throw new AdminCustomerMutationError(failureMessage, code);
  }

  return data as AdminCustomerRecord;
}

export async function createAdminCustomerAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  input: AdminCustomerCreateInput;
}): Promise<AdminCustomerRecord> {
  const { data, error } = await args.supabase.rpc(
    "create_admin_customer_atomic",
    {
      p_actor_id: args.actorId,
      p_input: args.input,
    }
  );

  if (error) {
    throw new AdminCustomerMutationError(
      "Atomic admin customer creation failed",
      error.code
    );
  }

  return parseCustomerRecord(
    data,
    "Atomic admin customer creation returned an invalid result"
  );
}

export async function applyAdminCustomerPatch(args: {
  supabase: SupabaseClient;
  actorId: string;
  customerId: string;
  patch: AdminCustomerPatch;
}): Promise<AdminCustomerRecord> {
  const { data, error } = await args.supabase.rpc(
    "apply_admin_customer_patch",
    {
      p_actor_id: args.actorId,
      p_customer_id: args.customerId,
      p_patch: args.patch,
    }
  );

  if (error) {
    throw new AdminCustomerMutationError(
      "Atomic admin customer update failed",
      error.code
    );
  }

  return parseCustomerRecord(
    data,
    "Atomic admin customer update returned an invalid result"
  );
}
