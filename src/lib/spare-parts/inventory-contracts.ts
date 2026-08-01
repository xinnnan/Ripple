import { z } from "zod";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const inventoryQuantity = z
  .number()
  .int()
  .nonnegative()
  .max(POSTGRES_INTEGER_MAX);
const inventoryLocation = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .transform((value) => (value === "" ? null : value));

function addInventoryBoundsIssues(
  value: {
    quantity?: number;
    min_quantity?: number;
    max_quantity?: number | null;
  },
  context: z.RefinementCtx
) {
  if (
    value.max_quantity != null &&
    value.min_quantity != null &&
    value.min_quantity > value.max_quantity
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max_quantity"],
      message: "Maximum quantity must be at least the minimum quantity",
    });
  }

  if (
    value.max_quantity != null &&
    value.quantity != null &&
    value.quantity > value.max_quantity
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quantity"],
      message: "Quantity cannot exceed the maximum quantity",
    });
  }
}

export const inventoryUpsertRequestSchema = z
  .object({
    spare_part_id: z.string().uuid(),
    site_id: z.string().uuid(),
    quantity: inventoryQuantity.optional().default(0),
    min_quantity: inventoryQuantity.optional().default(0),
    max_quantity: inventoryQuantity.nullable().optional().default(null),
    location: inventoryLocation.optional().default(null),
  })
  .strict()
  .superRefine(addInventoryBoundsIssues);

export const inventoryPatchRequestSchema = z
  .object({
    quantity: inventoryQuantity.optional(),
    min_quantity: inventoryQuantity.optional(),
    max_quantity: inventoryQuantity.nullable().optional(),
    location: inventoryLocation.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one inventory field is required",
  })
  .superRefine(addInventoryBoundsIssues);

export const inventoryIdSchema = z.string().uuid();

export type InventoryUpsertRequest = z.infer<
  typeof inventoryUpsertRequestSchema
>;
export type InventoryPatchRequest = z.infer<
  typeof inventoryPatchRequestSchema
>;
