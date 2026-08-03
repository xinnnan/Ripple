"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProjectStatus } from "@/types/ticket";
import { COMMON_TIMEZONES } from "@/lib/utils";
import {
  isValidSiteCode,
  normalizeSiteCode,
  SITE_CODE_MAX_LENGTH,
} from "@/lib/sites/site-code";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";

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
  const router = useRouter();
  const idPrefix = useId();
  const [refreshing, startRefresh] = useTransition();
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
  const busy = saving || refreshing;
  const hasCustomer = Boolean(defaultCustomerId || customers.length > 0);
  const selectedCustomerName =
    defaultCustomerName ||
    customers.find((customer) => customer.id === defaultCustomerId)?.name ||
    "Selected Customer";

  useEffect(() => {
    if (defaultCustomerId) {
      setCustomerId(defaultCustomerId);
    }
  }, [defaultCustomerId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const normalizedSiteName = siteName.trim();
    const normalizedSiteCode = normalizeSiteCode(siteCode);
    const normalizedTimezone = timezone.trim();
    const normalizedAddress = address.trim();
    if (!hasCustomer || !customerId) {
      setMessage({
        type: "error",
        text: "An active customer is required before creating a site",
      });
      return;
    }
    if (!normalizedSiteName) {
      setMessage({ type: "error", text: "Site name is required" });
      return;
    }
    if (!isValidSiteCode(normalizedSiteCode)) {
      setMessage({
        type: "error",
        text: "Site code must start with a letter or number and contain only letters, numbers, or hyphens",
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_name: normalizedSiteName,
          site_code: normalizedSiteCode,
          customer_id: customerId,
          timezone: normalizedTimezone,
          address: normalizedAddress || undefined,
          project_status: projectStatus,
          status: "active",
        }),
      });

      await assertClientMutationResponse(res, "Failed to create site");

      setMessage({
        type: "success",
        text: `Site ${normalizedSiteCode} created successfully`,
      });
      setSiteName("");
      setSiteCode("");
      if (!defaultCustomerId) setCustomerId("");
      setTimezone("America/New_York");
      setAddress("");
      setProjectStatus("pre_signoff");
      startRefresh(() => router.refresh());
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Site creation is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={!hasCustomer}
          className={
            compact
              ? "text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              : "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {compact ? "+ Add Site" : "+ Create New Site"}
        </button>
        {!hasCustomer && (
          <p role="status" className="mt-2 text-sm text-amber-800">
            Create an active customer before adding a site.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? "mt-3 rounded-lg border border-border p-4" : "mb-6 rounded-xl border border-border p-6"}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={compact ? "text-sm font-semibold text-foreground" : "text-base font-semibold text-foreground"}>
          {defaultCustomerName ? `Add Site to ${defaultCustomerName}` : "Create New Site"}
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <form aria-busy={busy} onSubmit={handleCreate} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor={`${idPrefix}-site-code`}
              className="block text-sm font-medium text-foreground mb-1"
            >
              Site Code *
            </label>
            <input
              id={`${idPrefix}-site-code`}
              type="text"
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value.toUpperCase())}
              required
              maxLength={SITE_CODE_MAX_LENGTH}
              pattern="[A-Za-z0-9][A-Za-z0-9-]*"
              title="Start with a letter or number and use only letters, numbers, or hyphens"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
              placeholder="e.g. ADI-INDY-001"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Unique identifier. Uppercase letters, numbers, and hyphens.
            </p>
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-site-name`}
              className="block text-sm font-medium text-foreground mb-1"
            >
              Site Name *
            </label>
            <input
              id={`${idPrefix}-site-name`}
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              required
              maxLength={200}
              disabled={busy}
              placeholder="e.g. Indianapolis Distribution Center"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p
              id={`${idPrefix}-customer-label`}
              className="block text-sm font-medium text-foreground mb-1"
            >
              Customer *
            </p>
            {defaultCustomerId ? (
              <div
                aria-labelledby={`${idPrefix}-customer-label`}
                className="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground"
              >
                {selectedCustomerName}
              </div>
            ) : (
              <select
                id={`${idPrefix}-customer`}
                aria-labelledby={`${idPrefix}-customer-label`}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                disabled={busy || !hasCustomer}
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
            <label
              htmlFor={`${idPrefix}-project-status`}
              className="block text-sm font-medium text-foreground mb-1"
            >
              Project Status
            </label>
            <select
              id={`${idPrefix}-project-status`}
              value={projectStatus}
              onChange={(e) => setProjectStatus(e.target.value as ProjectStatus)}
              disabled={busy}
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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor={`${idPrefix}-timezone`}
              className="block text-sm font-medium text-foreground mb-1"
            >
              Timezone *
            </label>
            <select
              id={`${idPrefix}-timezone`}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
              disabled={busy}
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
            <label
              htmlFor={`${idPrefix}-address`}
              className="block text-sm font-medium text-foreground mb-1"
            >
              Address
            </label>
            <input
              id={`${idPrefix}-address`}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
              disabled={busy}
              placeholder="1234 Industrial Blvd, Indianapolis, IN"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={busy || !hasCustomer}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create Site"}
        </button>
      </form>
    </div>
  );
}
