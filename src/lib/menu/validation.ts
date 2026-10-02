import { z } from "zod";
import {
  MENU_ITEM_TYPES,
  MENU_VEG_TYPES,
  MENU_SIZE_UNITS,
  OBJECT_ID_REGEX,
  HSN_SAC_CODE_MAX,
} from "@/lib/menu/constants";
import { TAX_MODES, TAX_TYPES } from "@/lib/billing/tax-config";
import { TAX_RATE_MAX } from "@/lib/billing/constants";

export const objectIdSchema = z
  .string()
  .trim()
  .refine((v) => OBJECT_ID_REGEX.test(v), {
    error: "Invalid identifier.",
  });

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength, { error: `Must be ${maxLength} characters or fewer.` })
    .optional()
    .or(z.literal(""));

/**
 * Money fields arrive as rupees (e.g. "180" or "180.50") and are validated,
 * then converted to integer paise by the service layer before persisting.
 */
const rupeesField = z.coerce
  .number()
  .finite("Enter a valid price.")
  .nonnegative("Price must be zero or greater.")
  .max(100_000_000, "Price is too large.");

const blankToRupees = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  rupeesField.nullable()
);

export const menuCategoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Category name is required." })
    .max(100, { error: "Category name must be 100 characters or fewer." }),
  description: optionalText(500),
  displayOrder: z.coerce.number().int().nonnegative().optional(),
  isActive: z.boolean().default(true),
});

export type MenuCategoryInput = z.infer<typeof menuCategoryInputSchema>;

export const taxOverrideInputSchema = z
  .object({
    enabled: z.boolean().default(false),
    taxRatePercent: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : v),
      z.coerce
        .number()
        .finite("Enter a valid GST rate.")
        .min(0, "GST rate can't be negative.")
        .max(TAX_RATE_MAX, "GST rate must be 100% or less.")
        .nullable()
    ),
    taxMode: z.enum(TAX_MODES).nullable().optional(),
    taxType: z.enum(TAX_TYPES).nullable().optional(),
  })
  .superRefine((tax, ctx) => {
    if (tax.enabled) {
      if (tax.taxRatePercent == null) {
        ctx.addIssue({
          code: "custom",
          path: ["taxRatePercent"],
          message: "GST rate is required when the tax override is on.",
        });
      }
      if (!tax.taxMode) {
        ctx.addIssue({
          code: "custom",
          path: ["taxMode"],
          message: "Tax mode is required when the tax override is on.",
        });
      }
      if (!tax.taxType) {
        ctx.addIssue({
          code: "custom",
          path: ["taxType"],
          message: "Tax type is required when the tax override is on.",
        });
      }
    }
  })
  .default({ enabled: false, taxRatePercent: null, taxMode: null, taxType: null });

export type TaxOverrideInput = z.infer<typeof taxOverrideInputSchema>;

export const menuVariantInputSchema = z
  .object({
    id: objectIdSchema.optional(),
    name: z.string().trim().max(50).optional(),
    displayName: z
      .string()
      .trim()
      .min(1, { error: "Variant name is required." })
      .max(100, { error: "Variant name must be 100 characters or fewer." }),
    priceRupees: rupeesField,
    description: optionalText(500),
    sku: optionalText(50),
    sizeValue: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : v),
      z.coerce.number().finite("Enter a valid size.").nullable()
    ),
    sizeUnit: z.enum(MENU_SIZE_UNITS).nullable().optional(),
    displayOrder: z.coerce.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
    taxOverride: taxOverrideInputSchema.optional(),
  })
  .superRefine((variant, ctx) => {
    if (variant.sizeValue != null && variant.sizeValue <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeValue"],
        message: "Size value must be positive.",
      });
    }
    if (variant.sizeValue != null && !variant.sizeUnit) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeUnit"],
        message: "Size unit is required when a size value is set.",
      });
    }
    if (variant.sizeValue == null && variant.sizeUnit) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeValue"],
        message: "Size value is required when a size unit is set.",
      });
    }
  });

export type MenuVariantInput = z.infer<typeof menuVariantInputSchema>;

export const menuItemInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: "Item name is required." })
      .max(100, { error: "Item name must be 100 characters or fewer." }),
    description: optionalText(500),
    categoryId: objectIdSchema,
    itemType: z.enum(MENU_ITEM_TYPES).default("FOOD"),
    vegType: z.enum(MENU_VEG_TYPES).default("VEG"),
    imageUrl: optionalText(2048),
    hasVariants: z.boolean().default(false),
    // Optional, restaurant-entered HSN/SAC. Trimmed, length-capped, and never
    // checked against a bundled code list — the restaurant owns correctness.
    hsnSacCode: optionalText(HSN_SAC_CODE_MAX),
    basePriceRupees: blankToRupees,
    isAvailable: z.boolean().default(true),
    isActive: z.boolean().default(true),
    displayOrder: z.coerce.number().int().nonnegative().optional(),
    variants: z.array(menuVariantInputSchema).max(50).optional(),
    taxOverride: taxOverrideInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.hasVariants && data.basePriceRupees == null) {
      ctx.addIssue({
        code: "custom",
        path: ["basePriceRupees"],
        message: "Base price is required when the item has no variants.",
      });
    }
    if (!data.hasVariants && data.variants && data.variants.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message: "This item does not use variants. Remove the variants first.",
      });
    }
    if (data.hasVariants) {
      if (!data.variants || data.variants.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["variants"],
          message: "At least one active variant is required.",
        });
      } else if (!data.variants.some((v) => v.isActive)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants"],
          message: "At least one active variant is required.",
        });
      }
    }
  });

export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export const menuItemUpdateSchema = menuItemInputSchema.extend({
  id: objectIdSchema,
});

export type MenuItemUpdateInput = z.infer<typeof menuItemUpdateSchema>;

export const menuReorderInputSchema = z.object({
  orderedIds: z.array(objectIdSchema).min(1),
});

export const menuVariantReorderInputSchema = z.object({
  menuItemId: objectIdSchema,
  orderedIds: z.array(objectIdSchema).min(1),
});

export const variantMutationInputSchema = menuVariantInputSchema;
export type VariantMutationInput = z.infer<typeof variantMutationInputSchema>;

export function firstZodMessage(result: {
  error: { issues: { message?: string }[] };
}): string {
  return result.error.issues[0]?.message ?? "Invalid input.";
}