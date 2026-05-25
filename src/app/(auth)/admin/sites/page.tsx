import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole, ProjectStatus } from "@/types/ticket";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
} from "@/types/ticket";
import { CreateSiteForm } from "./create-site-form";
import { ADMIN_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AdminSitesPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .single();

  const role = userProfile?.role as UserRole | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const { data: sites } = await admin
    .from("sites")
    .select(
      `
      id,
      site_name,
      site_code,
      project_status,
      timezone,
      slack_channel_id,
      status,
      customer:customers(id, name),
      site_members(user_id)
    `
    )
    .order("site_name")
    .limit(200);

  // Get all customers for create form
  const { data: customers } = await admin
    .from("customers")
    .select("id, name")
    .order("name");

  interface SiteRow {
    id: string;
    site_name: string;
    site_code: string;
    project_status: string;
    timezone: string;
    slack_channel_id: string | null;
    status: string;
    customer: { id: string; name: string }[] | null;
    site_members: { user_id: string }[] | null;
  }

  const typedSites = (sites || []) as unknown as SiteRow[];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Site Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage site codes, project status, and Slack channel linking
          </p>
        </div>
      </div>

      {/* Create Site Form */}
      <CreateSiteForm customers={customers || []} />

      {/* Sites Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/50">
          <h2 className="text-base font-semibold text-foreground">
            All Sites ({typedSites.length})
          </h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                Site Code
              </th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                Site Name
              </th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                Customer
              </th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                Project Status
              </th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                Slack Channel
              </th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">
                Members
              </th>
              <th className="p-3 text-right text-xs font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {typedSites.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  No sites found. Use the form above to create your first site.
                </td>
              </tr>
            ) : (
              typedSites.map((site) => {
                const customerData = site.customer as unknown as { name: string }[] | null;
                const customerName = Array.isArray(customerData)
                  ? customerData[0]?.name
                  : "Unknown";
                const statusColor =
                  PROJECT_STATUS_COLORS[
                    site.project_status as ProjectStatus
                  ] || "bg-gray-100 text-gray-800";
                const statusLabel =
                  PROJECT_STATUS_LABELS[
                    site.project_status as ProjectStatus
                  ] || site.project_status;

                return (
                  <tr key={site.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-xs font-mono font-semibold text-primary">
                        {site.site_code}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-sm font-medium text-foreground">
                        {site.site_name}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-foreground">
                        {customerName}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td className="p-3">
                      {site.slack_channel_id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <svg
                            className="h-3 w-3"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.521-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.521 2.521h-2.521V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.124a2.528 2.528 0 0 1 2.523 2.521A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.521v-2.521h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.314A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.521 2.523h-6.314z" />
                          </svg>
                          Linked
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not linked
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-foreground">
                        {site.site_members?.length || 0}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/admin/sites/${site.id}`}
                        className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
