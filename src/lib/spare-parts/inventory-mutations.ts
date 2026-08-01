import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InventoryPatchRequest,
  InventoryUpsertRequest,
} from "./inventory-contracts";
import type { PartCategory } from "@/types/spare-parts";

export interface AdminInventoryRecord {
  id: string;
  spare_part_id: string;
  site_id: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number | null;
  location: string | null;
  last_restocked_at: string | null;
  created_at: string;
  updated_at: string;
  spare_part: {
    id: string;
    part_number: string;
    part_name: string;
    category: PartCategory;
  };
  site: {
    id: string;
    site_name: string;
    site_code: string;
  };
}

export class AdminInventoryMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminInventoryMutationError";
  }
}

function isJoinedPart(value: unknown) {
  const part = value as Partial<AdminInventoryRecord["spare_part"]> | null;
  return Boolean(
    part &&
      typeof part === "object" &&
      typeof part.id === "string" &&
      typeof part.part_number === "string" &&
      typeof part.part_name === "string" &&
      typeof part.category === "string"
  );
}

function isJoinedSite(value: unknown) {
  const site = value as Partial<AdminInventoryRecord["site"]> | null;
  return Boolean(
    site &&
      typeof site === "object" &&
      typeof site.id === "string" &&
      typeof site.site_name === "string" &&
      typeof site.site_code === "string"
  );
}

function parseInventoryRecord(
  data: unknown,
  failureMessage: string
): AdminInventoryRecord {
  const record = data as Partial<AdminInventoryRecord> | null;
  if (
    !record ||
    typeof data !== "object" ||
    typeof record.id !== "string" ||
    typeof record.spare_part_id !== "string" ||
    typeof record.site_id !== "string" ||
    typeof record.quantity !== "number" ||
    !Number.isInteger(record.quantity) ||
    typeof record.min_quantity !== "number" ||
    !Number.isInteger(record.min_quantity) ||
    (record.max_quantity !== null &&
      (typeof record.max_quantity !== "number" ||
        !Number.isInteger(record.max_quantity))) ||
    (record.location !== null && typeof record.location !== "string") ||
    (record.last_restocked_at !== null &&
      typeof record.last_restocked_at !== "string") ||
    typeof record.created_at !== "string" ||
    typeof record.updated_at !== "string" ||
    !isJoinedPart(record.spare_part) ||
    !isJoinedSite(record.site)
  ) {
    throw new AdminInventoryMutationError(failureMessage);
  }

  return record as AdminInventoryRecord;
}

export async function upsertAdminInventoryAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  input: InventoryUpsertRequest;
}): Promise<AdminInventoryRecord> {
  const { data, error } = await args.supabase.rpc(
    "upsert_admin_spare_part_inventory_atomic",
    {
      p_actor_id: args.actorId,
      p_input: args.input,
    }
  );

  if (error) {
    throw new AdminInventoryMutationError(
      "Atomic inventory upsert failed",
      error.code
    );
  }

  return parseInventoryRecord(
    data,
    "Atomic inventory upsert returned an invalid result"
  );
}

export async function applyAdminInventoryPatch(args: {
  supabase: SupabaseClient;
  actorId: string;
  inventoryId: string;
  patch: InventoryPatchRequest;
}): Promise<AdminInventoryRecord> {
  const { data, error } = await args.supabase.rpc(
    "apply_admin_spare_part_inventory_patch",
    {
      p_actor_id: args.actorId,
      p_inventory_id: args.inventoryId,
      p_patch: args.patch,
    }
  );

  if (error) {
    throw new AdminInventoryMutationError(
      "Atomic inventory update failed",
      error.code
    );
  }

  return parseInventoryRecord(
    data,
    "Atomic inventory update returned an invalid result"
  );
}
