import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROJECT_STATUS_COLORS } from "@/types/ticket";
import type { UserRole } from "@/types/ticket";
import { isCustomerManager } from "@/lib/roles";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";
import { singleRelation } from "@/lib/utils";
import Link from "next/link";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sites");
  return { title: t("metaTitle") };
}

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Check if user is a customer_manager
  const profileResult = await supabase
    .from("users")
    .select("role, customer_id")
    .eq("id", user.id)
    .maybeSingle();
  assertPageQueriesSucceeded("sites/profile", profileResult);
  const userProfile = profileResult.data;

  const role = userProfile?.role as UserRole | undefined;
  const customerId = userProfile?.customer_id as string | null;
  const isManager = role ? isCustomerManager(role) : false;

  interface SiteRow {
    id: string;
    site_name: string;
    site_code: string;
    project_status: string;
    timezone: string;
    address: string | null;
    customer: { name: string }[] | { name: string } | null;
  }

  let sites: (SiteRow & { member_role: string })[] = [];
  const admin = createAdminClient();

  if (isManager && customerId) {
    // Customer managers see ALL sites under their customer
    const sitesResult = await admin
      .from("sites")
      .select(
        "id, site_name, site_code, project_status, timezone, address, customer:customers!inner(name)"
      )
      .eq("customer_id", customerId)
      .eq("status", "active")
      .in("customer.status", ["active", "trial"])
      .order("site_name");
    assertPageQueriesSucceeded("sites/manager-list", sitesResult);

    sites = (sitesResult.data || []).map((s) => ({
      ...(s as unknown as SiteRow),
      member_role: "manager",
    }));
  } else {
    // Retained memberships are historical facts. Hydrate only their currently
    // active sites under active/trial customers before presenting access.
    const membershipsResult = await admin
      .from("site_members")
      .select("role, site_id")
      .eq("user_id", user.id);
    assertPageQueriesSucceeded("sites/membership-list", membershipsResult);

    const memberships = membershipsResult.data || [];
    const memberRoleBySite = new Map(
      memberships.map((membership) => [membership.site_id, membership.role])
    );
    const siteIds = [...memberRoleBySite.keys()];

    if (siteIds.length > 0) {
      const sitesResult = await admin
        .from("sites")
        .select(
          "id, site_name, site_code, project_status, timezone, address, customer:customers!inner(name)"
        )
        .in("id", siteIds)
        .eq("status", "active")
        .in("customer.status", ["active", "trial"])
        .order("site_name");
      assertPageQueriesSucceeded("sites/member-site-list", sitesResult);

      sites = (sitesResult.data || []).map((site) => ({
        ...(site as unknown as SiteRow),
        member_role: memberRoleBySite.get(site.id) || "member",
      }));
    }
  }

  const [t, labels] = await Promise.all([
    getTranslations("sites"),
    getTranslations("labels"),
  ]);
  const label = (group: string, value: string) =>
    labels.has(`${group}.${value}`) ? labels(`${group}.${value}`) : value;

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      {sites.length === 0 ? (
        isManager ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
            <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              {t("managerEmptyTitle")}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              {t("managerEmptyBody")}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
            <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              {t("emptyTitle")}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {t("emptyBody")}
            </p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => {
            const customer = singleRelation(site.customer);
            const status = (site.project_status as string) || "pre_signoff";
            const statusLabel = label("projectStatus", status);
            const statusColor =
              PROJECT_STATUS_COLORS[
                status as keyof typeof PROJECT_STATUS_COLORS
              ] || "bg-gray-100 text-gray-800";

            return (
              <div
                key={site.id as string}
                className="rounded-xl border border-border p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      {site.site_name as string}
                    </h3>
                    <p className="text-sm text-muted-foreground font-mono mt-0.5">
                      {site.site_code as string}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
                  >
                    {statusLabel}
                  </span>
                </div>

                <div className="space-y-2 text-sm">
                  {customer?.name && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("customer")}</span>
                      <span className="text-foreground font-medium">
                        {customer.name}
                      </span>
                    </div>
                  )}
                  {site.timezone && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("timezone")}</span>
                      <span className="text-foreground">
                        {site.timezone as string}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("yourRole")}</span>
                    <span className="text-foreground">
                      {label("memberRole", site.member_role)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <Link
                    href={`/tickets?site=${site.id}`}
                    className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    {t("viewTickets")}
                  </Link>
                  <Link
                    href="/submit"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t("newTicket")}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
