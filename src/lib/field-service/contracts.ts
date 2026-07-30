import { z } from "zod";

export const FIELD_SERVICE_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const FIELD_SERVICE_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export const FIELD_SERVICE_TYPES = [
  "repair",
  "installation",
  "inspection",
  "commissioning",
  "training",
  "emergency",
  "maintenance",
] as const;

export const FIELD_SERVICE_ENGINEER_ROLES = [
  "lead",
  "engineer",
  "assistant",
] as const;

export function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || year > 9999) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

const dateOnlySchema = z
  .string()
  .refine(isValidDateOnly, "Date must be a real calendar date in YYYY-MM-DD format");

const hoursSchema = z
  .number()
  .nonnegative()
  .finite()
  .multipleOf(0.1)
  .max(9_999.9);

const engineerSchema = z.object({
  engineer_id: z.string().uuid(),
  role: z.enum(FIELD_SERVICE_ENGINEER_ROLES).default("engineer"),
});

function rejectDuplicateEngineers(
  value: { engineers?: Array<{ engineer_id: string }> },
  context: z.RefinementCtx
) {
  const engineerIds =
    value.engineers?.map((engineer) => engineer.engineer_id) ?? [];
  if (new Set(engineerIds).size !== engineerIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["engineers"],
      message: "Duplicate engineer assignments are not allowed",
    });
  }
}

function rejectReversedDates(
  value: {
    scheduled_date?: string | null;
    scheduled_end_date?: string | null;
  },
  context: z.RefinementCtx
) {
  if (
    value.scheduled_date &&
    value.scheduled_end_date &&
    value.scheduled_end_date < value.scheduled_date
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scheduled_end_date"],
      message: "Scheduled end date cannot be before the start date",
    });
  }
}

export const createFieldServiceOrderSchema = z
  .object({
    ticket_id: z.string().uuid().nullable().optional(),
    site_id: z.string().uuid(),
    service_type: z.enum(FIELD_SERVICE_TYPES),
    priority: z.enum(FIELD_SERVICE_PRIORITIES).default("normal"),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullable().optional(),
    scheduled_date: dateOnlySchema.nullable().optional(),
    scheduled_end_date: dateOnlySchema.nullable().optional(),
    estimated_hours: hoursSchema.nullable().optional(),
    travel_required: z.boolean().default(true),
    travel_from: z.string().trim().max(200).nullable().optional(),
    engineers: z.array(engineerSchema).max(20).default([]),
  })
  .superRefine((value, context) => {
    rejectDuplicateEngineers(value, context);
    rejectReversedDates(value, context);
  });

export const updateFieldServiceOrderSchema = z
  .object({
    status: z.enum(FIELD_SERVICE_STATUSES).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    service_type: z.enum(FIELD_SERVICE_TYPES).optional(),
    priority: z.enum(FIELD_SERVICE_PRIORITIES).optional(),
    scheduled_date: dateOnlySchema.nullable().optional(),
    scheduled_end_date: dateOnlySchema.nullable().optional(),
    estimated_hours: hoursSchema.nullable().optional(),
    actual_hours: hoursSchema.nullable().optional(),
    travel_required: z.boolean().optional(),
    travel_from: z.string().trim().max(200).nullable().optional(),
    completion_report: z.string().trim().max(20000).nullable().optional(),
    completion_notes: z.string().trim().max(2000).nullable().optional(),
    engineers: z.array(engineerSchema).max(20).optional(),
  })
  .superRefine((value, context) => {
    rejectDuplicateEngineers(value, context);
    rejectReversedDates(value, context);
  });

export type FieldServiceOrderCreateInput = Omit<
  z.infer<typeof createFieldServiceOrderSchema>,
  "engineers"
>;

export type FieldServiceOrderPatch = Omit<
  z.infer<typeof updateFieldServiceOrderSchema>,
  "engineers"
>;

export type FieldServiceEngineerInput = z.infer<typeof engineerSchema>;
