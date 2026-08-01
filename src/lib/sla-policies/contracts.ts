import { z } from "zod";

export const SLA_POLICY_MAX_MINUTES = 525_600;

const minuteField = z
  .number()
  .int()
  .nonnegative()
  .max(SLA_POLICY_MAX_MINUTES);

const targetFields = {
  p1_response_minutes: minuteField,
  p1_resolution_minutes: minuteField,
  p2_response_minutes: minuteField,
  p2_resolution_minutes: minuteField,
  p3_response_minutes: minuteField,
  p3_resolution_minutes: minuteField,
  p4_response_minutes: minuteField,
  p4_resolution_minutes: minuteField,
};

function targetsAreOrdered(
  value: Partial<Record<keyof typeof targetFields, number>>,
  context: z.RefinementCtx
) {
  for (const severity of ["p1", "p2", "p3", "p4"] as const) {
    const response = value[`${severity}_response_minutes`];
    const resolution = value[`${severity}_resolution_minutes`];
    if (
      response !== undefined &&
      resolution !== undefined &&
      response > resolution
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${severity}_response_minutes`],
        message: "Response target cannot exceed resolution target",
      });
    }
  }
}

export const slaPolicyCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    customer_id: z.string().uuid().nullable().optional(),
    ...targetFields,
  })
  .strict()
  .superRefine(targetsAreOrdered);

export const slaPolicyPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    p1_response_minutes: minuteField.optional(),
    p1_resolution_minutes: minuteField.optional(),
    p2_response_minutes: minuteField.optional(),
    p2_resolution_minutes: minuteField.optional(),
    p3_response_minutes: minuteField.optional(),
    p3_resolution_minutes: minuteField.optional(),
    p4_response_minutes: minuteField.optional(),
    p4_resolution_minutes: minuteField.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one SLA policy field is required",
  })
  .superRefine(targetsAreOrdered);

export const slaPolicyIdSchema = z.string().uuid();

export type SLAPolicyCreateRequest = z.infer<
  typeof slaPolicyCreateRequestSchema
>;
export type SLAPolicyPatchRequest = z.infer<
  typeof slaPolicyPatchRequestSchema
>;
