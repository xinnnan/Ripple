import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types/ticket";
import type { UserRole } from "@/types/ticket";
import { isCustomerManager } from "@/lib/roles";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Check if user is a customer_manager
  const { data: userProfile } = await supabase
    .from("users")
    .select("role, customer_id")
    .eq("id", user.id)
    .single();

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
    slack_channel_id: string | null;
    customer: { name: string }[] | null;
  }

  let sites: (SiteRow & { member_role: string })[] = [];

  if (isManager && customerId) {
    // Customer managers see ALL sites under their customer
    const admin = createAdminClient();
    const { data: allSites } = await admin
      .from("sites")
      .select("id, site_name, site_code, project_status, timezone, address, slack_channel_id, customer:customers(name)")
      .eq("customer_id", customerId)
      .eq("status", "active")
      .order("site_name");

    sites = (allSites || []).map((s) => ({
      ...(s as unknown as SiteRow),
      member_role: "manager",
    }));
  } else {
    // Regular customer users see only their assigned sites
    const { data: memberships } = await supabase
      .from("site_members")
      .select(
        `
        role,
        sites(
          id,
          site_name,
          site_code,
          project_status,
          timezone,
          address,
          slack_channel_id,
          customer:customers(name)
        )
      `
      )
      .eq("user_id", user.id);

    sites =
      memberships?.map((m) => {
        const s = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as unknown as SiteRow;
        return {
          ...s,
          member_role: m.role,
        };
      }) || [];
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">My Sites</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sites you have access to for submitting and tracking support tickets
        </p>
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
              No sites under your organization yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              Your organization doesn&apos;t have any active sites. Contact
              your DropletAI Account Manager to get set up.
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
              No sites assigned to you
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              You don&apos;t have access to any sites yet. Ask your Customer
              Manager to assign you to one.
            </p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => {
            const status = (site.project_status as string) || "pre_signoff";
            const statusLabel =
              PROJECT_STATUS_LABELS[
                status as keyof typeof PROJECT_STATUS_LABELS
              ] || status;
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
                  {site.customer && site.customer[0]?.name && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Customer</span>
                      <span className="text-foreground font-medium">
                        {site.customer[0].name}
                      </span>
                    </div>
                  )}
                  {site.timezone && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Timezone</span>
                      <span className="text-foreground">
                        {site.timezone as string}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your Role</span>
                    <span className="text-foreground capitalize">
                      {site.member_role}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-border">
                  <Link
                    href={`/tickets?site_id=${site.id}`}
                    className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    View Tickets →
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
