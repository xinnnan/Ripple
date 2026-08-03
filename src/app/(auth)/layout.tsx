import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import { isAdminRole, isCustomerManager, isInternalUser } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";
import {
  isUnauthenticatedAuthError,
  throwIdentityServiceUnavailable,
} from "@/lib/supabase/auth-read";

export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const authResult = await supabase.auth.getUser();
  const {
    data: { user: authUser },
    error: authError,
  } = authResult;

  if (authError && !isUnauthenticatedAuthError(authError)) {
    throwIdentityServiceUnavailable("auth-layout/auth", authError);
  }

  if (!authUser) redirect("/login");

  const profileResult = await supabase
    .from("users")
    .select("role, email, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileResult.error) {
    throwIdentityServiceUnavailable(
      "auth-layout/profile",
      profileResult.error
    );
  }
  const userProfile = profileResult.data;

  if (!userProfile || userProfile.status !== "active") {
    redirect("/login?account=inactive");
  }

  const role = userProfile.role as UserRole;
  const email = userProfile.email as string;

  return (
    <AppShell
      role={role}
      email={email}
      isAdmin={isAdminRole(role)}
      isManager={isCustomerManager(role)}
      isInternal={isInternalUser({ role, email })}
    >
      {children}
    </AppShell>
  );
}
