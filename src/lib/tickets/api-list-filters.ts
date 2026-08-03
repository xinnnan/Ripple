import { z } from "zod";
import { TICKET_STATUSES } from "@/types/ticket";

const apiTicketListFilterSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  severity: z.enum(["P1", "P2", "P3", "P4"]).optional(),
  customerId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value <= 200)
    .default("50"),
});
const FILTER_KEYS = new Set([
  "status",
  "severity",
  "customer_id",
  "site_id",
  "limit",
]);

function singleParam(params: URLSearchParams, key: string) {
  const values = params.getAll(key);
  if (values.length > 1) return { success: false as const };
  const value = values[0]?.trim();
  return { success: true as const, value: value || undefined };
}

export function parseTicketApiListFilters(params: URLSearchParams) {
  for (const key of params.keys()) {
    if (!FILTER_KEYS.has(key)) return { success: false as const };
  }
  const status = singleParam(params, "status");
  const severity = singleParam(params, "severity");
  const customer = singleParam(params, "customer_id");
  const site = singleParam(params, "site_id");
  const limit = singleParam(params, "limit");
  if (
    !status.success ||
    !severity.success ||
    !customer.success ||
    !site.success ||
    !limit.success
  ) {
    return { success: false as const };
  }

  const parsed = apiTicketListFilterSchema.safeParse({
    status: status.value,
    severity: severity.value,
    customerId: customer.value,
    siteId: site.value,
    limit: limit.value,
  });
  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}
