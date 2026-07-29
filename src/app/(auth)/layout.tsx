import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/ticket";
import { isAdminRole, isCustomerManager, isInternalUser } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const { data: userProfile } = await supabase
    .from("users")
    .select("role, email, status")
    .eq("id", authUser.id)
    .single();

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
