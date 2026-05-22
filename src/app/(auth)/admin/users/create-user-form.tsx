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

export function CreateUserForm() {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("customer_user");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          role,
          phone: phone || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }

      setMessage({ type: "success", text: `User ${email} created successfully` });
      setEmail("");
      setPassword("");
      setFullName("");
      setRole("customer_user");
      setPhone("");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to create user",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <div className="mb-6">
        <button
          onClick={() => setExpanded(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + Create User
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">
          Create New User
        </h2>
        <button
          onClick={() => setExpanded(false)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

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

      <form onSubmit={handleCreate} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="user@company.com"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Password *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="At least 6 characters"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Full Name *
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="John Doe"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Role *
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
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
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create User"}
        </button>
      </form>
    </div>
  );
}
