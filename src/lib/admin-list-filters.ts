import { z } from "zod";
import { PART_CATEGORIES } from "@/lib/spare-parts/admin-contracts";
import { POSTGREST_FILTER_VALUE_PATTERN } from "@/lib/tickets/search-filter";

export const ADMIN_AUDIT_ENTITIES = [
  "ticket",
  "customer",
  "site",
  "user",
  "spare_part",
  "part_request",
  "field_service_order",
  "sla_policy",
  "comment",
  "attachment",
  "auth",
] as const;

export const ADMIN_AUDIT_ACTIONS = [
  "created",
  "updated",
  "archived",
  "deactivated",
  "deleted",
  "status_changed",
  "severity_changed",
  "owner_assigned",
  "resolved",
  "reopened",
  "assigned",
  "joined",
  "left",
  "login",
  "login_failed",
  "logout",
  "role_changed",
] as const;

const auditFilterShape = {
  entityType: z.enum(ADMIN_AUDIT_ENTITIES).optional(),
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
  actorId: z.string().uuid().optional(),
};

const auditListSchema = z.object({
  ...auditFilterShape,
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value <= 200)
    .default("50"),
});

const auditPageSchema = z.object({
  ...auditFilterShape,
  page: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value <= 10_000)
    .default("1"),
});

const inventoryListSchema = z.object({
  siteId: z.string().uuid().optional(),
  lowStock: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

const siteMemberListSchema = z.object({
  siteId: z.string().uuid().optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value <= 500)
    .default("100"),
});

const sparePartListSchema = z.object({
  category: z.enum(PART_CATEGORIES).optional(),
  active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(POSTGREST_FILTER_VALUE_PATTERN)
    .optional(),
});

function parseSingletonParams<TSchema extends z.ZodTypeAny>(args: {
  params: URLSearchParams;
  fields: Record<string, string>;
  schema: TSchema;
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
    ? { success: true as const, data: parsed.data as z.output<TSchema> }
    : { success: false as const };
}

export function parseAdminAuditListFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: {
      entity_type: "entityType",
      action: "action",
      actor_id: "actorId",
      limit: "limit",
    },
    schema: auditListSchema,
  });
}

export function parseAdminAuditPageFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: {
      entity_type: "entityType",
      action: "action",
      actor_id: "actorId",
      page: "page",
    },
    schema: auditPageSchema,
  });
}

export function parseAdminInventoryListFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: { site_id: "siteId", low_stock: "lowStock" },
    schema: inventoryListSchema,
  });
}

export function parseAdminSiteMemberListFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: { site_id: "siteId", limit: "limit" },
    schema: siteMemberListSchema,
  });
}

export function parseAdminSparePartListFilters(params: URLSearchParams) {
  return parseSingletonParams({
    params,
    fields: { category: "category", active: "active", search: "search" },
    schema: sparePartListSchema,
  });
}

export function buildAdminSparePartSearchFilter(search: string): string {
  const parsed = sparePartListSchema.shape.search.safeParse(search);
  if (!parsed.success || !parsed.data) {
    throw new Error("Invalid spare part search value");
  }
  const escaped = parsed.data.replace(/[%_]/g, (match) => `\\${match}`);
  return `part_number.ilike.%${escaped}%,part_name.ilike.%${escaped}%`;
}
