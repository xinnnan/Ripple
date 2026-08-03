import { z } from "zod";
import { TICKET_STATUSES } from "@/types/ticket";

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

const ticketExportFilterSchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^,()"\\\u0000-\u001f\u007f]*$/)
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

function optionalParam(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  return value || undefined;
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
  const canonicalValue = optionalParam(params, canonical);
  const legacyValue = optionalParam(params, legacy);
  return {
    value: canonicalValue ?? legacyValue,
    conflict: Boolean(
      canonicalValue && legacyValue && canonicalValue !== legacyValue
    ),
  };
}

export function parseTicketExportFilters(params: URLSearchParams) {
  const customer = aliasedParam(params, "customer", "customer_id");
  const site = aliasedParam(params, "site", "site_id");
  const owner = aliasedParam(params, "owner", "owner_id");
  if (customer.conflict || site.conflict || owner.conflict) {
    return { success: false as const };
  }

  const parsed = ticketExportFilterSchema.safeParse({
    q: optionalParam(params, "q"),
    status: listParam(params, "status"),
    severity: listParam(params, "severity"),
    customerId: customer.value,
    siteId: site.value,
    ownerId: owner.value,
    range: optionalParam(params, "range"),
    sla: optionalParam(params, "sla"),
    dateFrom: optionalParam(params, "date_from"),
    dateTo: optionalParam(params, "date_to"),
  });

  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}
