import { z } from "zod";

export const updateTeamMemberSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["active", "inactive", "invited"]).optional(),
    site_ids: z.array(z.string().uuid()).max(100).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.site_ids &&
      new Set(value.site_ids).size !== value.site_ids.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["site_ids"],
        message: "Duplicate site assignments are not allowed",
      });
    }
  });

export type TeamMemberPatch = Omit<
  z.infer<typeof updateTeamMemberSchema>,
  "site_ids"
>;
