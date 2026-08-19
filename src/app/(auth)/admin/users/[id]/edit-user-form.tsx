"use client";

import { useState } from "react";
import type { UserRole } from "@/types/ticket";
import { INTERNAL_ROLES, ROLE_OPTIONS } from "@/lib/roles";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";

interface UserData {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  customer_id: string | null;
  phone: string | null;
  slack_user_id: string | null;
  created_at: string;
}

export function EditUserForm({ user }: { user: UserData }) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [saving, setSaving] = useState(false);
  const [slackUserId, setSlackUserId] = useState(user.slack_user_id || "");
  const [slackSaving, setSlackSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [slackMessage, setSlackMessage] = useState<{
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
    if (saving || isInactive) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          role,
          ...(status !== user.status ? { status } : {}),
        }),
      });

      await assertClientMutationResponse(res, "Failed to update user");

      setMessage({ type: "success", text: "User updated successfully" });
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "User update is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSlackSave(e: React.FormEvent) {
    e.preventDefault();
    if (slackSaving || isInactive) return;
    setSlackSaving(true);
    setSlackMessage(null);

    try {
      const normalizedSlackUserId = slackUserId.trim().toUpperCase();
      const res = await fetch(`/api/admin/users/${user.id}/slack`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slack_user_id: normalizedSlackUserId || null,
        }),
      });

      await assertClientMutationResponse(
        res,
        "Failed to update Slack identity"
      );
      setSlackUserId(normalizedSlackUserId);
      setSlackMessage({
        type: "success",
        text: normalizedSlackUserId
          ? "Slack identity linked successfully"
          : "Slack identity cleared successfully",
      });
    } catch (err) {
      setSlackMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Slack identity update is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSlackSaving(false);
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
          role={message.type === "error" ? "alert" : "status"}
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <form aria-busy={saving} onSubmit={handleSave} className="space-y-4">
        <div>
          <p className="block text-sm font-medium text-foreground mb-1">
            Email
          </p>
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
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            maxLength={200}
            disabled={saving || isInactive}
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
            disabled={saving || isInactive}
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
            disabled={saving || isInactive}
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

      <div className="my-6 border-t border-border" />

      <form
        aria-busy={slackSaving}
        onSubmit={handleSlackSave}
        className="space-y-4"
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Slack identity
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Link this account so signed Slack ticket replies and internal
            actions can be attributed and authorized. In Slack, open the
            member profile, choose More, then copy the member ID.
          </p>
        </div>

        {slackMessage && (
          <div
            role={slackMessage.type === "error" ? "alert" : "status"}
            className={`rounded-lg border px-4 py-3 text-sm ${
              slackMessage.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {slackMessage.text}
          </div>
        )}

        <div>
          <label
            htmlFor="admin-user-slack-id"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Slack User ID
          </label>
          <input
            id="admin-user-slack-id"
            type="text"
            autoComplete="off"
            inputMode="text"
            spellCheck={false}
            value={slackUserId}
            onChange={(e) => setSlackUserId(e.target.value.toUpperCase())}
            minLength={9}
            maxLength={50}
            pattern="[UW][A-Z0-9]{8,49}"
            placeholder="U012ABCDEF0"
            aria-describedby="admin-user-slack-id-help"
            disabled={slackSaving || isInactive}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
          />
          <p
            id="admin-user-slack-id-help"
            className="mt-1 text-xs text-muted-foreground"
          >
            IDs start with U or W. Clear the field and save to unlink it. One
            Slack identity can belong to only one Ripple user.
          </p>
        </div>

        <button
          type="submit"
          disabled={slackSaving || isInactive}
          className="min-h-11 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {slackSaving ? "Saving..." : "Save Slack Identity"}
        </button>
      </form>
    </div>
  );
}
