import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { ForbiddenScreen } from "@/components/forbidden-screen";

/**
 * Field service and part requests are day-to-day work for every DropletAI
 * engineer, so they sit outside the admin-only section. Customer roles see a
 * forbidden screen; the APIs enforce the same internal-only rule.
 */
export default async function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthUser();
  if ("error" in auth) redirect("/login");
  if (!auth.isInternal) {
    return (
      <ForbiddenScreen description="Field service and part requests are limited to DropletAI staff." />
    );
  }
  return <>{children}</>;
}
