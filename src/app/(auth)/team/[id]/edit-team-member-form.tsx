"use client";

import { useState } from "react";

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

  function toggleSite(siteId: string) {
    setSelectedSites((prev) =>
      prev.includes(siteId)
        ? prev.filter((id) => id !== siteId)
        : [...prev, siteId]
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/team/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          status,
          site_ids: selectedSites,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update team member");
      }

      setMessage({ type: "success", text: "Team member updated successfully" });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update team member",
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
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Site Assignment */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Site Access
          </label>
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sites available.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => toggleSite(site.id)}
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
