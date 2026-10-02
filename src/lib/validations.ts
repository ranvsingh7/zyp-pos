import { z } from "zod";
import { businessTypes } from "@/lib/business-types";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Please enter a valid email address." })),
  password: z
    .string()
    .min(1, { error: "Password is required." }),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    fullName: z
      .string()
      .min(1, { error: "Full name is required." })
      .trim(),
    email: z.string().trim().pipe(z.email({ error: "Please enter a valid email address." })),
    password: z
      .string()
      .min(8, { error: "Password must be at least 8 characters." })
      .trim(),
    confirmPassword: z
      .string()
      .min(1, { error: "Please confirm your password." })
      .trim(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const restaurantRegistrationSchema = z
  .object({
    name: z
      .string()
      .min(1, { error: "Restaurant name is required." })
      .trim(),
    ownerName: z
      .string()
      .min(1, { error: "Owner name is required." })
      .trim(),
    phone: z
      .string()
      .min(1, { error: "Phone number is required." })
      .trim(),
    email: z.string().trim().pipe(
        z.email({ error: "Please enter a valid email address." })
      ).optional()
      .or(z.literal("")),
    address: z
      .string()
      .min(1, { error: "Address is required." })
      .trim(),
    city: z
      .string()
      .min(1, { error: "City is required." })
      .trim(),
    state: z
      .string()
      .min(1, { error: "State is required." })
      .trim(),
    pincode: z
      .string()
      .min(1, { error: "Pincode is required." })
      .trim(),
    gstRegistered: z.boolean().default(false),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .or(z.literal("")),
    businessType: z.enum(businessTypes, {
      error: "Please select a business type.",
    }),
  })
  .refine(
    (data) => {
      if (data.gstRegistered && (!data.gstin || data.gstin.trim().length === 0)) {
        return false;
      }
      return true;
    },
    {
      error: "GSTIN is required when GST registration is enabled.",
      path: ["gstin"],
    }
  )
  .refine(
    (data) => {
      if (data.gstRegistered && data.gstin) {
        return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
          data.gstin
        );
      }
      return true;
    },
    {
      error: "Invalid GSTIN format. GSTIN must be 15 characters.",
      path: ["gstin"],
    }
  );

export type RestaurantRegistrationInput = z.infer<
  typeof restaurantRegistrationSchema
>;