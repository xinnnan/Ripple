import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { isCustomerManager } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import { CreateTeamMemberForm } from "./create-team-member-form";
import { TableEmpty } from "@/components/empty-state";
import { buildTeamSiteAccess } from "@/lib/team/read-model";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("team");
  return { title: t("metaTitle") };
}

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const profileResult = await supabase
    .from("users")
    .select("role, email, customer_id")
    .eq("id", authUser.id)
    .maybeSingle();
  assertPageQueriesSucceeded("team/profile", profileResult);
  const userProfile = profileResult.data;

  const role = userProfile?.role as UserRole | undefined;
  const customerId = userProfile?.customer_id as string | null;

  if (!role || !isCustomerManager(role) || !customerId) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const [usersResult, sitesResult] = await Promise.all([
    admin
      .from("users")
      .select("id, email, full_name, role, status, phone, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true }),
    admin
      .from("sites")
      .select("id, site_name, site_code, customer:customers!inner(id)")
      .eq("customer_id", customerId)
      .eq("status", "active")
      .in("customer.status", ["active", "trial"])
      .order("site_name"),
  ]);
  assertPageQueriesSucceeded("team/read-model", usersResult, sitesResult);
  const users = usersResult.data || [];
  const sites = (sitesResult.data || []).map((site) => ({
    id: site.id,
    site_name: site.site_name,
    site_code: site.site_code,
  }));

  const userIds = users.map((u: { id: string }) => u.id);
  const membershipsResult =
    userIds.length > 0
      ? await admin
          .from("site_members")
          .select("user_id, site_id")
          .in("user_id", userIds)
      : { data: [], error: null };
  assertPageQueriesSucceeded("team/membership-list", membershipsResult);
  const siteAccess = buildTeamSiteAccess(
    users,
    sites,
    membershipsResult.data || []
  );

  const [t, labels, locale] = await Promise.all([
    getTranslations("team"),
    getTranslations("labels"),
    getLocale(),
  ]);
  const total = users?.length || 0;
  const active = users?.filter((u: { status: string }) => u.status === "active").length || 0;
  const managers = users?.filter((u: { role: string }) => u.role === "customer_manager").length || 0;
  const customers = users?.filter((u: { role: string }) => u.role === "customer").length || 0;

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Team overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">{t("stats.total")}</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{total}</p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">{t("stats.active")}</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{active}</p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">{t("stats.managers")}</p>
          <p className="text-3xl font-bold text-purple-600 mt-1">{managers}</p>
        </div>
        <div className="rounded-xl border border-border p-6">
          <p className="text-xs text-muted-foreground">{t("stats.customers")}</p>
          <p className="text-3xl font-bold text-amber-600 mt-1">{customers}</p>
        </div>
      </div>

      <CreateTeamMemberForm sites={sites} />

      {/* Team Members Table */}
      <div className="rounded-xl border border-border overflow-x-auto">
        {total === 0 ? (
          <TableEmpty
            colSpan={1}
            icon="users"
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  {t("columns.name")}
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  {t("columns.email")}
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  {t("columns.role")}
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  {t("columns.sites")}
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  {t("columns.status")}
                </th>
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                  {t("columns.joined")}
                </th>
                <th className="p-3 text-right text-xs font-medium text-muted-foreground">
                  {t("columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.map(
                (u: {
                  id: string;
                  email: string;
                  full_name: string;
                  role: string;
                  status: string;
                  phone: string | null;
                  created_at: string;
                }) => {
                  const userSites = siteAccess.get(u.id) || [];
                  return (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="p-3">
                        <p className="text-sm font-medium text-foreground">
                          {u.full_name}
                        </p>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {u.email}
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                          {labels.has(`role.${u.role}`) ? labels(`role.${u.role}`) : u.role}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {userSites.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {t("noSites")}
                            </span>
                          ) : (
                            <>
                              {userSites.slice(0, 2).map((s) => (
                                <span
                                  key={s.id}
                                  className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
                                >
                                  {s.site_name}
                                </span>
                              ))}
                              {userSites.length > 2 && (
                                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                  +{userSites.length - 2}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.status === "active"
                              ? "bg-green-50 text-green-700"
                              : "bg-gray-50 text-gray-700"
                          }`}
                        >
                          {labels.has(`userStatus.${u.status}`) ? labels(`userStatus.${u.status}`) : u.status}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatDate(u.created_at, undefined, locale)}
                      </td>
                      <td className="p-3 text-right">
                        {u.role === "customer_manager" ? (
                          <span className="text-xs text-muted-foreground">
                            {t("organizationWide")}
                          </span>
                        ) : (
                          <Link
                            href={`/team/${u.id}`}
                            className="text-sm font-medium text-primary hover:text-primary/80"
                          >
                            {t("edit")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
