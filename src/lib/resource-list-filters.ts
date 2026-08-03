import { z } from "zod";
import {
  FIELD_SERVICE_STATUSES,
  FIELD_SERVICE_TYPES,
} from "@/lib/field-service/contracts";

const SPARE_PART_REQUEST_STATUSES = [
  "requested",
  "approved",
  "shipped",
  "delivered",
  "cancelled",
] as const;

const sparePartRequestListSchema = z.object({
  status: z.enum(SPARE_PART_REQUEST_STATUSES).optional(),
  siteId: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
});

const fieldServiceOrderListSchema = z.object({
  status: z.enum(FIELD_SERVICE_STATUSES).optional(),
  siteId: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
  serviceType: z.enum(FIELD_SERVICE_TYPES).optional(),
});

const siteListSchema = z.object({
  customerId: z.string().uuid().optional(),
});

function parseSingletonParams<T>(args: {
  params: URLSearchParams;
  fields: Record<string, string>;
  schema: z.ZodType<T>;
}) {
  const values: Record<string, string | undefined> = {};
  const allowedKeys = new Set(Object.keys(args.fields));
  for (const key of args.params.keys()) {
    if (!allowedKeys.has(key)) return { success: false as const };
  }
  for (const [queryKey, outputKey] of Object.entries(args.fields)) {
    const entries = args.params.getAll(queryKey);
    if (entries.length > 1) return { success: false as const };
    const value = entries[0]?.trim();
    values[outputKey] = value || undefined;
  }

  const parsed = args.schema.safeParse(values);
  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}

export function parseSparePartRequestListFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: { status: "status", site_id: "siteId", ticket_id: "ticketId" },
    schema: sparePartRequestListSchema,
  });
}

export function parseFieldServiceOrderListFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: {
      status: "status",
      site_id: "siteId",
      ticket_id: "ticketId",
      service_type: "serviceType",
    },
    schema: fieldServiceOrderListSchema,
  });
}

export function parseSiteListFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: { customer_id: "customerId" },
    schema: siteListSchema,
  });
}
