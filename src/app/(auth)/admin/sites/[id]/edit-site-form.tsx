"use client";

import { useState, useTransition } from "react";
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

interface SiteData {
  id: string;
  site_name: string;
  site_code: string;
  timezone: string;
  address: string | null;
  slack_channel_id: string | null;
  default_owner_id: string | null;
  status: string;
  project_status: ProjectStatus;
  customer: unknown;
}

export function EditSiteForm({
  site,
  customerName,
}: {
  site: SiteData;
  customerName: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const isArchived =
    site.status !== "active" && site.status !== "commissioning";
  const [siteName, setSiteName] = useState(site.site_name);
  const [siteCode, setSiteCode] = useState(site.site_code);
  const [timezone, setTimezone] = useState(site.timezone);
  const [address, setAddress] = useState(site.address || "");
  const [projectStatus, setProjectStatus] = useState(site.project_status);
  const [status, setStatus] = useState(site.status);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const busy = saving || refreshing;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (busy || isArchived) return;

    const normalizedSiteName = siteName.trim();
    const normalizedSiteCode = normalizeSiteCode(siteCode);
    const normalizedTimezone = timezone.trim();
    const normalizedAddress = address.trim();
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
      const res = await fetch(`/api/admin/sites/${site.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_name: normalizedSiteName,
          site_code: normalizedSiteCode,
          timezone: normalizedTimezone,
          address: normalizedAddress || null,
          project_status: projectStatus,
          ...(status !== site.status ? { status } : {}),
        }),
      });

      await assertClientMutationResponse(res, "Failed to update site");

      setSiteName(normalizedSiteName);
      setSiteCode(normalizedSiteCode);
      setTimezone(normalizedTimezone);
      setAddress(normalizedAddress);
      setMessage({ type: "success", text: "Site updated successfully" });
      startRefresh(() => router.refresh());
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Site update is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="text-base font-semibold text-foreground mb-4">
        Site Details
      </h2>

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

      <form
        aria-busy={busy}
        aria-describedby="site-edit-lifecycle-guidance"
        onSubmit={handleSave}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="site-edit-name"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Site Name
            </label>
            <input
              id="site-edit-name"
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              required
              maxLength={200}
              disabled={busy || isArchived}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label
              htmlFor="site-edit-code"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Site Code
            </label>
            <input
              id="site-edit-code"
              type="text"
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value.toUpperCase())}
              required
              maxLength={SITE_CODE_MAX_LENGTH}
              pattern="[A-Za-z0-9][A-Za-z0-9-]*"
              title="Start with a letter or number and use only letters, numbers, or hyphens"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy || isArchived}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>

        <div>
          <p className="block text-sm font-medium text-foreground mb-1">
            Customer
          </p>
          <div className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
            {customerName}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Customer ownership is fixed after site creation to preserve tenant
            isolation and historical records.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="site-edit-project-status"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Project Status
            </label>
            <select
              id="site-edit-project-status"
              value={projectStatus}
              onChange={(e) =>
                setProjectStatus(e.target.value as ProjectStatus)
              }
              disabled={busy || isArchived}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="site-edit-status"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Site Status
            </label>
            <select
              id="site-edit-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={busy || isArchived}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
            >
              <option value="active">Active</option>
              <option value="commissioning">Commissioning</option>
              {site.status !== "active" && site.status !== "commissioning" && (
                <option value={site.status} disabled>
                  {site.status} (archived)
                </option>
              )}
            </select>
            <p
              id="site-edit-lifecycle-guidance"
              className="mt-1 text-xs text-muted-foreground"
            >
              {isArchived
                ? "Archived sites are read-only. Service history and tenant boundaries remain preserved."
                : "Archive sites from Customers & Sites to preserve service history."}
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="site-edit-timezone"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Timezone *
          </label>
          <select
            id="site-edit-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            required
            disabled={busy || isArchived}
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
            htmlFor="site-edit-address"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Address
          </label>
          <textarea
            id="site-edit-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={busy || isArchived}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        <button
          type="submit"
          disabled={busy || isArchived}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
