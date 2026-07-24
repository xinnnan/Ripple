"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CustomerOption {
  id: string;
  name: string;
}

interface SLAPolicyFormProps {
  mode: "create" | "edit";
  policyId?: string;
  initial?: {
    name: string;
    customer_id: string | null;
    is_default: boolean;
    p1_response_minutes: number;
    p1_resolution_minutes: number;
    p2_response_minutes: number;
    p2_resolution_minutes: number;
    p3_response_minutes: number;
    p3_resolution_minutes: number;
    p4_response_minutes: number;
    p4_resolution_minutes: number;
  };
  customers: CustomerOption[];
}

const SEVERITIES = [
  { key: "P1", label: "P1", color: "text-red-600" },
  { key: "P2", label: "P2", color: "text-orange-600" },
  { key: "P3", label: "P3", color: "text-blue-600" },
  { key: "P4", label: "P4", color: "text-gray-600" },
] as const;

function minutesToHuman(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  const d = Math.floor(min / (60 * 24));
  const h = Math.floor((min % (60 * 24)) / 60);
  return h === 0 ? `${d}d` : `${d}d${h}h`;
}

function humanToMinutes(s: string): number | null {
  const trimmed = s.trim().toLowerCase();
  if (trimmed === "") return 0;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const dMatch = trimmed.match(/(\d+)d/);
  const hMatch = trimmed.match(/(\d+)h/);
  const mMatch = trimmed.match(/(\d+)m/);
  if (!dMatch && !hMatch && !mMatch) return null;
  const d = dMatch ? parseInt(dMatch[1], 10) : 0;
  const h = hMatch ? parseInt(hMatch[1], 10) : 0;
  const m = mMatch ? parseInt(mMatch[1], 10) : 0;
  return d * 24 * 60 + h * 60 + m;
}

export function SLAPolicyForm({ mode, policyId, initial, customers }: SLAPolicyFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [minutes, setMinutes] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    if (initial) {
      m.p1r = minutesToHuman(initial.p1_response_minutes);
      m.p1s = minutesToHuman(initial.p1_resolution_minutes);
      m.p2r = minutesToHuman(initial.p2_response_minutes);
      m.p2s = minutesToHuman(initial.p2_resolution_minutes);
      m.p3r = minutesToHuman(initial.p3_response_minutes);
      m.p3s = minutesToHuman(initial.p3_resolution_minutes);
      m.p4r = minutesToHuman(initial.p4_response_minutes);
      m.p4s = minutesToHuman(initial.p4_resolution_minutes);
    } else {
      m.p1r = "15m"; m.p1s = "4h";
      m.p2r = "1h";  m.p2s = "8h";
      m.p3r = "4h";  m.p3s = "1d";
      m.p4r = "1d";  m.p4s = "3d";
    }
    return m;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function setM(key: string, value: string) {
    setMinutes((m) => ({ ...m, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const fields: Record<string, number> = {};
    for (const k of ["p1r", "p1s", "p2r", "p2s", "p3r", "p3s", "p4r", "p4s"]) {
      const v = humanToMinutes(minutes[k] ?? "");
      if (v == null) {
        setError(`Invalid time format for ${k}. Try "15m", "1h", "1h30m", "2d", "2d4h".`);
        setLoading(false);
        return;
      }
      if (v > 525600) {
        setError(`Each value must be 525600 minutes (1 year) or less. Got ${v} for ${k}.`);
        setLoading(false);
        return;
      }
      fields[k] = v;
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      is_default: isDefault,
      p1_response_minutes: fields.p1r,
      p1_resolution_minutes: fields.p1s,
      p2_response_minutes: fields.p2r,
      p2_resolution_minutes: fields.p2s,
      p3_response_minutes: fields.p3r,
      p3_resolution_minutes: fields.p3s,
      p4_response_minutes: fields.p4r,
      p4_resolution_minutes: fields.p4s,
    };
    if (customerId) body.customer_id = customerId;

    const url = mode === "create" ? "/api/admin/sla-policies" : `/api/admin/sla-policies/${policyId}`;
    const method = mode === "create" ? "POST" : "PATCH";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save policy");
      }
      router.push("/admin/sla-policies");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g., Acme Corp Premium SLA"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Customer</label>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={mode === "edit"}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          >
            <option value="">— Default policy (applies to all customers without an override) —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {mode === "edit" && (
            <p className="text-xs text-muted-foreground mt-1">
              Customer scope cannot be changed. Create a new policy to re-assign.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="is_default"
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <label htmlFor="is_default" className="text-sm text-foreground">
          Mark as the <span className="font-semibold">default policy</span> (applies to any customer without a specific override)
        </label>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-xs font-medium text-muted-foreground p-3 w-20">Severity</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Response time</th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">Resolution time</th>
            </tr>
          </thead>
          <tbody>
            {SEVERITIES.map((s) => (
              <tr key={s.key} className="border-b border-border last:border-0">
                <td className="p-3">
                  <span className={`text-sm font-bold ${s.color}`}>{s.label}</span>
                </td>
                <td className="p-3">
                  <input
                    type="text"
                    value={minutes[`${s.key.toLowerCase()}r`] ?? ""}
                    onChange={(e) => setM(`${s.key.toLowerCase()}r`, e.target.value)}
                    placeholder="e.g., 15m, 1h, 1h30m, 1d"
                    className="w-40 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </td>
                <td className="p-3">
                  <input
                    type="text"
                    value={minutes[`${s.key.toLowerCase()}s`] ?? ""}
                    onChange={(e) => setM(`${s.key.toLowerCase()}s`, e.target.value)}
                    placeholder="e.g., 4h, 1d, 1d4h"
                    className="w-40 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground -mt-4">
        Time format: number + unit. Units: <code>m</code> (minutes), <code>h</code> (hours), <code>d</code> (days). Combined: <code>1d4h30m</code>.
      </p>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Saving..." : mode === "create" ? "Create Policy" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
