import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { TableEmpty } from "@/components/empty-state";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_ENTITIES,
  parseAdminAuditPageFilters,
} from "@/lib/admin-list-filters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const AUDIT_PAGE_SELECT =
  "id, created_at, entity_type, entity_id, action, field_name, old_value, new_value, actor_email, actor_full_name, actor_role, metadata";

const ENTITY_LABELS: Record<(typeof ADMIN_AUDIT_ENTITIES)[number], string> = {
  ticket: "Ticket",
  customer: "Customer",
  site: "Site",
  user: "User",
  spare_part: "Spare part",
  part_request: "Part request",
  field_service_order: "Field service",
  sla_policy: "SLA policy",
  comment: "Comment",
  attachment: "Attachment",
  auth: "Auth",
};

const ACTION_LABELS: Record<(typeof ADMIN_AUDIT_ACTIONS)[number], string> = {
  created: "Created",
  updated: "Updated",
  archived: "Archived",
  deactivated: "Deactivated",
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface AuditLogRow {
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
}

export default async function AuditPage({ searchParams }: Props) {
  const raw = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const entry of value) urlParams.append(key, entry);
    } else if (value !== undefined) {
      urlParams.append(key, value);
    }
  }
  const parsedFilters = parseAdminAuditPageFilters(urlParams);
  const filters = parsedFilters.success
    ? parsedFilters.data
    : { entityType: undefined, action: undefined, actorId: undefined, page: 1 };
  const entityType = filters.entityType || "";
  const action = filters.action || "";
  const actorId = filters.actorId || "";
  const page = filters.page;
  const from = (page - 1) * PAGE_SIZE;

  let logs: AuditLogRow[] = [];
  let total = 0;
  let loadError = parsedFilters.success
    ? null
    : "Invalid audit filters. Clear the filters and try again.";

  if (parsedFilters.success) {
    const supabase = createAdminClient();
    let query = supabase
      .from("audit_logs_with_actor")
      .select(AUDIT_PAGE_SELECT, { count: "exact" })
      .order("created_at", { ascending: false });

    if (entityType) query = query.eq("entity_type", entityType);
    if (action) query = query.eq("action", action);
    if (actorId) query = query.eq("actor_id", actorId);

    const { data, error, count } = await query.range(
      from,
      from + PAGE_SIZE - 1
    );
    if (error) {
      console.error("[admin/audit] query failed:", {
        code: (error as { code?: string }).code,
      });
      loadError =
        "Audit entries could not be loaded. Refresh the page or try again later.";
    } else {
      logs = (data || []) as AuditLogRow[];
      total = count ?? logs.length;
    }
  }

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

      {loadError ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {loadError}{" "}
          <Link href="/admin/audit" className="font-medium underline">
            Clear filters
          </Link>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">
          {total === 0
            ? "No entries match"
            : `Showing ${from + 1}–${from + logs.length} of ${total}`}
        </p>
      )}

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
            {logs.length === 0 ? (
              <TableEmpty
                colSpan={5}
                icon="search"
                title={loadError ? "Audit log unavailable" : "No audit entries"}
                description={
                  loadError
                    ? "No audit data was shown because the request could not be completed."
                    : entityType || action || actorId
                    ? "No entries match the current filter."
                    : "Once customers / sites / users / spare parts are mutated, the changes will appear here."
                }
                action={
                  loadError || entityType || action || actorId
                    ? { label: "Clear filters", href: "/admin/audit" }
                    : undefined
                }
              />
            ) : (
              logs.map(
                (log) => {
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
                        {ACTION_LABELS[
                          log.action as keyof typeof ACTION_LABELS
                        ] || log.action}
                      </td>
                      <td className="p-3 text-sm">
                        <span className="text-muted-foreground">
                          {ENTITY_LABELS[
                            log.entity_type as keyof typeof ENTITY_LABELS
                          ] || log.entity_type}
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
        {!loadError && from + logs.length < total && (
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
