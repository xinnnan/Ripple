import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { isAdminRole } from "@/lib/roles";
import { ForbiddenScreen } from "@/components/forbidden-screen";

/**
 * Admin section gate. Only `admin` role can enter. Engineers and customer-side
 * users see a clear "forbidden" screen rather than a half-rendered page.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthUser();
  if ("error" in auth) redirect("/login");
  if (!isAdminRole(auth.role)) return <ForbiddenScreen />;
  return <>{children}</>;
}
