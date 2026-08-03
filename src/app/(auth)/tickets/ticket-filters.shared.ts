// Pure helpers for the ticket filter UI — server-importable.
// (The `ticket-filters.tsx` file is a "use client" component; its
//  top-level exports get the client-only treatment, which makes it
//  impossible for server components to import them. The parsers
//  are pure functions so they live here and are imported by both
//  the page (server) and the client controls.)

import { TICKET_STATUSES, type TicketStatus, type Severity } from "@/types/ticket";
import { parseTicketSearch } from "@/lib/tickets/search-filter";

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
export const MAX_TICKET_LIST_PAGE = 100_000;

const SEVERITIES = ["P1", "P2", "P3", "P4"] as const;
const RANGES = ["7d", "30d", "90d", "all"] as const;
const SLA_BUCKETS = [
  "all",
  "breached",
  "breaching",
  "on_track",
  "no_sla",
] as const;
const FILTER_KEYS = new Set([
  "q",
  "status",
  "severity",
  "customer",
  "site",
  "owner",
  "range",
  "sla",
  "page",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function singleParam(params: URLSearchParams, key: string) {
  const values = params.getAll(key);
  if (values.length > 1) return { valid: false as const };
  const value = values[0]?.trim();
  return { valid: true as const, value: value || undefined };
}

function listParam(params: URLSearchParams, key: string) {
  return params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export type TicketFilterParseResult = {
  filters: TicketFiltersState;
  isValid: boolean;
};

export function parseTicketListFilters(
  params: URLSearchParams
): TicketFilterParseResult {
  let isValid = true;
  for (const key of params.keys()) {
    if (!FILTER_KEYS.has(key)) isValid = false;
  }
  const readSingle = (key: string) => {
    const result = singleParam(params, key);
    if (!result.valid) isValid = false;
    return result.valid ? result.value : undefined;
  };

  const rawSearch = readSingle("q");
  const search = parseTicketSearch(rawSearch);
  if (!search.success) isValid = false;

  const rawStatuses = listParam(params, "status");
  const statuses = rawStatuses.filter((value): value is TicketStatus =>
    TICKET_STATUSES.includes(value as TicketStatus)
  );
  if (statuses.length !== rawStatuses.length) isValid = false;

  const rawSeverities = listParam(params, "severity");
  const severities = rawSeverities.filter((value): value is Severity =>
    SEVERITIES.includes(value as Severity)
  );
  if (severities.length !== rawSeverities.length) isValid = false;

  const customerId = readSingle("customer");
  const siteId = readSingle("site");
  const ownerId = readSingle("owner");
  for (const value of [customerId, siteId, ownerId]) {
    if (value && !UUID_PATTERN.test(value)) isValid = false;
  }

  const range = readSingle("range");
  if (range && !RANGES.includes(range as (typeof RANGES)[number])) {
    isValid = false;
  }
  const sla = readSingle("sla");
  if (sla && !SLA_BUCKETS.includes(sla as (typeof SLA_BUCKETS)[number])) {
    isValid = false;
  }

  const rawPage = readSingle("page");
  let page = 1;
  if (rawPage) {
    if (!/^[1-9]\d*$/.test(rawPage)) {
      isValid = false;
    } else {
      const parsedPage = Number(rawPage);
      if (!Number.isSafeInteger(parsedPage) || parsedPage > MAX_TICKET_LIST_PAGE) {
        isValid = false;
      } else {
        page = parsedPage;
      }
    }
  }

  return {
    filters: {
      q: search.success ? search.value : undefined,
      status: unique(statuses),
      severity: unique(severities),
      customer_id:
        customerId && UUID_PATTERN.test(customerId) ? customerId : undefined,
      site_id: siteId && UUID_PATTERN.test(siteId) ? siteId : undefined,
      owner_id: ownerId && UUID_PATTERN.test(ownerId) ? ownerId : undefined,
      range: RANGES.includes(range as (typeof RANGES)[number])
        ? (range as TicketFiltersState["range"])
        : undefined,
      sla: SLA_BUCKETS.includes(sla as (typeof SLA_BUCKETS)[number])
        ? (sla as TicketFiltersState["sla"])
        : undefined,
      page,
    },
    isValid,
  };
}

export function parseFilters(params: URLSearchParams): TicketFiltersState {
  return parseTicketListFilters(params).filters;
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
