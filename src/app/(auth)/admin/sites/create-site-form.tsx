"use client";

import { useState, useEffect } from "react";
import type { ProjectStatus } from "@/types/ticket";
import { COMMON_TIMEZONES } from "@/lib/utils";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "pre_signoff", label: "Pre-Signoff" },
  { value: "in_warranty", label: "In Warranty" },
  { value: "full_coverage", label: "Full Coverage" },
  { value: "essential_coverage", label: "Essential Coverage" },
  { value: "out_of_service", label: "Out of Service" },
];

interface CustomerOption {
  id: string;
  name: string;
}

interface CreateSiteFormProps {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  defaultCustomerName?: string;
  compact?: boolean;
}

export function CreateSiteForm({
  customers,
  defaultCustomerId,
  defaultCustomerName,
  compact = false,
}: CreateSiteFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId || "");
  const [timezone, setTimezone] = useState("America/New_York");
  const [address, setAddress] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("pre_signoff");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (defaultCustomerId) {
      setCustomerId(defaultCustomerId);
    }
  }, [defaultCustomerId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_name: siteName,
          site_code: siteCode.toUpperCase(),
          customer_id: customerId,
          timezone,
          address: address || undefined,
          project_status: projectStatus,
          status: "active",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create site");
      }

      setMessage({ type: "success", text: `Site ${siteCode.toUpperCase()} created successfully` });
      setSiteName("");
      setSiteCode("");
      if (!defaultCustomerId) setCustomerId("");
      setTimezone("America/New_York");
      setAddress("");
      setProjectStatus("pre_signoff");

      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to create site",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={
          compact
            ? "text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            : "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        }
      >
        {compact ? "+ Add Site" : "+ Create New Site"}
      </button>
    );
  }

  return (
    <div className={compact ? "mt-3 rounded-lg border border-border p-4" : "mb-6 rounded-xl border border-border p-6"}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={compact ? "text-sm font-semibold text-foreground" : "text-base font-semibold text-foreground"}>
          {defaultCustomerName ? `Add Site to ${defaultCustomerName}` : "Create New Site"}
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
              Site Code *
            </label>
            <input
              type="text"
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value.toUpperCase())}
              required
              placeholder="e.g. ADI-INDY-001"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Unique identifier. Uppercase letters, numbers, and hyphens.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Site Name *
            </label>
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              required
              placeholder="e.g. Indianapolis Distribution Center"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Customer *
            </label>
            {defaultCustomerId ? (
              <div className="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
                {defaultCustomerName || customers.find((c) => c.id === defaultCustomerId)?.name || "Selected Customer"}
              </div>
            ) : (
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
              >
                <option value="">Select a customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Project Status
            </label>
            <select
              value={projectStatus}
              onChange={(e) => setProjectStatus(e.target.value as ProjectStatus)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Timezone *
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label} ({tz.value})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="1234 Industrial Blvd, Indianapolis, IN"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create Site"}
        </button>
      </form>
    </div>
  );
}
