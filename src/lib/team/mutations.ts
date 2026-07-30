import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMemberPatch } from "./contracts";

export class TeamMemberMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "TeamMemberMutationError";
  }
}

/**
 * Apply profile/status changes and, when supplied, the complete desired site
 * set through migration 031's row-locked transaction.
 */
export async function applyTeamMemberPatch(args: {
  supabase: SupabaseClient;
  actorId: string;
  targetUserId: string;
  patch: TeamMemberPatch;
  siteIds?: string[];
}): Promise<string> {
  const { data, error } = await args.supabase.rpc("apply_team_member_patch", {
    p_actor_id: args.actorId,
    p_target_user_id: args.targetUserId,
    p_patch: args.patch,
    p_site_ids: args.siteIds ?? null,
  });

  if (error || typeof data !== "string") {
    throw new TeamMemberMutationError(
      "Atomic team member update failed",
      error?.code
    );
  }

  return data;
}
