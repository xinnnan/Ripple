"use client";

import { useState } from "react";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";

interface SiteOption {
  id: string;
  site_name: string;
  site_code: string;
}

interface UserData {
  id: string;
  full_name: string;
  status: string;
}

export function EditTeamMemberForm({
  user,
  sites,
  currentSiteIds,
}: {
  user: UserData;
  sites: SiteOption[];
  currentSiteIds: string[];
}) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [status, setStatus] = useState(user.status);
  const [selectedSites, setSelectedSites] = useState<string[]>(currentSiteIds);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const isInactive = user.status === "inactive";

  function toggleSite(siteId: string) {
    setSelectedSites((prev) =>
      prev.includes(siteId)
        ? prev.filter((id) => id !== siteId)
        : [...prev, siteId]
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving || isInactive) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/team/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          status,
          site_ids: selectedSites,
        }),
      });

      await assertClientMutationResponse(res, "Failed to update team member");

      setMessage({ type: "success", text: "Team member updated successfully" });
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Team-member update is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="text-base font-semibold text-foreground mb-4">
        Edit Details
      </h2>

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

      {isInactive && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This account is inactive and read-only. Reactivation requires a
          reviewed administrator workflow.
        </div>
      )}

      <form aria-busy={saving} onSubmit={handleSave} className="space-y-4">
        <div>
          <label
            htmlFor="team-member-full-name"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Full Name
          </label>
          <input
            id="team-member-full-name"
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
            htmlFor="team-member-status"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Status
          </label>
          <select
            id="team-member-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={saving || isInactive}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Site Assignment */}
        <fieldset disabled={saving || isInactive}>
          <legend className="block text-sm font-medium text-foreground mb-2">
            Site Access
          </legend>
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sites available.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => toggleSite(site.id)}
                  aria-pressed={selectedSites.includes(site.id)}
                  disabled={saving || isInactive}
                  className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedSites.includes(site.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {site.site_name}
                </button>
              ))}
            </div>
          )}
        </fieldset>

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
