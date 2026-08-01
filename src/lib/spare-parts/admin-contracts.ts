import { z } from "zod";

export const PART_CATEGORIES = [
  "sensor",
  "motor",
  "controller",
  "belt",
  "roller",
  "cable",
  "connector",
  "battery",
  "pcb",
  "mechanical",
  "safety",
  "tool",
  "other",
] as const;

export const PART_UNITS = [
  "piece",
  "set",
  "meter",
  "kg",
  "liter",
  "roll",
] as const;

const unitPrice = z.number().finite().nonnegative().max(99_999_999.99);
const compatibleModels = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .nullable();

const sparePartFields = {
  part_number: z.string().trim().min(1).max(100),
  part_name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable(),
  category: z.enum(PART_CATEGORIES),
  unit: z.enum(PART_UNITS),
  unit_price: unitPrice.nullable(),
  compatible_models: compatibleModels,
  image_url: z.string().url().max(2000).nullable(),
};

export const sparePartCreateRequestSchema = z
  .object({
    part_number: sparePartFields.part_number,
    part_name: sparePartFields.part_name,
    description: sparePartFields.description.optional().default(null),
    category: sparePartFields.category.optional().default("other"),
    unit: sparePartFields.unit.optional().default("piece"),
    unit_price: sparePartFields.unit_price.optional().default(null),
    compatible_models: sparePartFields.compatible_models
      .optional()
      .default(null),
    image_url: sparePartFields.image_url.optional().default(null),
  })
  .strict();

export const sparePartPatchRequestSchema = z
  .object({
    part_number: sparePartFields.part_number.optional(),
    part_name: sparePartFields.part_name.optional(),
    description: sparePartFields.description.optional(),
    category: sparePartFields.category.optional(),
    unit: sparePartFields.unit.optional(),
    unit_price: sparePartFields.unit_price.optional(),
    compatible_models: sparePartFields.compatible_models.optional(),
    image_url: sparePartFields.image_url.optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one spare-part field is required",
  });

export const sparePartIdSchema = z.string().uuid();

export type SparePartCreateRequest = z.infer<
  typeof sparePartCreateRequestSchema
>;
export type SparePartPatchRequest = z.infer<
  typeof sparePartPatchRequestSchema
>;
