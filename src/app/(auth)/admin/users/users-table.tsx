"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { ROLE_LABELS } from "@/lib/roles";

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  created_at: string;
  site_members: {
    site_id: string;
    sites: { site_name: string; site_code: string }[] | null;
  }[];
}

export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function toggle(id: string) {
    const user = users.find((candidate) => candidate.id === id);
    if (!user || user.id === currentUserId || user.status === "inactive") return;
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const eligibleIds = users
      .filter((user) => user.id !== currentUserId && user.status !== "inactive")
      .map((user) => user.id);
    setSelected((s) =>
      s.size === eligibleIds.length ? new Set() : new Set(eligibleIds)
    );
  }

  async function performDeactivate() {
    if (selected.size === 0) return;
    setError(null);
    const ids = Array.from(selected);
    setActionPending(true);
    try {
      const res = await fetch("/api/admin/users/bulk-deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        failed?: unknown;
      };
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "User deactivation failed. Please retry."
        );
        return;
      }
      setConfirming(false);
      setSelected(new Set());
      if (Array.isArray(data.failed) && data.failed.length > 0) {
        setError("Some users could not be deactivated. Refresh and retry.");
      }
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("User deactivation is temporarily unavailable. Please retry.");
    } finally {
      setActionPending(false);
    }
  }

  const eligibleCount = users.filter(
    (user) => user.id !== currentUserId && user.status !== "inactive"
  ).length;
  const allSelected = eligibleCount > 0 && selected.size === eligibleCount;
  const someSelected = selected.size > 0 && selected.size < eligibleCount;
  const busy = pending || actionPending;

  return (
    <div aria-busy={busy} className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {selected.size > 0 ? `${selected.size} selected` : `${users.length} user${users.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              disabled={busy}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={selected.size === 0 || busy}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Deactivate selected ({selected.size})
          </button>
        </div>
      </div>

      {confirming && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold mb-1">Deactivate {selected.size} user{selected.size === 1 ? "" : "s"}?</p>
          <p className="text-xs mb-3">
            Access stops on the next request. The auth identity, memberships,
            field-service assignments, and attributable audit history are preserved.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={performDeactivate}
              disabled={busy}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40"
            >
              {busy ? "Deactivating…" : "Yes, deactivate"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  disabled={busy}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-border"
                />
              </th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">User</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">Role</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">Sites</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-left text-xs font-medium text-muted-foreground">Created</th>
              <th className="p-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  className={`hover:bg-muted/30 transition-colors ${selected.has(u.id) ? "bg-amber-50/40" : ""}`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${u.email}`}
                      checked={selected.has(u.id)}
                      disabled={busy || u.id === currentUserId || u.status === "inactive"}
                      onChange={() => toggle(u.id)}
                      className="h-4 w-4 rounded border-border disabled:opacity-40"
                    />
                  </td>
                  <td className="p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{u.full_name || "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                      {ROLE_LABELS[u.role as UserRole] || u.role}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="space-y-0.5">
                      {u.site_members && u.site_members.length > 0 ? (
                        u.site_members.map((sm, i) => {
                          const siteData = Array.isArray(sm.sites) ? sm.sites[0] : sm.sites;
                          return (
                            <p key={i} className="text-xs text-muted-foreground">
                              {siteData?.site_name || "Unknown"}{" "}
                              <span className="font-mono">({siteData?.site_code})</span>
                            </p>
                          );
                        })
                      ) : (
                        <p className="text-xs text-muted-foreground">No sites</p>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-700"
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
