"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { STATUS_LABELS, type TicketStatus, type Severity } from "@/types/ticket";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export type TicketFiltersState = {
  q?: string;
  status?: TicketStatus[];
  severity?: Severity[];
  customer_id?: string;
  site_id?: string;
  owner_id?: string;
  range?: "7d" | "30d" | "90d" | "all";
  page?: number;
};

export type TicketFilterOptions = {
  customers: { id: string; name: string }[];
  sites: { id: string; site_name: string; site_code: string; customer_id: string }[];
  owners: { id: string; full_name: string }[];
  canFilterByCustomer: boolean;
  canFilterByOwner: boolean;
};

function parseFilters(params: URLSearchParams): TicketFiltersState {
  const get = (k: string) => params.get(k) ?? undefined;
  const list = (k: string) =>
    (params.get(k) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const range = get("range") as TicketFiltersState["range"];
  const page = parseInt(get("page") || "1", 10);
  return {
    q: get("q"),
    status: list("status") as TicketStatus[],
    severity: list("severity") as Severity[],
    customer_id: get("customer"),
    site_id: get("site"),
    owner_id: get("owner"),
    range: range && ["7d", "30d", "90d", "all"].includes(range) ? range : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function buildParams(filters: TicketFiltersState): string {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.status && filters.status.length > 0)
    p.set("status", filters.status.join(","));
  if (filters.severity && filters.severity.length > 0)
    p.set("severity", filters.severity.join(","));
  if (filters.customer_id) p.set("customer", filters.customer_id);
  if (filters.site_id) p.set("site", filters.site_id);
  if (filters.owner_id) p.set("owner", filters.owner_id);
  if (filters.range) p.set("range", filters.range);
  if (filters.page && filters.page > 1) p.set("page", String(filters.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const QUICK_STATUSES: TicketStatus[] = [
  "new",
  "in_progress",
  "waiting_customer",
  "resolved",
];

export function TicketFilters({
  filters,
  options,
  totalCount,
  onChange,
}: {
  filters: TicketFiltersState;
  options: TicketFilterOptions;
  totalCount: number;
  onChange: (next: TicketFiltersState) => void;
}) {
  const [searchInput, setSearchInput] = useState(filters.q || "");
  const [, startTransition] = useTransition();

  const update = useCallback(
    (patch: Partial<TicketFiltersState>) => {
      onChange({ ...filters, ...patch, page: 1 }); // any filter change resets to page 1
    },
    [filters, onChange]
  );

  const toggleStatus = (s: TicketStatus) => {
    const current = filters.status || [];
    const next = current.includes(s)
      ? current.filter((x) => x !== s)
      : [...current, s];
    update({ status: next.length > 0 ? next : undefined });
  };

  const toggleSeverity = (s: Severity) => {
    const current = filters.severity || [];
    const next = current.includes(s)
      ? current.filter((x) => x !== s)
      : [...current, s];
    update({ severity: next.length > 0 ? next : undefined });
  };

  // Sites filtered by the selected customer
  const visibleSites = useMemo(() => {
    if (!filters.customer_id) return options.sites;
    return options.sites.filter((s) => s.customer_id === filters.customer_id);
  }, [options.sites, filters.customer_id]);

  const hasActiveFilters =
    !!filters.q ||
    (filters.status && filters.status.length > 0) ||
    (filters.severity && filters.severity.length > 0) ||
    !!filters.customer_id ||
    !!filters.site_id ||
    !!filters.owner_id ||
    (filters.range && filters.range !== "all");

  const start = (filters.page || 1) * PAGE_SIZE - PAGE_SIZE + 1;
  const end = Math.min((filters.page || 1) * PAGE_SIZE, totalCount);

  return (
    <div className="space-y-3 mb-6">
      {/* Quick status pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground mr-1">
          Quick:
        </span>
        <button
          onClick={() => update({ status: undefined })}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            !filters.status || filters.status.length === 0
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:bg-accent"
          )}
        >
          All
        </button>
        {QUICK_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              filters.status?.includes(s)
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Detailed filters */}
      <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-end gap-3">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") update({ q: searchInput.trim() || undefined });
            }}
            placeholder="Ticket no. or title…"
            className="w-full rounded-lg border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Severity */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Severity
          </label>
          <div className="flex gap-1">
            {(["P1", "P2", "P3", "P4"] as Severity[]).map((s) => (
              <button
                key={s}
                onClick={() => toggleSeverity(s)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  filters.severity?.includes(s)
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Customer — internal only */}
        {options.canFilterByCustomer && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Customer
            </label>
            <select
              value={filters.customer_id || ""}
              onChange={(e) =>
                update({
                  customer_id: e.target.value || undefined,
                  site_id: undefined, // site filter is reset when customer changes
                })
              }
              className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All customers</option>
              {options.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Site — customer manager can filter their own, customer sees only their sites */}
        {options.sites.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Site
            </label>
            <select
              value={filters.site_id || ""}
              onChange={(e) =>
                update({ site_id: e.target.value || undefined })
              }
              className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All sites</option>
              {visibleSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.site_name} ({s.site_code})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Owner — internal only */}
        {options.canFilterByOwner && options.owners.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Owner
            </label>
            <select
              value={filters.owner_id || ""}
              onChange={(e) =>
                update({ owner_id: e.target.value || undefined })
              }
              className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All owners</option>
              {options.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Date range */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Created
          </label>
          <select
            value={filters.range || "all"}
            onChange={(e) => {
              const v = e.target.value as TicketFiltersState["range"];
              update({ range: v === "all" ? undefined : v });
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="all">All time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>

        {/* Clear */}
        {hasActiveFilters && (
          <button
            onClick={() => {
              setSearchInput("");
              startTransition(() => {
                onChange({ page: 1 });
              });
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Result count */}
      <p className="text-xs text-muted-foreground">
        {totalCount === 0
          ? "No results"
          : `Showing ${start}–${end} of ${totalCount} ticket${
              totalCount === 1 ? "" : "s"
            }`}
      </p>
    </div>
  );
}

export { PAGE_SIZE, parseFilters, buildParams };
