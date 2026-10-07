import { z } from "zod";
import { SERVICE_KEYS, normalizeServiceKeys } from "@/lib/services/catalog";
import {
  PLAN_BILLING_CYCLES,
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
} from "./constants";
import {
  DEFAULT_TAX_CONFIG,
  GST_SCHEMES,
  GSTIN_REGEX,
  TAX_RATE_MAX,
} from "@/lib/billing/constants";

/** Shared pagination params read from URL search params on admin pages. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(25),
});

export const planSaveSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  description: z.string().trim().max(500).nullish(),
  pricePaise: z.coerce.number().int().nonnegative("Price cannot be negative."),
  billingCycle: z.enum(PLAN_BILLING_CYCLES),
  durationDays: z.coerce.number().int().positive().nullish(),
  isActive: z.boolean().default(true),
  features: z
    .array(z.string().trim().max(120))
    .max(20)
    .default([]),
  /**
   * Which services the plan grants. Validated against the catalog so a plan can
   * never be saved claiming a capability that does not exist, and the stored
   * form is the dependency-complete normalization.
   */
  serviceKeys: z
    .array(z.enum(SERVICE_KEYS))
    .max(SERVICE_KEYS.length)
    .default([])
    .transform(normalizeServiceKeys),
});

/** Real GSTIN shape (state code + PAN + entity + Z + checksum). */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_REGEX, "Invalid GSTIN format. GSTIN must be 15 characters.")
  .nullish();

const taxRateSchema = z.coerce
  .number()
  .min(0, "Tax rate cannot be negative.")
  .max(TAX_RATE_MAX, `Tax rate cannot exceed ${TAX_RATE_MAX}%.`)
  .nullish();

export const createRestaurantSchema = z.object({
  name: z.string().trim().min(2, "Restaurant name is required.").max(80),
  phone: z.string().trim().min(5).max(20),
  email: z.string().trim().email().nullish(),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().trim().min(4).max(12),
  businessType: z.string().trim().min(2).max(40),
  gstRegistered: z.boolean().default(false),
  gstin: gstinSchema,
  taxEnabled: z.boolean().default(DEFAULT_TAX_CONFIG.taxEnabled),
  defaultTaxRate: z.coerce
    .number()
    .min(0, "Tax rate cannot be negative.")
    .max(TAX_RATE_MAX, `Tax rate cannot exceed ${TAX_RATE_MAX}%.`)
    .default(DEFAULT_TAX_CONFIG.defaultTaxRate),
  taxInclusive: z.boolean().default(false),
  gstScheme: z.enum(GST_SCHEMES).default("INTRA_STATE"),
  cgstRatePercent: taxRateSchema,
  sgstRatePercent: taxRateSchema,
  igstRatePercent: taxRateSchema,
  ownerFullName: z.string().trim().min(2).max(80),
  ownerEmail: z.string().trim().email("A valid owner email is required."),
  ownerPhone: z.string().trim().max(20).nullish(),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
  planId: z.string().trim().nullish(),
  isTrial: z.boolean().default(false),
  discountAmountPaise: z.coerce.number().int().nonnegative().nullish(),
  finalPricePaise: z.coerce.number().int().nonnegative().nullish(),
  durationDays: z.coerce.number().int().positive().nullish(),
  gracePeriodDays: z.coerce.number().int().nonnegative().nullish(),
  notes: z.string().trim().max(300).nullish(),
  reason: z.string().trim().max(300).nullish(),
}).superRefine((data, ctx) => {
  if (data.gstRegistered && !data.gstin) {
    ctx.addIssue({
      code: "custom",
      message: "GSTIN is required when GST registration is enabled.",
      path: ["gstin"],
    });
  }
  assertConsistentTaxRates(data, ctx);
});

export const updateRestaurantSchema = z.object({
  name: z.string().trim().min(2).max(80).nullish(),
  phone: z.string().trim().min(5).max(20).nullish(),
  email: z.string().trim().email().nullish(),
  address: z.string().trim().min(5).max(300).nullish(),
  city: z.string().trim().min(2).max(80).nullish(),
  state: z.string().trim().min(2).max(80).nullish(),
  pincode: z.string().trim().min(4).max(12).nullish(),
  businessType: z.string().trim().min(2).max(40).nullish(),
  gstRegistered: z.boolean().nullish(),
  gstin: gstinSchema,
  taxEnabled: z.boolean().nullish(),
  defaultTaxRate: taxRateSchema,
  taxInclusive: z.boolean().nullish(),
  gstScheme: z.enum(GST_SCHEMES).nullish(),
  cgstRatePercent: taxRateSchema,
  sgstRatePercent: taxRateSchema,
  igstRatePercent: taxRateSchema,
  reason: z.string().trim().max(300).nullish(),
}).superRefine((data, ctx) => {
  // gstRegistered toggled on without a GSTIN in the same payload resolves
  // against the stored GSTIN in the service, which rejects when none exists.
  assertConsistentTaxRates(data, ctx);
});

/**
 * Password rules for the SUPER_ADMIN owner-reset action.
 *
 * Deliberately mirrors the established application policy rather than inventing
 * a stricter one: `signupSchema` (min 8, trimmed) and `resetStaffPasswordSchema`
 * (min 8, max 200) already agree on the floor, so an owner's admin-issued
 * password is judged by the same standard as every other credential in the app.
 * The extra check here is that a non-empty password must contain at least one
 * non-whitespace character — a raw `.min(8)` would accept eight spaces.
 */
export const resetOwnerPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .trim()
      .min(8, "Password must be at least 8 characters.")
      .max(200, "Password is too long."),
    confirmPassword: z
      .string()
      .min(1, "Please confirm the new password.")
      .max(200, "Password is too long."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type ResetOwnerPasswordInput = z.infer<typeof resetOwnerPasswordSchema>;

/**
 * Intra-state consistency: when the combined rate and both split rates are
 * all present in one payload, CGST + SGST must equal the combined rate
 * (and IGST must equal it for inter-state).
 */
function assertConsistentTaxRates(
  data: {
    gstScheme?: string | null;
    defaultTaxRate?: number | null;
    cgstRatePercent?: number | null;
    sgstRatePercent?: number | null;
    igstRatePercent?: number | null;
  },
  ctx: { addIssue: (issue: { code: "custom"; message: string; path: (string | number)[] }) => void }
): void {
  const combined = data.defaultTaxRate;
  if (combined == null) return;
  if (data.gstScheme === "INTER_STATE") {
    if (data.igstRatePercent != null && Math.abs(data.igstRatePercent - combined) > 0.001) {
      ctx.addIssue({
        code: "custom",
        message: "IGST rate must equal the default tax rate for inter-state billing.",
        path: ["igstRatePercent"],
      });
    }
    return;
  }
  if (
    data.cgstRatePercent != null &&
    data.sgstRatePercent != null &&
    Math.abs(data.cgstRatePercent + data.sgstRatePercent - combined) > 0.001
  ) {
    ctx.addIssue({
      code: "custom",
      message: "CGST + SGST must equal the default tax rate.",
      path: ["cgstRatePercent"],
    });
  }
}

// The create/renew/change-plan schemas intentionally have no field for price,
// final price, duration, billing cycle, grace period, expiry or the trial
// flag. Those are derived from the plan document on the server, so accepting
// them here would only create a second, untrusted way to set them.

export const createSubscriptionSchema = z.object({
  restaurantId: z.string().min(1),
  planId: z.string().min(1),
  discountAmountPaise: z.coerce.number().int().nonnegative().nullish(),
  startDate: z.string().datetime({ offset: true }).nullish(),
  notes: z.string().trim().max(300).nullish(),
  reason: z.string().trim().max(300).nullish(),
});

export const renewSubscriptionSchema = z.object({
  restaurantId: z.string().min(1),
  planId: z.string().min(1).nullish(),
  startDate: z.string().datetime({ offset: true }).nullish(),
  discountAmountPaise: z.coerce.number().int().nonnegative().nullish(),
  notes: z.string().trim().max(300).nullish(),
  reason: z.string().trim().max(300).nullish(),
});

export const changePlanSchema = z.object({
  restaurantId: z.string().min(1),
  planId: z.string().min(1),
  discountAmountPaise: z.coerce.number().int().nonnegative().nullish(),
  reason: z.string().trim().max(300).nullish(),
});

/** Discount only — the amount charged is always the plan price minus this. */
export const changePricingSchema = z.object({
  restaurantId: z.string().min(1),
  discountAmountPaise: z.coerce.number().int().nonnegative().nullish(),
  reason: z.string().trim().max(300).nullish(),
});

export const extendExpirySchema = z.object({
  restaurantId: z.string().min(1),
  days: z.coerce.number().int().positive().nullish(),
  newExpiryDate: z.string().datetime({ offset: true }).nullish(),
  reason: z.string().trim().max(300).nullish(),
});

export const actionWithReasonSchema = z.object({
  restaurantId: z.string().min(1),
  reason: z.string().trim().max(300).nullish(),
});

export const recordPaymentSchema = z.object({
  restaurantId: z.string().min(1),
  subscriptionId: z.string().min(1),
  amountPaise: z.coerce.number().int().positive(),
  paymentMethod: z.enum(SUBSCRIPTION_PAYMENT_METHODS),
  transactionReference: z.string().trim().max(120).nullish(),
  paidAt: z.string().datetime({ offset: true }).nullish(),
  note: z.string().trim().max(300).nullish(),
});

export const updatePaymentSchema = z.object({
  paymentId: z.string().min(1),
  amountPaise: z.coerce.number().int().positive().nullish(),
  paymentMethod: z.enum(SUBSCRIPTION_PAYMENT_METHODS).nullish(),
  transactionReference: z.string().trim().max(120).nullish(),
  status: z.enum(SUBSCRIPTION_PAYMENT_STATUSES).nullish(),
  paidAt: z.string().datetime({ offset: true }).nullish(),
  note: z.string().trim().max(300).nullish(),
});

export const updateSettingsSchema = z.object({
  trialDurationDays: z.coerce.number().int().min(0).max(365).nullish(),
  expiryWarningDays: z.coerce.number().int().min(0).max(90).nullish(),
  gracePeriodDays: z.coerce.number().int().min(0).max(90).nullish(),
  timezone: z.string().trim().max(64).nullish(),
});

export const auditLogFiltersSchema = z.object({
  action: z.string().trim().max(60).nullish(),
  entityType: z.string().trim().max(40).nullish(),
  dateFrom: z.string().datetime({ offset: true }).nullish(),
  dateTo: z.string().datetime({ offset: true }).nullish(),
  search: z.string().trim().max(100).nullish(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(25),
});

export const subscriptionsFilterSchema = z.object({
  search: z.string().trim().max(100).nullish(),
  status: z.enum(SUBSCRIPTION_STATUSES).nullish(),
  planId: z.string().trim().nullish(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(25),
});

export const restaurantsFilterSchema = z.object({
  search: z.string().trim().max(100).nullish(),
  planId: z.string().trim().nullish(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(25),
});

export const paymentsFilterSchema = z.object({
  search: z.string().trim().max(100).nullish(),
  status: z.enum(SUBSCRIPTION_PAYMENT_STATUSES).nullish(),
  restaurantId: z.string().trim().nullish(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(25),
});