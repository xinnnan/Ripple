import { z } from "zod";
import { TICKET_STATUSES } from "@/types/ticket";
import {
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_SEARCH_PATTERN,
} from "@/lib/tickets/search-filter";

const severities = ["P1", "P2", "P3", "P4"] as const;
const ranges = ["7d", "30d", "90d", "all"] as const;
const slaBuckets = [
  "all",
  "breached",
  "breaching",
  "on_track",
  "no_sla",
] as const;
const dateBoundarySchema = z.union([
  z.string().date(),
  z.string().datetime({ offset: true }),
]);
const FILTER_KEYS = new Set([
  "q",
  "status",
  "severity",
  "customer",
  "customer_id",
  "site",
  "site_id",
  "owner",
  "owner_id",
  "range",
  "sla",
  "date_from",
  "date_to",
]);

const ticketExportFilterSchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(TICKET_SEARCH_MAX_LENGTH)
      .regex(TICKET_SEARCH_PATTERN)
      .optional(),
    status: z.array(z.enum(TICKET_STATUSES)).max(TICKET_STATUSES.length),
    severity: z.array(z.enum(severities)).max(severities.length),
    customerId: z.string().uuid().optional(),
    siteId: z.string().uuid().optional(),
    ownerId: z.string().uuid().optional(),
    range: z.enum(ranges).optional(),
    sla: z.enum(slaBuckets).optional(),
    dateFrom: dateBoundarySchema.optional(),
    dateTo: dateBoundarySchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.range && value.range !== "all" && (value.dateFrom || value.dateTo)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Range and explicit date bounds cannot be combined",
      });
    }
    if (
      value.dateFrom &&
      value.dateTo &&
      new Date(value.dateFrom).getTime() > new Date(value.dateTo).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateTo"],
        message: "date_to must not precede date_from",
      });
    }
  });

export type TicketExportFilters = z.infer<typeof ticketExportFilterSchema>;

function singleParam(params: URLSearchParams, key: string) {
  const values = params.getAll(key);
  if (values.length > 1) return { value: undefined, conflict: true };
  const value = values[0]?.trim();
  return { value: value || undefined, conflict: false };
}

function listParam(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function aliasedParam(
  params: URLSearchParams,
  canonical: string,
  legacy: string
): { value?: string; conflict: boolean } {
  const canonicalResult = singleParam(params, canonical);
  const legacyResult = singleParam(params, legacy);
  const canonicalValue = canonicalResult.value;
  const legacyValue = legacyResult.value;
  return {
    value: canonicalValue ?? legacyValue,
    conflict: Boolean(
      canonicalResult.conflict ||
        legacyResult.conflict ||
        (canonicalValue && legacyValue && canonicalValue !== legacyValue)
    ),
  };
}

export function parseTicketExportFilters(params: URLSearchParams) {
  for (const key of params.keys()) {
    if (!FILTER_KEYS.has(key)) return { success: false as const };
  }
  const customer = aliasedParam(params, "customer", "customer_id");
  const site = aliasedParam(params, "site", "site_id");
  const owner = aliasedParam(params, "owner", "owner_id");
  const q = singleParam(params, "q");
  const range = singleParam(params, "range");
  const sla = singleParam(params, "sla");
  const dateFrom = singleParam(params, "date_from");
  const dateTo = singleParam(params, "date_to");
  if (
    customer.conflict ||
    site.conflict ||
    owner.conflict ||
    q.conflict ||
    range.conflict ||
    sla.conflict ||
    dateFrom.conflict ||
    dateTo.conflict
  ) {
    return { success: false as const };
  }

  const parsed = ticketExportFilterSchema.safeParse({
    q: q.value,
    status: listParam(params, "status"),
    severity: listParam(params, "severity"),
    customerId: customer.value,
    siteId: site.value,
    ownerId: owner.value,
    range: range.value,
    sla: sla.value,
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
  });

  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}
