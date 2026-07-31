import type { SupabaseClient } from "@supabase/supabase-js";

type InternalRole = "admin" | "engineer";
type ProvisioningPhase = "auth" | "finalize" | "reconcile";

interface ProvisionedUser {
  id: string;
  email: string;
}

interface ProvisioningBase {
  supabase: SupabaseClient;
  actorId: string;
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
}

export class UserProvisioningError extends Error {
  constructor(
    message: string,
    readonly phase: ProvisioningPhase,
    readonly code?: string,
    readonly reconciliationRequired = false
  ) {
    super(message);
    this.name = "UserProvisioningError";
  }
}

async function createProvisionalUser(
  args: ProvisioningBase
): Promise<ProvisionedUser> {
  const { data, error } = await args.supabase.auth.admin.createUser({
    email: args.email,
    password: args.password,
    email_confirm: true,
    user_metadata: {
      full_name: args.fullName,
      // Migration 039 permits only this safe trigger role. Authorization is
      // assigned by the actor-checked finalization command below.
      role: "customer",
    },
  });

  if (error || !data.user?.id || !data.user.email) {
    throw new UserProvisioningError(
      "Auth identity creation failed",
      "auth",
      error?.code
    );
  }

  return { id: data.user.id, email: data.user.email };
}

async function removeProvisionalUser(
  supabase: SupabaseClient,
  targetUserId: string
): Promise<boolean> {
  const profileResult = await supabase
    .from("users")
    .delete()
    .eq("id", targetUserId);
  const authResult = await supabase.auth.admin.deleteUser(targetUserId);
  return !profileResult.error && !authResult.error;
}

async function reconcileAdminFinalization(args: {
  supabase: SupabaseClient;
  targetUserId: string;
  expectedRole: InternalRole;
}): Promise<"committed" | "provisional" | "unknown"> {
  const { data, error } = await args.supabase
    .from("users")
    .select("role, status, customer_id")
    .eq("id", args.targetUserId)
    .maybeSingle();

  if (error || !data) return "unknown";
  if (
    data.role === args.expectedRole &&
    data.status === "active" &&
    data.customer_id === null
  ) {
    return "committed";
  }
  if (
    data.role === "customer" &&
    ["active", "invited"].includes(data.status) &&
    data.customer_id === null
  ) {
    return "provisional";
  }
  return "unknown";
}

async function reconcileTeamFinalization(args: {
  supabase: SupabaseClient;
  targetUserId: string;
  expectedCustomerId: string;
}): Promise<"committed" | "provisional" | "unknown"> {
  const { data, error } = await args.supabase
    .from("users")
    .select("role, status, customer_id")
    .eq("id", args.targetUserId)
    .maybeSingle();

  if (error || !data) return "unknown";
  if (
    data.role === "customer" &&
    data.status === "active" &&
    data.customer_id === args.expectedCustomerId
  ) {
    return "committed";
  }
  if (
    data.role === "customer" &&
    ["active", "invited"].includes(data.status) &&
    data.customer_id === null
  ) {
    return "provisional";
  }
  return "unknown";
}

export async function provisionAdminUser(
  args: ProvisioningBase & { role: InternalRole }
): Promise<ProvisionedUser> {
  const provisional = await createProvisionalUser(args);

  let result: { data: unknown; error: null | { code?: string } } = {
    data: null,
    error: null,
  };
  try {
    result = await args.supabase.rpc("finalize_admin_user_creation", {
      p_actor_id: args.actorId,
      p_target_user_id: provisional.id,
      p_full_name: args.fullName,
      p_role: args.role,
      p_phone: args.phone ?? null,
    });
  } catch {
    // A transport failure can happen after PostgreSQL commits. Re-read the
    // profile before deciding whether compensation is safe.
  }

  if (!result.error && result.data === provisional.id) return provisional;

  const state = await reconcileAdminFinalization({
    supabase: args.supabase,
    targetUserId: provisional.id,
    expectedRole: args.role,
  });
  if (state === "committed") return provisional;
  if (state === "provisional") {
    const cleaned = await removeProvisionalUser(args.supabase, provisional.id);
    throw new UserProvisioningError(
      "Admin user finalization failed",
      "finalize",
      result.error?.code,
      !cleaned
    );
  }

  throw new UserProvisioningError(
    "Admin user finalization requires reconciliation",
    "reconcile",
    result.error?.code,
    true
  );
}

export async function provisionTeamUser(
  args: ProvisioningBase & {
    customerId: string;
    siteIds: string[];
  }
): Promise<ProvisionedUser> {
  const provisional = await createProvisionalUser(args);

  let result: { data: unknown; error: null | { code?: string } } = {
    data: null,
    error: null,
  };
  try {
    result = await args.supabase.rpc("finalize_team_user_creation", {
      p_actor_id: args.actorId,
      p_target_user_id: provisional.id,
      p_full_name: args.fullName,
      p_phone: args.phone ?? null,
      p_site_ids: args.siteIds,
    });
  } catch {
    // A transport failure can happen after PostgreSQL commits. Re-read the
    // profile before deciding whether compensation is safe.
  }

  if (!result.error && result.data === provisional.id) return provisional;

  const state = await reconcileTeamFinalization({
    supabase: args.supabase,
    targetUserId: provisional.id,
    expectedCustomerId: args.customerId,
  });
  if (state === "committed") return provisional;
  if (state === "provisional") {
    const cleaned = await removeProvisionalUser(args.supabase, provisional.id);
    throw new UserProvisioningError(
      "Team user finalization failed",
      "finalize",
      result.error?.code,
      !cleaned
    );
  }

  throw new UserProvisioningError(
    "Team user finalization requires reconciliation",
    "reconcile",
    result.error?.code,
    true
  );
}
