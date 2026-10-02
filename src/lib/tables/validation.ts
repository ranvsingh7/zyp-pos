import { z } from "zod";
import { TABLE_STATUSES } from "@/lib/tables/constants";

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const tableObjectIdSchema = z
  .string()
  .trim()
  .refine((v) => OBJECT_ID_REGEX.test(v), {
    message: "Invalid identifier.",
  });

const optionalObjectId = z
  .union([z.string().trim(), z.null()])
  .optional()
  .refine(
    (v) => v === undefined || v === null || v === "" || OBJECT_ID_REGEX.test(v),
    { message: "Invalid identifier." }
  );

export const tableInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Table name is required." })
    .max(50, { message: "Table name must be 50 characters or fewer." }),
  capacity: z.coerce
    .number()
    .int({ message: "Capacity must be a whole number." })
    .min(1, { message: "Capacity must be at least 1." })
    .max(20, { message: "Capacity cannot exceed 20." }),
  sectionId: optionalObjectId.transform((v) =>
    v === "" || v === undefined || v === null ? (null as string | null) : v
  ),
  status: z.enum(TABLE_STATUSES).default("AVAILABLE"),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().nonnegative().optional(),
});

export const tableUpdateSchema = tableInputSchema.extend({
  id: tableObjectIdSchema,
});

export const tableStatusSchema = z.object({
  id: tableObjectIdSchema,
  status: z.enum(TABLE_STATUSES),
});

export const tableActivationSchema = z.object({
  id: tableObjectIdSchema,
  isActive: z.boolean(),
});

export const tableReorderSchema = z.object({
  orderedIds: z.array(tableObjectIdSchema).min(1),
});

export const sectionInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Section name is required." })
    .max(50, { message: "Section name must be 50 characters or fewer." }),
  displayOrder: z.coerce.number().int().nonnegative().optional(),
  isActive: z.boolean().default(true),
});

export const sectionUpdateSchema = sectionInputSchema.extend({
  id: tableObjectIdSchema,
});

export const sectionReorderSchema = z.object({
  orderedIds: z.array(tableObjectIdSchema).min(1),
});

export type TableInput = z.infer<typeof tableInputSchema>;
export type TableUpdateInput = z.infer<typeof tableUpdateSchema>;
export type SectionInput = z.infer<typeof sectionInputSchema>;
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;

export function firstZodMessage(result: {
  error: { issues?: { message?: string }[] };
}): string {
  return result.error.issues?.[0]?.message ?? "Invalid input.";
}