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
  allowDefault: boolean;
}

const SEVERITIES = [
  { key: "P1", color: "text-red-600" },
  { key: "P2", color: "text-orange-600" },
  { key: "P3", color: "text-blue-600" },
  { key: "P4", color: "text-gray-600" },
] as const;

function minutesToHuman(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) {
    const hours = Math.floor(min / 60);
    const minutes = min % 60;
    return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
  }
  const days = Math.floor(min / (60 * 24));
  const hours = Math.floor((min % (60 * 24)) / 60);
  return hours === 0 ? `${days}d` : `${days}d${hours}h`;
}

function humanToMinutes(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return 0;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (!/^(?:\d+d)?(?:\d+h)?(?:\d+m)?$/.test(trimmed)) return null;

  const days = Number.parseInt(trimmed.match(/(\d+)d/)?.[1] ?? "0", 10);
  const hours = Number.parseInt(trimmed.match(/(\d+)h/)?.[1] ?? "0", 10);
  const minutes = Number.parseInt(trimmed.match(/(\d+)m/)?.[1] ?? "0", 10);
  return days * 24 * 60 + hours * 60 + minutes;
}

export function SLAPolicyForm({
  mode,
  policyId,
  initial,
  customers,
  allowDefault,
}: SLAPolicyFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [minutes, setMinutes] = useState<Record<string, string>>(() => {
    if (initial) {
      return {
        p1r: minutesToHuman(initial.p1_response_minutes),
        p1s: minutesToHuman(initial.p1_resolution_minutes),
        p2r: minutesToHuman(initial.p2_response_minutes),
        p2s: minutesToHuman(initial.p2_resolution_minutes),
        p3r: minutesToHuman(initial.p3_response_minutes),
        p3s: minutesToHuman(initial.p3_resolution_minutes),
        p4r: minutesToHuman(initial.p4_response_minutes),
        p4s: minutesToHuman(initial.p4_resolution_minutes),
      };
    }

    return {
      p1r: "15m",
      p1s: "4h",
      p2r: "1h",
      p2s: "8h",
      p3r: "4h",
      p3s: "1d",
      p4r: "1d",
      p4s: "3d",
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scopeUnavailable =
    mode === "create" && !allowDefault && customers.length === 0;

  function setMinute(key: string, value: string) {
    setMinutes((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "create" && !allowDefault && !customerId) {
      setError("Select a customer for this SLA policy.");
      setLoading(false);
      return;
    }

    const parsedMinutes: Record<string, number> = {};
    for (const key of [
      "p1r",
      "p1s",
      "p2r",
      "p2s",
      "p3r",
      "p3s",
      "p4r",
      "p4s",
    ]) {
      const parsed = humanToMinutes(minutes[key] ?? "");
      if (parsed === null) {
        setError(
          `Invalid time format for ${key}. Use formats such as 15m, 1h30m, or 2d4h.`
        );
        setLoading(false);
        return;
      }
      if (parsed > 525_600) {
        setError(`Each target must be one year or less. Check ${key}.`);
        setLoading(false);
        return;
      }
      parsedMinutes[key] = parsed;
    }

    for (const severity of ["p1", "p2", "p3", "p4"]) {
      if (parsedMinutes[`${severity}r`] > parsedMinutes[`${severity}s`]) {
        setError(
          `${severity.toUpperCase()} response time cannot exceed its resolution time.`
        );
        setLoading(false);
        return;
      }
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      p1_response_minutes: parsedMinutes.p1r,
      p1_resolution_minutes: parsedMinutes.p1s,
      p2_response_minutes: parsedMinutes.p2r,
      p2_resolution_minutes: parsedMinutes.p2s,
      p3_response_minutes: parsedMinutes.p3r,
      p3_resolution_minutes: parsedMinutes.p3s,
      p4_response_minutes: parsedMinutes.p4r,
      p4_resolution_minutes: parsedMinutes.p4s,
    };
    if (mode === "create") body.customer_id = customerId || null;

    const url =
      mode === "create"
        ? "/api/admin/sla-policies"
        : `/api/admin/sla-policies/${policyId}`;

    try {
      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        throw new Error(responseBody.error || "Failed to save policy");
      }
      router.push("/admin/sla-policies");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save policy"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="sla-policy-name"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Name *
          </label>
          <input
            id="sla-policy-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={200}
            placeholder="e.g., Acme Premium SLA"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div>
          <label
            htmlFor="sla-policy-customer"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Scope{mode === "create" && !allowDefault ? " *" : ""}
          </label>
          <select
            id="sla-policy-customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            disabled={mode === "edit"}
            required={mode === "create" && !allowDefault}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          >
            {allowDefault ? (
              <option value="">
                Default — customers without an override
              </option>
            ) : (
              <option value="" disabled>
                Select an available customer
              </option>
            )}
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          {mode === "edit" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Policy scope is immutable. Create a new policy for another
              customer.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-sm font-medium text-foreground">
          {customerId
            ? "Customer-specific policy"
            : allowDefault
              ? "Default policy"
              : "Customer scope required"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {customerId
            ? "This override takes precedence over the default for the selected customer's new tickets."
            : allowDefault
              ? "This fallback applies only when a customer has no dedicated policy."
              : scopeUnavailable
                ? "Every active or trial customer already has an SLA policy."
                : "Choose the customer that should receive this override."}
        </p>
      </div>

      <fieldset className="overflow-hidden rounded-lg border border-border">
        <legend className="sr-only">Response and resolution targets</legend>
        <div className="hidden grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Severity</span>
          <span>Response time</span>
          <span>Resolution time</span>
        </div>

        {SEVERITIES.map((severity) => {
          const key = severity.key.toLowerCase();
          const responseId = `sla-${key}-response`;
          const resolutionId = `sla-${key}-resolution`;
          return (
            <div
              key={severity.key}
              className="grid grid-cols-1 gap-3 border-b border-border p-3 last:border-0 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-end"
            >
              <span className={`text-sm font-bold ${severity.color}`}>
                {severity.key}
              </span>
              <div className="min-w-0">
                <label
                  htmlFor={responseId}
                  className="mb-1 block text-xs font-medium text-muted-foreground sm:sr-only"
                >
                  {severity.key} response time
                </label>
                <input
                  id={responseId}
                  type="text"
                  value={minutes[`${key}r`] ?? ""}
                  onChange={(event) =>
                    setMinute(`${key}r`, event.target.value)
                  }
                  placeholder="e.g., 15m or 1h30m"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="min-w-0">
                <label
                  htmlFor={resolutionId}
                  className="mb-1 block text-xs font-medium text-muted-foreground sm:sr-only"
                >
                  {severity.key} resolution time
                </label>
                <input
                  id={resolutionId}
                  type="text"
                  value={minutes[`${key}s`] ?? ""}
                  onChange={(event) =>
                    setMinute(`${key}s`, event.target.value)
                  }
                  placeholder="e.g., 4h or 1d4h"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          );
        })}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Use minutes, hours, or days—for example <code>15m</code>,{" "}
        <code>1h30m</code>, or <code>2d4h</code>. Response must not exceed
        resolution for the same severity.
      </p>

      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
        <button
          type="submit"
          disabled={loading || scopeUnavailable}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading
            ? "Saving..."
            : mode === "create"
              ? "Create Policy"
              : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
