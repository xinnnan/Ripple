import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SparePartCreateRequest,
  SparePartPatchRequest,
} from "./admin-contracts";
import type { PartCategory, PartUnit } from "@/types/spare-parts";

export interface AdminSparePartRecord {
  id: string;
  part_number: string;
  part_name: string;
  description: string | null;
  category: PartCategory;
  unit: PartUnit;
  unit_price: number | null;
  compatible_models: string[] | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class AdminSparePartMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminSparePartMutationError";
  }
}

function parseSparePartRecord(
  data: unknown,
  failureMessage: string
): AdminSparePartRecord {
  const record = data as Partial<AdminSparePartRecord> | null;
  if (
    !record ||
    typeof data !== "object" ||
    typeof record.id !== "string" ||
    typeof record.part_number !== "string" ||
    typeof record.part_name !== "string" ||
    (record.description !== null && typeof record.description !== "string") ||
    typeof record.category !== "string" ||
    typeof record.unit !== "string" ||
    (record.unit_price !== null && typeof record.unit_price !== "number") ||
    (record.compatible_models !== null &&
      (!Array.isArray(record.compatible_models) ||
        record.compatible_models.some((model) => typeof model !== "string"))) ||
    (record.image_url !== null && typeof record.image_url !== "string") ||
    typeof record.is_active !== "boolean" ||
    typeof record.created_at !== "string" ||
    typeof record.updated_at !== "string"
  ) {
    throw new AdminSparePartMutationError(failureMessage);
  }

  return record as AdminSparePartRecord;
}

export async function createAdminSparePartAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  input: SparePartCreateRequest;
}): Promise<AdminSparePartRecord> {
  const { data, error } = await args.supabase.rpc(
    "create_admin_spare_part_atomic",
    {
      p_actor_id: args.actorId,
      p_input: args.input,
    }
  );

  if (error) {
    throw new AdminSparePartMutationError(
      "Atomic spare-part creation failed",
      error.code
    );
  }

  return parseSparePartRecord(
    data,
    "Atomic spare-part creation returned an invalid result"
  );
}

export async function applyAdminSparePartPatch(args: {
  supabase: SupabaseClient;
  actorId: string;
  sparePartId: string;
  patch: SparePartPatchRequest;
}): Promise<AdminSparePartRecord> {
  const { data, error } = await args.supabase.rpc(
    "apply_admin_spare_part_patch",
    {
      p_actor_id: args.actorId,
      p_spare_part_id: args.sparePartId,
      p_patch: args.patch,
    }
  );

  if (error) {
    throw new AdminSparePartMutationError(
      "Atomic spare-part update failed",
      error.code
    );
  }

  return parseSparePartRecord(
    data,
    "Atomic spare-part update returned an invalid result"
  );
}
