import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/types/ticket";

export interface AdminUserPatch {
  full_name?: string;
  role?: UserRole;
  status?: "active" | "invited" | "suspended";
}

export class AdminUserMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminUserMutationError";
  }
}

export async function applyAdminUserPatch(args: {
  supabase: SupabaseClient;
  actorId: string;
  targetUserId: string;
  patch: AdminUserPatch;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "apply_admin_user_patch",
    {
      p_actor_id: args.actorId,
      p_target_user_id: args.targetUserId,
      p_patch: args.patch,
    }
  );

  if (error || typeof data !== "string") {
    throw new AdminUserMutationError(
      "Atomic admin user update failed",
      error?.code
    );
  }

  return data;
}
