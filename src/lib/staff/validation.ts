import { z } from "zod";
import { STAFF_ASSIGNABLE_ROLES, STAFF_NAME_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH, STAFF_PHONE_MAX_LENGTH, STAFF_SEARCH_MAX_LENGTH } from "./constants";

/**
 * Input contracts for staff management. Roles are constrained to the tenant
 * role list at the schema level, so a forged `SUPER_ADMIN` value is rejected
 * before it can reach the service layer — not merely ignored by the UI select.
 */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Please enter a valid email address." }));

const phoneSchema = z
  .string()
  .trim()
  .min(1, { error: "Phone number is required." })
  .max(STAFF_PHONE_MAX_LENGTH, { error: "Phone number is too long." })
  .regex(/^[0-9+()\-\s]{6,15}$/, { error: "Please enter a valid phone number." });

const nameSchema = z
  .string()
  .trim()
  .min(1, { error: "Full name is required." })
  .max(STAFF_NAME_MAX_LENGTH, { error: "Full name is too long." });

const passwordSchema = z
  .string()
  .min(STAFF_PASSWORD_MIN_LENGTH, { error: "Password must be at least 8 characters." })
  .max(200, { error: "Password is too long." });

export const staffRoleSchema = z.enum(STAFF_ASSIGNABLE_ROLES, {
  error: "Please select a valid role.",
});

export const createStaffSchema = z.object({
  fullName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  role: staffRoleSchema,
  password: passwordSchema,
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    fullName: nameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    role: staffRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    error: "Nothing to update.",
  });

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const resetStaffPasswordSchema = z
  .object({
    userId: z.string().min(1, { error: "Staff member is required." }),
    newPassword: passwordSchema,
  });

export type ResetStaffPasswordInput = z.infer<typeof resetStaffPasswordSchema>;

export const staffListQuerySchema = z.object({
  search: z.string().trim().max(STAFF_SEARCH_MAX_LENGTH).optional(),
  role: staffRoleSchema.optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

export function firstStaffMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the details and try again.";
}
