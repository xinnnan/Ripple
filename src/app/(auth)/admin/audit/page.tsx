import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { TableEmpty } from "@/components/empty-state";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const ENTITY_LABELS: Record<string, string> = {
  ticket: "Ticket",
  customer: "Customer",
  site: "Site",
  user: "User",
  spare_part: "Spare part",
  part_request: "Part request",
  field_service_order: "Field service",
  comment: "Comment",
  attachment: "Attachment",
  auth: "Auth",
};

const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  status_changed: "Status changed",
  severity_changed: "Severity changed",
  owner_assigned: "Owner assigned",
  resolved: "Resolved",
  reopened: "Reopened",
  assigned: "Assigned",
  joined: "Joined",
  left: "Left",
  login: "Logged in",
  login_failed: "Login failed",
  logout: "Logged out",
  role_changed: "Role changed",
};

interface Props {
  searchParams: Promise<{
    entity_type?: string;
    action?: string;
    actor_id?: string;
    page?: string;
  }>;
}

export default async function AuditPage({ searchParams }: Props) {
  const raw = await searchParams;
  const entityType = raw.entity_type || "";
  const action = raw.action || "";
  const actorId = raw.actor_id || "";
  const page = Math.max(1, parseInt(raw.page || "1", 10) || 1);

  const supabase = createAdminClient();

  let query = supabase
    .from("audit_logs_with_actor")
    .select("*")
    .order("created_at", { ascending: false });

  if (entityType) query = query.eq("entity_type", entityType);
  if (action) query = query.eq("action", action);
  if (actorId) query = query.eq("actor_id", actorId);

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  query = query.range(from, to);

  const { data: logs } = await query;
  const total = logs?.length || 0;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every change outside of a ticket. Customer / site / user / spare part
          mutations land here.
        </p>
      </div>

      {/* Filters */}
      <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Entity
          </label>
          <select
            name="entity_type"
            defaultValue={entityType}
            className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
          >
            <option value="">All entities</option>
            {Object.entries(ENTITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Action
          </label>
          <select
            name="action"
            defaultValue={action}
            className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Filter
        </button>
        {(entityType || action || actorId) && (
          <Link
            href="/admin/audit"
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Clear
          </Link>
        )}
      </form>

      <p className="text-xs text-muted-foreground mb-3">
        {total === 0
          ? "No entries match"
          : `Showing ${from + 1}–${from + total} of this page (page ${page}, ${PAGE_SIZE} per page)`}
      </p>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                When
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Who
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Action
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Entity
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                What changed
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {total === 0 ? (
              <TableEmpty
                colSpan={5}
                icon="search"
                title="No audit entries"
                description={
                  entityType || action
                    ? "No entries match the current filter."
                    : "Once customers / sites / users / spare parts are mutated, the changes will appear here."
                }
                action={
                  entityType || action
                    ? { label: "Clear filters", href: "/admin/audit" }
                    : undefined
                }
              />
            ) : (
              logs?.map(
                (log: {
                  id: string;
                  created_at: string;
                  entity_type: string;
                  entity_id: string | null;
                  action: string;
                  field_name: string | null;
                  old_value: string | null;
                  new_value: string | null;
                  actor_email: string | null;
                  actor_full_name: string | null;
                  actor_role: string | null;
                  metadata: Record<string, unknown> | null;
                }) => {
                  const actor = log.actor_full_name || log.actor_email || "—";
                  return (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="p-3 text-sm">
                        {actor}
                        {log.actor_role && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({log.actor_role})
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-sm">
                        {ACTION_LABELS[log.action] || log.action}
                      </td>
                      <td className="p-3 text-sm">
                        <span className="text-muted-foreground">
                          {ENTITY_LABELS[log.entity_type] || log.entity_type}
                        </span>
                        {log.entity_type === "ticket" && log.entity_id && (
                          <Link
                            href={`/tickets/${log.entity_id}`}
                            className="ml-1.5 text-primary hover:text-primary/80 text-xs font-mono"
                          >
                            {String(log.metadata?.ticket_no || log.entity_id.slice(0, 8))}
                          </Link>
                        )}
                        {log.entity_type === "customer" && log.entity_id && (
                          <Link
                            href={`/admin/customers/${log.entity_id}`}
                            className="ml-1.5 text-primary hover:text-primary/80 text-xs"
                          >
                            view
                          </Link>
                        )}
                        {log.entity_type === "site" && log.entity_id && (
                          <Link
                            href={`/admin/sites/${log.entity_id}`}
                            className="ml-1.5 text-primary hover:text-primary/80 text-xs"
                          >
                            view
                          </Link>
                        )}
                      </td>
                      <td className="p-3 text-sm">
                        {log.field_name ? (
                          <div className="space-y-0.5">
                            <div className="text-xs font-medium text-foreground">
                              {log.field_name}
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-2">
                              {log.old_value && (
                                <span className="line-through mr-1.5">
                                  {log.old_value}
                                </span>
                              )}
                              {log.new_value && (
                                <span className="text-foreground">
                                  → {log.new_value}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                }
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center gap-2 mt-4">
        {page > 1 && (
          <Link
            href={`/admin/audit?${new URLSearchParams({
              ...(entityType && { entity_type: entityType }),
              ...(action && { action }),
              ...(actorId && { actor_id: actorId }),
              page: String(page - 1),
            })}`}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            ‹ Previous
          </Link>
        )}
        {total === PAGE_SIZE && (
          <Link
            href={`/admin/audit?${new URLSearchParams({
              ...(entityType && { entity_type: entityType }),
              ...(action && { action }),
              ...(actorId && { actor_id: actorId }),
              page: String(page + 1),
            })}`}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            Next ›
          </Link>
        )}
      </div>
    </div>
  );
}
