import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { isCustomerManager } from "@/lib/roles";
import { EditTeamMemberForm } from "./edit-team-member-form";
import { parseUuidRouteId } from "@/lib/request-identifiers";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("team.member");
  return { title: t("metaTitle") };
}

export const dynamic = "force-dynamic";

export default async function EditTeamMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const rawId = (await params).id;
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  // Verify customer_manager role
  const profileResult = await supabase
    .from("users")
    .select("role, email, customer_id")
    .eq("id", authUser.id)
    .maybeSingle();
  assertPageQueriesSucceeded("team/member-detail-profile", profileResult);
  const userProfile = profileResult.data;

  const role = userProfile?.role as UserRole | undefined;
  const customerId = userProfile?.customer_id as string | null;

  if (!role || !isCustomerManager(role) || !customerId) {
    redirect("/dashboard");
  }

  const id = parseUuidRouteId(rawId);
  if (!id) notFound();

  const admin = createAdminClient();
  const [t, labels] = await Promise.all([
    getTranslations("team.member"),
    getTranslations("labels"),
  ]);

  // Get the target user
  const targetResult = await admin
    .from("users")
    .select("id, email, full_name, role, status, phone, customer_id")
    .eq("id", id)
    .maybeSingle();
  assertPageQueriesSucceeded("team/member-detail", targetResult);
  const targetUser = targetResult.data;

  if (!targetUser || (targetUser as unknown as { customer_id: string | null }).customer_id !== customerId) {
    return (
      <div className="p-4 sm:p-8">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
        <Link href="/team" className="text-sm text-primary hover:text-primary/80 mt-2 inline-block">
          {t("back")}
        </Link>
      </div>
    );
  }

  // Get user's current sites
  const membershipsResult = await admin
    .from("site_members")
    .select("site_id")
    .eq("user_id", id);

  // Get available sites for the customer
  const sitesResult = await admin
    .from("sites")
    .select("id, site_name, site_code")
    .eq("customer_id", customerId)
    .eq("status", "active")
    .order("site_name");
  assertPageQueriesSucceeded(
    "team/member-detail-related",
    membershipsResult,
    sitesResult
  );
  const memberships = membershipsResult.data;
  const sites = sitesResult.data;

  // Archived sites cannot be newly assigned. Excluding their legacy
  // memberships from the desired set lets the atomic update remove stale
  // access rather than submitting hidden, invalid site IDs.
  const activeSiteIds = new Set((sites || []).map((site) => site.id));
  const currentSiteIds = (memberships || [])
    .map((membership: { site_id: string }) => membership.site_id)
    .filter((siteId) => activeSiteIds.has(siteId));

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <Link href="/team" className="text-sm text-primary hover:text-primary/80">
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("subtitle", { name: targetUser.full_name })}
        </p>
      </div>

      <div className="max-w-3xl">
        <div className="rounded-xl border border-border p-6 mb-6">
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">{t("email")}</dt>
              <dd className="text-foreground">{targetUser.email}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">{t("role")}</dt>
              <dd>
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                  {labels.has(`role.${targetUser.role}`) ? labels(`role.${targetUser.role}`) : targetUser.role}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <EditTeamMemberForm
          user={{
            id: targetUser.id,
            full_name: targetUser.full_name,
            status: targetUser.status,
          }}
          sites={sites || []}
          currentSiteIds={currentSiteIds}
        />
      </div>
    </div>
  );
}
