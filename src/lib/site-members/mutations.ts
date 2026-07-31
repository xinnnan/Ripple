import type { SupabaseClient } from "@supabase/supabase-js";

export class AdminSiteMembershipMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminSiteMembershipMutationError";
  }
}

export async function addAdminSiteMembership(args: {
  supabase: SupabaseClient;
  actorId: string;
  userId: string;
  siteId: string;
  role: "owner" | "manager" | "member" | "viewer";
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "add_admin_site_membership_atomic",
    {
      p_actor_id: args.actorId,
      p_user_id: args.userId,
      p_site_id: args.siteId,
      p_role: args.role,
    }
  );

  if (error || typeof data !== "string") {
    throw new AdminSiteMembershipMutationError(
      "Atomic site membership add failed",
      error?.code
    );
  }

  return data;
}

export async function removeAdminSiteMembership(args: {
  supabase: SupabaseClient;
  actorId: string;
  membershipId: string;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "remove_admin_site_membership_atomic",
    {
      p_actor_id: args.actorId,
      p_membership_id: args.membershipId,
    }
  );

  if (error || typeof data !== "string") {
    throw new AdminSiteMembershipMutationError(
      "Atomic site membership removal failed",
      error?.code
    );
  }

  return data;
}
