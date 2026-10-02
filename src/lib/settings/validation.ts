import { z } from "zod";
import { businessTypes } from "@/lib/business-types";
import { BILL_PREFIX_MAX, GST_SCHEMES, GSTIN_REGEX, TAX_RATE_MAX } from "@/lib/billing/constants";
import {
  PREFIX_MAX,
  SERVICE_CHARGE_RATE_MAX,
  UPI_ID_MAX,
  UPI_ID_PATTERN,
} from "./constants";

/** Document prefixes are alphanumeric and upper-cased on save. */
const prefixSchema = (max: number) =>
  z
    .string()
    .trim()
    .transform((value) => value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())
    .pipe(z.string().max(max, `Must be ${max} characters or fewer.`));

const taxRateSchema = z.coerce
  .number()
  .min(0, "Tax rate cannot be negative.")
  .max(TAX_RATE_MAX, `Tax rate cannot exceed ${TAX_RATE_MAX}%.`);

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

/**
 * A blank input clears the stored value, while a field missing from the form
 * entirely leaves the stored value untouched.
 */
const emptyToNull = (value: unknown) => (value === "" ? null : value);

/**
 * A Yes/No setting (gstRegistered, taxEnabled, …).
 *
 * These are submitted by the `YesNo` control, which keeps the choice in a hidden
 * `<input value="true|false">`. `FormData` can only carry strings, so the raw
 * payload always arrives as the *text* `"true"`/`"false"` — passing that straight
 * to `z.boolean()` fails with "expected boolean, received string".
 *
 * This maps the two form tokens onto real booleans before validation, per field,
 * rather than coercing strings globally. Anything else (`"yes"`, `"1"`, `""`,
 * a non-string) is left alone so `z.boolean()` rejects it with a clear message.
 */
const booleanField = () =>
  z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return undefined;
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean({ error: "Please choose Yes or No." }).optional());

/**
 * The restaurant UPI ID used as the destination of the bill's payment QR.
 *
 * Structure is `<something>@<provider>`. The provider side is deliberately NOT
 * checked against a list of known handles or PSPs, so any valid UPI handle works
 * now and after providers are added. Only characters a UPI handle can legally
 * contain are allowed, and whitespace/control characters are refused so the
 * stored value can be embedded in a `upi://pay` URI unchanged.
 */
const upiIdSchema = z
  .string()
  .trim()
  .refine(
    (value) => !/[\s\u0000-\u001f\u007f]/.test(value),
    "UPI ID cannot contain spaces or special characters."
  )
  .refine(
    (value) => UPI_ID_PATTERN.test(value),
    "Enter a valid UPI ID in the form restaurantname@provider."
  )
  .pipe(z.string().max(UPI_ID_MAX, `UPI ID must be ${UPI_ID_MAX} characters or fewer.`));

/** Re-validates a stored value on read, guarding legacy or hand-edited data. */
export function isValidUpiId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= UPI_ID_MAX &&
    !/[\s\u0000-\u001f\u007f]/.test(value) &&
    UPI_ID_PATTERN.test(value)
  );
}

/**
 * One payload for the whole settings page. Every field is optional so a save
 * only ever writes what the owner actually changed; the service merges the
 * result over the stored configuration before validating it.
 */
export const restaurantSettingsUpdateSchema = z
  .object({
    name: z.preprocess(emptyToUndefined, z.string().trim().min(2, "Restaurant name is required.").max(80).optional()),
    businessType: z.preprocess(emptyToUndefined, z.enum(businessTypes, { error: "Please select a business type." }).optional()),
    phone: z.preprocess(emptyToUndefined, z.string().trim().min(5, "Enter a valid phone number.").max(20).optional()),
    email: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .pipe(z.email({ error: "Please enter a valid email address." }))
        .optional()
        .nullable()
    ),
    address: z.preprocess(emptyToUndefined, z.string().trim().min(5, "Address is required.").max(300).optional()),
    city: z.preprocess(emptyToUndefined, z.string().trim().min(2, "City is required.").max(80).optional()),
    state: z.preprocess(emptyToUndefined, z.string().trim().min(2, "State is required.").max(80).optional()),
    pincode: z.preprocess(emptyToUndefined, z.string().trim().min(4, "Pincode is required.").max(12).optional()),
    gstRegistered: booleanField(),
    gstin: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .toUpperCase()
        .pipe(z.string().regex(GSTIN_REGEX, "Invalid GSTIN format. GSTIN must be 15 characters."))
        .optional()
        .nullable()
    ),
    taxEnabled: booleanField(),
    defaultTaxRate: z.preprocess(emptyToUndefined, taxRateSchema.optional()),
    cgstRatePercent: z.preprocess(emptyToUndefined, taxRateSchema.optional()),
    sgstRatePercent: z.preprocess(emptyToUndefined, taxRateSchema.optional()),
    igstRatePercent: z.preprocess(emptyToUndefined, taxRateSchema.optional()),
    gstScheme: z.preprocess(emptyToUndefined, z.enum(GST_SCHEMES).optional()),
    taxInclusive: booleanField(),
    serviceChargeEnabled: booleanField(),
    serviceChargeRate: z.preprocess(
      emptyToUndefined,
      z.coerce
        .number()
        .min(0, "Service charge cannot be negative.")
        .max(SERVICE_CHARGE_RATE_MAX, `Service charge cannot exceed ${SERVICE_CHARGE_RATE_MAX}%.`)
        .optional()
    ),
    roundOffEnabled: booleanField(),
    billPrefix: z.preprocess(emptyToUndefined, prefixSchema(BILL_PREFIX_MAX).optional()),
    kotPrefix: z.preprocess(emptyToUndefined, prefixSchema(PREFIX_MAX).optional()),
    purchasePrefix: z.preprocess(emptyToUndefined, prefixSchema(PREFIX_MAX).optional()),
    // Whitespace-only input counts as "not set" rather than an error, matching
    // how the field behaves when submitted completely empty.
    upiId: z.preprocess((value) =>
      typeof value === "string" && value.trim() === "" ? null : value
    , upiIdSchema.optional().nullable()),
  })
  .superRefine((data, ctx) => {
    if (data.gstRegistered === true && data.gstin === null) {
      ctx.addIssue({
        code: "custom",
        message: "GSTIN is required when GST registration is enabled.",
        path: ["gstin"],
      });
    }
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
  });

export type RestaurantSettingsUpdateInput = z.infer<typeof restaurantSettingsUpdateSchema>;

export function firstSettingsMessage(result: {
  error: { issues: { message?: string }[] };
}): string {
  return result.error.issues[0]?.message ?? "Invalid settings.";
}
