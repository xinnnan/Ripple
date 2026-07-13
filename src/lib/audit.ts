// Audit log helper. Use this to write to the cross-entity `audit_logs` table.
//
// Usage:
//   import { logAudit } from "@/lib/audit";
//   await logAudit({
//     actorId: auth.userId,
//     actorEmail: auth.email,
//     actorRole: auth.role,
//     entityType: "customer",
//     entityId: customerId,
//     action: "updated",
//     fieldName: "status",
//     oldValue: "trial",
//     newValue: "active",
//   });
//
// `audit()` is a noop-friendly wrapper: it never throws (audit failures
// shouldn't break the user's action), and it batches so a single API
// call that touches multiple fields can log them in one transaction
// via `withAudit()`.

import { createAdminClient } from "@/lib/supabase/admin";

export type AuditEntity =
  | "ticket"
  | "customer"
  | "site"
  | "user"
  | "spare_part"
  | "part_request"
  | "field_service_order"
  | "comment"
  | "attachment"
  | "auth";

export type AuditAction =
  | "created"
  | "updated"
  | "deleted"
  | "status_changed"
  | "severity_changed"
  | "owner_assigned"
  | "resolved"
  | "reopened"
  | "assigned"
  | "joined"
  | "left"
  | "login"
  | "login_failed"
  | "logout"
  | "role_changed";

export type AuditEntry = {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  entityType: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Best-effort write to the audit log. Errors are caught and logged so
 * audit failures never break the caller's flow.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      actor_role: entry.actorRole ?? null,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      action: entry.action,
      field_name: entry.fieldName ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      metadata: entry.metadata ?? {},
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
    });
    if (error) {
      console.error("[audit] write failed:", error);
    }
  } catch (e) {
    // Never throw — audit must not break the user action
    console.error("[audit] unexpected error:", e);
  }
}

/**
 * Compute a diff between two objects and emit one audit entry per
 * changed field. Convenience wrapper for the common PATCH case.
 */
export async function logDiff(args: {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  entityType: AuditEntity;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  ignoredFields?: string[];
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { actorId, actorEmail, actorRole, entityType, entityId, before, after, ignoredFields, metadata } = args;
  const ignored = new Set(ignoredFields || ["updated_at"]);
  for (const [field, newVal] of Object.entries(after)) {
    if (ignored.has(field)) continue;
    const oldVal = before ? before[field] : undefined;
    if (oldVal === newVal) continue;
    await logAudit({
      actorId,
      actorEmail,
      actorRole,
      entityType,
      entityId,
      action: "updated",
      fieldName: field,
      oldValue: oldVal == null ? null : String(oldVal),
      newValue: newVal == null ? null : String(newVal),
      metadata,
    });
  }
}
