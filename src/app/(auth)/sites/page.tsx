import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types/ticket";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Get user's accessible sites
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

  const sites =
    memberships?.map((m) => {
      const s = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as unknown as SiteRow;
      return {
        ...s,
        member_role: m.role,
      };
    }) || [];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">My Sites</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sites you have access to for submitting and tracking support tickets
        </p>
      </div>

      {sites.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center">
          <Image
            src="/logo.png"
            alt="Ripple"
            width={48}
            height={48}
            className="rounded-xl mx-auto mb-4 opacity-50"
          />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No sites assigned
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            You do not have access to any sites yet. Contact your DropletAI
            Account Manager to get set up.
          </p>
        </div>
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
                      {(site as Record<string, unknown>).member_role as string}
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
