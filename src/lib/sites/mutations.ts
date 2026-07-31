import type { SupabaseClient } from "@supabase/supabase-js";

export type SiteLifecycleStatus = "active" | "commissioning";
export type SiteProjectStatus =
  | "pre_signoff"
  | "in_warranty"
  | "full_coverage"
  | "essential_coverage"
  | "out_of_service";

export interface AdminSiteCreateInput {
  customer_id: string;
  site_name: string;
  site_code: string;
  timezone: string;
  address?: string | null;
  slack_channel_id?: string | null;
  default_owner_id?: string | null;
  status: SiteLifecycleStatus;
  project_status: SiteProjectStatus;
}

export interface AdminSitePatch {
  site_name?: string;
  site_code?: string;
  timezone?: string;
  address?: string | null;
  slack_channel_id?: string | null;
  status?: SiteLifecycleStatus;
  project_status?: SiteProjectStatus;
}

export class AdminSiteMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminSiteMutationError";
  }
}

export async function createAdminSiteAtomic(args: {
  supabase: SupabaseClient;
  actorId: string;
  input: AdminSiteCreateInput;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "create_admin_site_atomic",
    {
      p_actor_id: args.actorId,
      p_input: args.input,
    }
  );

  if (error || typeof data !== "string") {
    throw new AdminSiteMutationError(
      "Atomic admin site creation failed",
      error?.code
    );
  }

  return data;
}

export async function applyAdminSitePatch(args: {
  supabase: SupabaseClient;
  actorId: string;
  siteId: string;
  patch: AdminSitePatch;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "apply_admin_site_patch",
    {
      p_actor_id: args.actorId,
      p_site_id: args.siteId,
      p_patch: args.patch,
    }
  );

  if (error || typeof data !== "string") {
    throw new AdminSiteMutationError(
      "Atomic admin site update failed",
      error?.code
    );
  }

  return data;
}
