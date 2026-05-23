import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";

const ADMIN_ROLES: UserRole[] = ["internal_admin"];

export async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    return { error: "Forbidden: Admin access required", status: 403 } as const;
  }

  return { userId: authUser.id, role } as const;
}
