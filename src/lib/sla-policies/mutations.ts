import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SLAPolicyCreateRequest,
  SLAPolicyPatchRequest,
} from "./contracts";

export interface AdminSLAPolicyRecord {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  customer_id: string | null;
  is_default: boolean;
  p1_response_minutes: number;
  p1_resolution_minutes: number;
  p2_response_minutes: number;
  p2_resolution_minutes: number;
  p3_response_minutes: number;
  p3_resolution_minutes: number;
  p4_response_minutes: number;
  p4_resolution_minutes: number;
}

export interface AdminSLAPolicyCreateInput extends SLAPolicyCreateRequest {
  customer_id: string | null;
  is_default: boolean;
}

export class AdminSLAPolicyMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminSLAPolicyMutationError";
  }
}

function parsePolicyRecord(
  data: unknown,
  failureMessage: string
): AdminSLAPolicyRecord {
  const record = data as Partial<AdminSLAPolicyRecord> | null;
  const targetFields: Array<keyof AdminSLAPolicyRecord> = [
    "p1_response_minutes",
    "p1_resolution_minutes",
    "p2_response_minutes",
    "p2_resolution_minutes",
    "p3_response_minutes",
    "p3_resolution_minutes",
    "p4_response_minutes",
    "p4_resolution_minutes",
  ];

  if (
    !record ||
    typeof data !== "object" ||
    typeof record.id !== "string" ||
    typeof record.created_at !== "string" ||
    typeof record.updated_at !== "string" ||
    typeof record.name !== "string" ||
    (record.customer_id !== null && typeof record.customer_id !== "string") ||
    typeof record.is_default !== "boolean" ||
    targetFields.some((field) => typeof record[field] !== "number")
  ) {
    throw new AdminSLAPolicyMutationError(failureMessage);
  }

  return record as AdminSLAPolicyRecord;
}

export async function createAdminSLAPolicyAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  input: AdminSLAPolicyCreateInput;
}): Promise<AdminSLAPolicyRecord> {
  const { data, error } = await args.supabase.rpc(
    "create_admin_sla_policy_atomic",
    {
      p_actor_id: args.actorId,
      p_input: args.input,
    }
  );

  if (error) {
    throw new AdminSLAPolicyMutationError(
      "Atomic SLA policy creation failed",
      error.code
    );
  }

  return parsePolicyRecord(
    data,
    "Atomic SLA policy creation returned an invalid result"
  );
}

export async function applyAdminSLAPolicyPatch(args: {
  supabase: SupabaseClient;
  actorId: string;
  policyId: string;
  patch: SLAPolicyPatchRequest;
}): Promise<AdminSLAPolicyRecord> {
  const { data, error } = await args.supabase.rpc(
    "apply_admin_sla_policy_patch",
    {
      p_actor_id: args.actorId,
      p_policy_id: args.policyId,
      p_patch: args.patch,
    }
  );

  if (error) {
    throw new AdminSLAPolicyMutationError(
      "Atomic SLA policy update failed",
      error.code
    );
  }

  return parsePolicyRecord(
    data,
    "Atomic SLA policy update returned an invalid result"
  );
}

export async function deleteAdminSLAPolicyAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  policyId: string;
}): Promise<AdminSLAPolicyRecord> {
  const { data, error } = await args.supabase.rpc(
    "delete_admin_sla_policy_atomic",
    {
      p_actor_id: args.actorId,
      p_policy_id: args.policyId,
    }
  );

  if (error) {
    throw new AdminSLAPolicyMutationError(
      "Atomic SLA policy deletion failed",
      error.code
    );
  }

  return parsePolicyRecord(
    data,
    "Atomic SLA policy deletion returned an invalid result"
  );
}
