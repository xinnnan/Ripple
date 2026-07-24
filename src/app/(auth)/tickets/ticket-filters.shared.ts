// Pure helpers for the ticket filter UI — server-importable.
// (The `ticket-filters.tsx` file is a "use client" component; its
//  top-level exports get the client-only treatment, which makes it
//  impossible for server components to import them. The parsers
//  are pure functions so they live here and are imported by both
//  the page (server) and the client controls.)

import type { TicketStatus, Severity } from "@/types/ticket";

export type TicketFiltersState = {
  q?: string;
  status?: TicketStatus[];
  severity?: Severity[];
  customer_id?: string;
  site_id?: string;
  owner_id?: string;
  range?: "7d" | "30d" | "90d" | "all";
  /** SLA bucket. "all" / "breached" / "breaching" / "on_track" / "no_sla". */
  sla?: "all" | "breached" | "breaching" | "on_track" | "no_sla";
  page?: number;
};

export type TicketFilterOptions = {
  customers: { id: string; name: string }[];
  sites: { id: string; site_name: string; site_code: string; customer_id: string }[];
  owners: { id: string; full_name: string }[];
  canFilterByCustomer: boolean;
  canFilterByOwner: boolean;
};

export const PAGE_SIZE = 20;

export function parseFilters(params: URLSearchParams): TicketFiltersState {
  const get = (k: string) => params.get(k) ?? undefined;
  const list = (k: string) =>
    (params.get(k) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const range = get("range") as TicketFiltersState["range"];
  const slaRaw = get("sla") as TicketFiltersState["sla"];
  const page = parseInt(get("page") || "1", 10);
  return {
    q: get("q"),
    status: list("status") as TicketStatus[],
    severity: list("severity") as Severity[],
    customer_id: get("customer"),
    site_id: get("site"),
    owner_id: get("owner"),
    range: range && ["7d", "30d", "90d", "all"].includes(range) ? range : undefined,
    sla: slaRaw && ["all", "breached", "breaching", "on_track", "no_sla"].includes(slaRaw) ? slaRaw : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function buildParams(filters: TicketFiltersState): string {
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
  if (filters.sla) p.set("sla", filters.sla);
  if (filters.page && filters.page > 1) p.set("page", String(filters.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
