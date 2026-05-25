"use client";

import { useState, useEffect } from "react";
import {
  REQUEST_TYPE_LABELS,
  SEVERITY_LABELS,
  IMPACT_LABELS,
  type RequestType,
  type Severity,
  type Impact,
  type UserRole,
} from "@/types/ticket";
import { INTERNAL_ROLES, isCustomerManager } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import { isInternalEmail } from "@/lib/utils";

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (open) loadSites();
  }, [open]);

  async function loadSites() {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if user is internal or customer_manager
      const { data: profile } = await supabase
        .from("users")
        .select("role, email, customer_id")
        .eq("id", user.id)
        .single();

      const role = profile?.role as UserRole | undefined;
      const email = profile?.email as string | undefined;
      const customerId = (profile as Record<string, unknown> | null)?.customer_id as string | null;
      const isInternal = role
        ? INTERNAL_ROLES.includes(role)
        : email ? isInternalEmail(email) : false;
      const isManager = role ? isCustomerManager(role) : false;

      if (isInternal) {
        // Internal users see ALL sites
        const { data: allSites } = await supabase
          .from("sites")
          .select("id, site_code, site_name, customer:customers(name)")
          .eq("status", "active")
          .order("site_name");

        if (allSites) {
          const sites = allSites.map((s) => {
            const customerData = Array.isArray(s.customer) ? s.customer[0] : s.customer;
            return {
              site_id: s.id,
              site_code: s.site_code,
              site_name: s.site_name,
              customer_name: (customerData as unknown as { name: string })?.name || "",
            };
          });
          setUserSites(sites);
        }
      } else if (isManager && customerId) {
        // Customer managers see all sites under their customer
        const { data: allSites } = await supabase
          .from("sites")
          .select("id, site_code, site_name, customer:customers(name)")
          .eq("customer_id", customerId)
          .eq("status", "active")
          .order("site_name");

        if (allSites) {
          const sites = allSites.map((s) => {
            const customerData = Array.isArray(s.customer) ? s.customer[0] : s.customer;
            return {
              site_id: s.id,
              site_code: s.site_code,
              site_name: s.site_name,
              customer_name: (customerData as unknown as { name: string })?.name || "",
            };
          });
          setUserSites(sites);
        }
      } else {
        // Regular customer users see only their assigned sites
        const { data: memberships } = await supabase
          .from("site_members")
          .select("site_id, sites(id, site_code, site_name, customer:customers(name))")
          .eq("user_id", user.id);

        if (memberships) {
          const sites = memberships.map((m) => {
            const s = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as unknown as {
              id: string; site_code: string; site_name: string;
              customer: { name: string }[] | null;
            };
            const customerData = Array.isArray(s.customer) ? s.customer[0] : s.customer;
            return {
              site_id: s.id,
              site_code: s.site_code,
              site_name: s.site_name,
              customer_name: customerData?.name || "",
            };
          });
          setUserSites(sites);
        }
      }
    } catch {
      // Not logged in
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
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

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
          source: "web",
          created_by: user?.id || undefined,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Submit New Ticket</h2>
          <button
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
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Site Selection */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Site *
              </label>
              <select
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
                required
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select a site...</option>
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
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Issue Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. AMR-03 not completing delivery mission"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {/* Type / Severity / Impact */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Type *</label>
                <select
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
                <label className="block text-sm font-medium text-foreground mb-1">Severity *</label>
                <select
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
                <label className="block text-sm font-medium text-foreground mb-1">Impact *</label>
                <select
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Equipment / Asset</label>
                <input
                  type="text"
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  placeholder="e.g. AMR-03"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Area / Process</label>
                <input
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
              <label className="block text-sm font-medium text-foreground mb-1">
                Description *
              </label>
              <textarea
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
                disabled={submitting}
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
