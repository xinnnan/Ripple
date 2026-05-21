"use client";

import { useState } from "react";
import type { UserRole } from "@/types/ticket";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "internal_admin", label: "Internal Admin" },
  { value: "internal_service_manager", label: "Service Manager" },
  { value: "internal_engineer", label: "Engineer" },
  { value: "internal_solution_engineer", label: "Solution Engineer" },
  { value: "customer_admin", label: "Customer Admin" },
  { value: "customer_user", label: "Customer User" },
  { value: "guest", label: "Guest" },
];

interface UserData {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, role, status }),
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
          <label className="block text-sm font-medium text-foreground mb-1">
            Full Name
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
