"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProjectStatus } from "@/types/ticket";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types/ticket";
import { CreateSiteForm } from "../sites/create-site-form";

interface SiteRow {
  id: string;
  site_name: string;
  site_code: string;
  project_status: string;
  status: string;
}

interface CustomerRow {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  sites: SiteRow[] | null;
}

interface CustomerOption {
  id: string;
  name: string;
}

export function CustomersSitesCards({
  customers,
}: {
  customers: CustomerRow[];
}) {
  const router = useRouter();
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "customers" | "sites">(null);

  // Customer archive already decommissions its sites, so child sites do not
  // need to be selected separately.

  const customerOptions: CustomerOption[] = customers
    .filter((customer) => customer.status !== "inactive")
    .map((customer) => ({ id: customer.id, name: customer.name }));

  function toggleCustomer(id: string) {
    if (customers.find((customer) => customer.id === id)?.status === "inactive") return;
    setSelectedCustomers((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSite(id: string, customerId: string) {
    const site = customers
      .find((customer) => customer.id === customerId)
      ?.sites?.find((candidate) => candidate.id === id);
    if (!site || site.status === "decommissioned") return;

    setSelectedSites((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // If a site is selected, deselect its parent customer so one operation
    // does not archive the same lifecycle twice.
    setSelectedCustomers((cs) => {
      if (cs.has(customerId)) {
        const next = new Set(cs);
        next.delete(customerId);
        return next;
      }
      return cs;
    });
  }

  async function performCustomersArchive() {
    if (selectedCustomers.size === 0) return;
    setError(null);
    setConfirming(null);
    const res = await fetch("/api/admin/customers/bulk-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selectedCustomers) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Bulk archive failed");
      return;
    }
    setSelectedCustomers(new Set());
    setSelectedSites(new Set());
    if (data.failed && data.failed.length > 0) {
      setError(
        "Some customers could not be archived. Refresh and retry."
      );
    }
    startTransition(() => router.refresh());
  }

  async function performSitesArchive() {
    if (selectedSites.size === 0) return;
    setError(null);
    setConfirming(null);
    const res = await fetch("/api/admin/sites/bulk-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selectedSites) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Bulk archive failed");
      return;
    }
    setSelectedSites(new Set());
    if (data.failed && data.failed.length > 0) {
      setError(
        "Some sites could not be archived. Refresh and retry."
      );
    }
    startTransition(() => router.refresh());
  }

  const totalSelected = selectedCustomers.size + selectedSites.size;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2.5">
        <div className="text-xs text-muted-foreground">
          {totalSelected > 0 ? (
            <>
              {selectedCustomers.size > 0 && (
                <span className="mr-3">{selectedCustomers.size} customer{selectedCustomers.size === 1 ? "" : "s"}</span>
              )}
              {selectedSites.size > 0 && (
                <span>{selectedSites.size} site{selectedSites.size === 1 ? "" : "s"}</span>
              )}
              <span className="ml-1">selected</span>
            </>
          ) : (
            "Select rows below, or use the per-customer / per-site checkboxes"
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalSelected > 0 && (
            <button
              onClick={() => {
                setSelectedCustomers(new Set());
                setSelectedSites(new Set());
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              disabled={pending}
            >
              Clear
            </button>
          )}
          {selectedSites.size > 0 && (
            <button
              onClick={() => setConfirming("sites")}
              disabled={pending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40"
            >
              Archive {selectedSites.size} site{selectedSites.size === 1 ? "" : "s"}
            </button>
          )}
          {selectedCustomers.size > 0 && (
            <button
              onClick={() => setConfirming("customers")}
              disabled={pending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40"
            >
              Archive {selectedCustomers.size} customer{selectedCustomers.size === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {confirming === "customers" ? (
            <>
              <p className="font-semibold mb-1">Archive {selectedCustomers.size} customer{selectedCustomers.size === 1 ? "" : "s"}?</p>
              <p className="text-xs mb-3">
                The customers become inactive, their sites are decommissioned, and
                their customer accounts are deactivated. Tickets, service records,
                memberships, and audit history are preserved for internal review.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold mb-1">Archive {selectedSites.size} site{selectedSites.size === 1 ? "" : "s"}?</p>
              <p className="text-xs mb-3">
                The sites are decommissioned and removed from customer access.
                Tickets, memberships, parts, field-service records, and audit history
                remain intact.
              </p>
            </>
          )}
          <div className="flex gap-2">
            <button
              onClick={confirming === "customers" ? performCustomersArchive : performSitesArchive}
              disabled={pending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40"
            >
              {pending ? "Archiving…" : "Yes, archive"}
            </button>
            <button
              onClick={() => setConfirming(null)}
              disabled={pending}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {customers.length === 0 ? (
          <div className="rounded-xl border border-border p-12 text-center">
            <p className="text-sm text-muted-foreground">No customers yet. Create your first customer above.</p>
          </div>
        ) : (
          customers.map((customer) => {
            const isCustSelected = selectedCustomers.has(customer.id);
            return (
              <div
                key={customer.id}
                className={`rounded-xl border overflow-hidden transition-colors ${
                  isCustSelected ? "border-amber-300 bg-amber-50/30" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between p-4 bg-muted/30 border-b border-border">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${customer.name}`}
                      checked={isCustSelected}
                      disabled={customer.status === "inactive"}
                      onChange={() => toggleCustomer(customer.id)}
                      className="h-4 w-4 rounded border-border disabled:opacity-40"
                    />
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <span className="text-xs font-bold text-primary">
                        {customer.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                      >
                        {customer.name}
                      </Link>
                      {customer.domain && (
                        <span className="text-xs text-muted-foreground ml-2">{customer.domain}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        customer.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-700"
                      }`}
                    >
                      {customer.status}
                    </span>
                    <CreateSiteForm
                      customers={customerOptions}
                      defaultCustomerId={customer.id}
                      defaultCustomerName={customer.name}
                      compact
                    />
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      Details →
                    </Link>
                  </div>
                </div>

                <div className="p-4">
                  {customer.sites && customer.sites.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {customer.sites.map((site) => {
                        const statusColor =
                          PROJECT_STATUS_COLORS[site.project_status as ProjectStatus] ||
                          "bg-gray-100 text-gray-800";
                        const statusLabel =
                          PROJECT_STATUS_LABELS[site.project_status as ProjectStatus] ||
                          site.project_status;
                        const isSiteSelected = selectedSites.has(site.id);
                        const customerSelected = selectedCustomers.has(customer.id);
                        return (
                          <div
                            key={site.id}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                              isSiteSelected
                                ? "border-amber-300 bg-amber-50"
                                : customerSelected
                                  ? "border-border bg-muted/50 opacity-50"
                                  : "border-border hover:bg-muted/50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${site.site_name}`}
                              checked={isSiteSelected}
                              disabled={customerSelected || site.status === "decommissioned"}
                              onChange={() => toggleSite(site.id, customer.id)}
                              className="h-4 w-4 rounded border-border disabled:opacity-50"
                            />
                            <Link
                              href={`/admin/sites/${site.id}`}
                              className="flex-1 min-w-0"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {site.site_name}
                              </p>
                              <p className="text-xs font-mono text-muted-foreground truncate">
                                {site.site_code}
                              </p>
                            </Link>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
                            >
                              {statusLabel}
                            </span>
                            {site.status !== "active" && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                                {site.status}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No sites yet. Use the Add Site button above to add one.</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
