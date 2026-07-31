"use client";

import { useState } from "react";
import type { UserRole } from "@/types/ticket";
import { INTERNAL_ROLES, ROLE_OPTIONS } from "@/lib/roles";

interface UserData {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  customer_id: string | null;
  phone: string | null;
  created_at: string;
}

export function EditUserForm({ user }: { user: UserData }) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const isInactive = user.status === "inactive";
  const isInternal = INTERNAL_ROLES.includes(user.role as UserRole);
  const allowedRoles = ROLE_OPTIONS.filter((option) =>
    isInternal
      ? INTERNAL_ROLES.includes(option.value)
      : !INTERNAL_ROLES.includes(option.value)
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          role,
          ...(status !== user.status ? { status } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update user");
      }

      setMessage({ type: "success", text: "User updated successfully" });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update user",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="text-base font-semibold text-foreground mb-4">
        User Details
      </h2>

      {isInactive && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This account is inactive and read-only. Reactivation requires a
          dedicated reviewed workflow.
        </div>
      )}

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Email
          </label>
          <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
            {user.email}
          </div>
        </div>

        <div>
          <label
            htmlFor="admin-user-full-name"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Full Name
          </label>
          <input
            id="admin-user-full-name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={isInactive}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        <div>
          <label
            htmlFor="admin-user-role"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Role
          </label>
          <select
            id="admin-user-role"
            aria-describedby="admin-user-role-help"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={isInactive}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            {allowedRoles.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                disabled={
                  opt.value === "customer_manager" && !user.customer_id
                }
              >
                {opt.label}
              </option>
            ))}
          </select>
          <p
            id="admin-user-role-help"
            className="mt-1 text-xs text-muted-foreground"
          >
            Internal/customer role-family transfers require a dedicated tenant
            transfer workflow. Customer managers must belong to a customer.
          </p>
        </div>

        <div>
          <label
            htmlFor="admin-user-status"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Status
          </label>
          <select
            id="admin-user-status"
            aria-describedby="admin-user-status-help"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={isInactive}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            {user.status === "invited" && (
              <option value="invited">Invited</option>
            )}
            {user.status === "inactive" && (
              <option value="inactive" disabled>
                Inactive (deactivated)
              </option>
            )}
          </select>
          <p
            id="admin-user-status-help"
            className="mt-1 text-xs text-muted-foreground"
          >
            Deactivate accounts from the user list so identity and attribution
            records are preserved.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving || isInactive}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
