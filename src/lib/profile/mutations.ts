import type { SupabaseClient } from "@supabase/supabase-js";

export type SelfServiceProfileReceipt = {
  id: string;
  fullName: string;
  phone: string | null;
  changedFields: Array<"full_name" | "phone">;
};

export class SelfServiceProfileMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "SelfServiceProfileMutationError";
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

export async function updateOwnProfile(args: {
  supabase: SupabaseClient;
  actorId: string;
  fullName: string;
  phone: string | null;
}): Promise<SelfServiceProfileReceipt> {
  const { data, error } = await args.supabase.rpc("update_own_profile", {
    p_actor_id: args.actorId,
    p_full_name: args.fullName,
    p_phone: args.phone,
  });

  const changedFields =
    typeof data === "object" &&
    data !== null &&
    "changed_fields" in data &&
    Array.isArray(data.changed_fields)
      ? data.changed_fields
      : null;
  const validChangedFields =
    changedFields?.every(
      (field: unknown) => field === "full_name" || field === "phone"
    ) ?? false;

  if (
    error ||
    typeof data !== "object" ||
    data === null ||
    !("id" in data) ||
    !isUuid(data.id) ||
    data.id !== args.actorId ||
    !("full_name" in data) ||
    typeof data.full_name !== "string" ||
    !("phone" in data) ||
    (data.phone !== null && typeof data.phone !== "string") ||
    !validChangedFields
  ) {
    throw new SelfServiceProfileMutationError(
      "Atomic self-service profile update failed",
      error?.code
    );
  }

  return {
    id: data.id,
    fullName: data.full_name,
    phone: data.phone,
    changedFields: changedFields as Array<"full_name" | "phone">,
  };
}
