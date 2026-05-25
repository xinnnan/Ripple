"use client";

import { useState } from "react";

interface SiteOption {
  id: string;
  site_name: string;
  site_code: string;
}

export function CreateTeamMemberForm({ sites }: { sites: SiteOption[] }) {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
          site_ids: selectedSites.length > 0 ? selectedSites : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create team member");
      }

      setMessage({ type: "success", text: `Team member ${email} created successfully` });
      setEmail("");
      setPassword("");
      setFullName("");
      setPhone("");
      setSelectedSites([]);
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to create team member",
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
          + Add Team Member
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">
          Add Team Member
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
        <div className="grid grid-cols-2 gap-4">
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

        {/* Site Assignment */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Assign Sites
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
          {saving ? "Creating..." : "Add Team Member"}
        </button>
      </form>
    </div>
  );
}
