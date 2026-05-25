import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { EditSiteForm } from "./edit-site-form";
import { ADMIN_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AdminSiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  // Get site details
  const { data: site } = await admin
    .from("sites")
    .select(
      `
      id,
      site_name,
      site_code,
      customer_id,
      timezone,
      address,
      slack_channel_id,
      default_owner_id,
      status,
      project_status,
      customer:customers(id, name)
    `
    )
    .eq("id", id)
    .single();

  if (!site) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Site not found.</p>
        <Link
          href="/admin/sites"
          className="text-sm font-medium text-primary hover:text-primary/80 mt-4 inline-block"
        >
          ← Back to Sites
        </Link>
      </div>
    );
  }

  // Get site members
  const { data: members } = await admin
    .from("site_members")
    .select(
      `
      id,
      role,
      user_id,
      users(id, email, full_name, role)
    `
    )
    .eq("site_id", id);

  // Get all customers for dropdown
  const { data: customers } = await admin
    .from("customers")
    .select("id, name")
    .order("name");

  interface MemberRow {
    id: string;
    role: string;
    user_id: string;
    users: { id: string; email: string; full_name: string; role: string }[] | null;
  }

  const typedMembers = (members || []) as unknown as MemberRow[];

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href="/admin/sites"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Sites
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">
          Edit Site: {site.site_name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage site details, project status, and Slack channel linking
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Site Edit Form */}
        <EditSiteForm
          site={site}
          customers={customers || []}
        />

        {/* Slack Channel Linking */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">
            Slack Channel
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Linked Channel
                </p>
                <p className="text-xs text-muted-foreground">
                  {site.slack_channel_id || "No channel linked"}
                </p>
              </div>
              <Link
                href={`/admin/sites/${id}/slack`}
                className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {site.slack_channel_id ? "Change Channel" : "Link Channel"}
              </Link>
            </div>
          </div>
        </div>

        {/* Site Members */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">
            Site Members ({typedMembers.length})
          </h2>

          {typedMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No members assigned to this site.
            </p>
          ) : (
            <div className="space-y-2 mb-4">
              {typedMembers.map((m) => {
                const userData = Array.isArray(m.users) ? m.users[0] : m.users;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {userData?.full_name || "Unnamed"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {userData?.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground capitalize">
                        {m.role}
                      </span>
                      <form
                        action={`/api/admin/site-members?action=remove&membershipId=${m.id}`}
                        method="POST"
                      >
                        <button
                          type="submit"
                          className="text-xs font-medium text-red-600 hover:text-red-800 transition-colors"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add member */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground mb-3">
              Add Member
            </h3>
            <form
              action={`/api/admin/site-members?siteId=${id}`}
              method="POST"
              className="flex items-end gap-3"
            >
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  User ID
                </label>
                <input
                  type="text"
                  name="user_id"
                  placeholder="Enter user UUID..."
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Role
                </label>
                <select
                  name="role"
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
