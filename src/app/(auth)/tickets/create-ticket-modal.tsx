"use client";

import { useState, useEffect } from "react";
import {
  REQUEST_TYPE_LABELS,
  SEVERITY_LABELS,
  IMPACT_LABELS,
  type RequestType,
  type Severity,
  type Impact,
} from "@/types/ticket";
import { getCurrentSites } from "@/lib/supabase/scope.client";

interface UserSite {
  site_id: string;
  site_code: string;
  site_name: string;
  customer_name: string;
}

interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function CreateTicketModal({ open, onClose, onCreated }: CreateTicketModalProps) {
  const [userSites, setUserSites] = useState<UserSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [title, setTitle] = useState("");
  const [requestType, setRequestType] = useState<RequestType | "">("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [impact, setImpact] = useState<Impact | "">("");
  const [assetId, setAssetId] = useState("");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [siteLoadError, setSiteLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (open) void loadSites();
  }, [open]);

  async function loadSites() {
    setLoadingSites(true);
    setSiteLoadError(null);
    setSelectedSiteId("");
    setUserSites([]);
    try {
      const sites = await getCurrentSites();
      setUserSites(
        sites.map((s) => ({
          site_id: s.id,
          site_code: s.site_code,
          site_name: s.site_name,
          customer_name: s.customer_name,
        }))
      );
    } catch {
      setSiteLoadError(
        "Site options are temporarily unavailable. Please retry."
      );
    } finally {
      setLoadingSites(false);
    }
  }

  function resetForm() {
    setSelectedSiteId("");
    setTitle("");
    setRequestType("");
    setSeverity("");
    setImpact("");
    setAssetId("");
    setArea("");
    setDescription("");
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const site = userSites.find((s) => s.site_id === selectedSiteId);
    if (!site) {
      setError("Please select a site");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_code: site.site_code,
          title,
          request_type: requestType,
          severity,
          impact: impact || undefined,
          asset_id: assetId || undefined,
          area: area || undefined,
          description,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create ticket");
      }

      setSuccess(data.ticket_no);
      if (onCreated) onCreated();
      setTimeout(() => {
        resetForm();
        onClose();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const selectedSite = userSites.find((s) => s.site_id === selectedSiteId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ticket-title"
        className="bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 id="create-ticket-title" className="text-lg font-semibold text-foreground">Submit New Ticket</h2>
          <button
            type="button"
            aria-label="Close ticket form"
            onClick={() => { resetForm(); onClose(); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-green-50 flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-base font-semibold text-foreground mb-1">Ticket Created!</p>
            <p className="text-sm text-muted-foreground font-mono">{success}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {siteLoadError && (
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p>{siteLoadError}</p>
                <button
                  type="button"
                  onClick={() => void loadSites()}
                  className="mt-2 font-semibold text-primary hover:text-primary/80"
                >
                  Retry site loading
                </button>
              </div>
            )}

            {/* Site Selection */}
            <div>
              <label htmlFor="ticket-site" className="block text-sm font-medium text-foreground mb-1">
                Site *
              </label>
              <select
                id="ticket-site"
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
                disabled={loadingSites || Boolean(siteLoadError) || userSites.length === 0}
                required
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">
                  {loadingSites
                    ? "Loading sites..."
                    : userSites.length === 0
                      ? "No active sites available"
                      : "Select a site..."}
                </option>
                {userSites.map((site) => (
                  <option key={site.site_id} value={site.site_id}>
                    {site.site_name} ({site.site_code}){site.customer_name ? ` — ${site.customer_name}` : ""}
                  </option>
                ))}
              </select>
              {selectedSite && (
                <p className="text-xs text-muted-foreground mt-1">
                  Customer: {selectedSite.customer_name} | Site: {selectedSite.site_code}
                </p>
              )}
              {!loadingSites && !siteLoadError && userSites.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  No active sites are assigned to your account. Contact your
                  customer administrator or DropletAI support.
                </p>
              )}
            </div>

            {/* Title */}
            <div>
              <label htmlFor="ticket-title" className="block text-sm font-medium text-foreground mb-1">
                Issue Title *
              </label>
              <input
                id="ticket-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. AMR-03 not completing delivery mission"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {/* Type / Severity / Impact */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="ticket-type" className="block text-sm font-medium text-foreground mb-1">Type *</label>
                <select
                  id="ticket-type"
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value as RequestType)}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                >
                  <option value="">Select...</option>
                  {Object.entries(REQUEST_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ticket-severity" className="block text-sm font-medium text-foreground mb-1">Severity *</label>
                <select
                  id="ticket-severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as Severity)}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                >
                  <option value="">Select...</option>
                  {Object.entries(SEVERITY_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ticket-impact" className="block text-sm font-medium text-foreground mb-1">Impact *</label>
                <select
                  id="ticket-impact"
                  value={impact}
                  onChange={(e) => setImpact(e.target.value as Impact)}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                >
                  <option value="">Select...</option>
                  {Object.entries(IMPACT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Asset / Area */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ticket-asset" className="block text-sm font-medium text-foreground mb-1">Equipment / Asset</label>
                <input
                  id="ticket-asset"
                  type="text"
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  placeholder="e.g. AMR-03"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label htmlFor="ticket-area" className="block text-sm font-medium text-foreground mb-1">Area / Process</label>
                <input
                  id="ticket-area"
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Picking Zone A"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label htmlFor="ticket-description" className="block text-sm font-medium text-foreground mb-1">
                Description *
              </label>
              <textarea
                id="ticket-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={4}
                placeholder="Describe the issue in detail..."
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { resetForm(); onClose(); }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  loadingSites ||
                  Boolean(siteLoadError) ||
                  userSites.length === 0
                }
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit Ticket"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
