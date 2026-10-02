import { z } from "zod";
import {
  INVENTORY_CATEGORY_NAME_MAX,
  INVENTORY_ITEM_DESCRIPTION_MAX,
  INVENTORY_ITEM_NAME_MAX,
  INVENTORY_NOTE_MAX,
  INVENTORY_SKU_MAX,
  INVENTORY_SUPPLIER_MAX,
  INVENTORY_INVOICE_MAX,
  INVENTORY_UNITS,
} from "@/lib/inventory/constants";

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const inventoryObjectIdSchema = z
  .string()
  .trim()
  .refine((v) => OBJECT_ID_REGEX.test(v), { message: "Invalid identifier." });

const optionalObjectId = z
  .union([z.string().trim(), z.null()])
  .optional()
  .refine(
    (v) => v === undefined || v === null || v === "" || OBJECT_ID_REGEX.test(v),
    { message: "Invalid identifier." }
  )
  .transform((v) => (v === "" || v === undefined || v === null ? null : v))
  .optional();

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => {
      const text = typeof v === "string" ? v.trim() : "";
      return text.length ? text.slice(0, max) : null;
    })
    .optional();

const nonNegativeMoney = z.coerce
  .number()
  .finite({ message: "Enter a valid amount." })
  .min(0, { message: "Amount cannot be negative." });

export const inventoryCategoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Category name is required." })
    .max(INVENTORY_CATEGORY_NAME_MAX, {
      message: `Category name must be ${INVENTORY_CATEGORY_NAME_MAX} characters or fewer.`,
    }),
  displayOrder: z.coerce.number().int().nonnegative().optional(),
  isActive: z.boolean().default(true),
});

export const inventoryCategoryUpdateSchema = inventoryCategoryInputSchema.extend(
  { id: inventoryObjectIdSchema }
);

export const inventoryItemInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Item name is required." })
    .max(INVENTORY_ITEM_NAME_MAX, {
      message: `Item name must be ${INVENTORY_ITEM_NAME_MAX} characters or fewer.`,
    }),
  description: optionalText(INVENTORY_ITEM_DESCRIPTION_MAX),
  categoryId: optionalObjectId,
  unit: z.enum(INVENTORY_UNITS, { message: "Select a valid unit." }),
  minimumStock: z.coerce
    .number()
    .finite({ message: "Enter a valid minimum stock." })
    .min(0, { message: "Minimum stock cannot be negative." }),
  costPriceRupees: nonNegativeMoney,
  sku: optionalText(INVENTORY_SKU_MAX),
  isActive: z.boolean().default(true),
});

export const inventoryItemUpdateSchema = inventoryItemInputSchema.extend({
  id: inventoryObjectIdSchema,
});

export const inventoryItemActivationSchema = z.object({
  id: inventoryObjectIdSchema,
  isActive: z.boolean(),
});

export const purchaseLineInputSchema = z.object({
  inventoryItemId: inventoryObjectIdSchema,
  quantity: z.coerce
    .number()
    .finite({ message: "Enter a valid quantity." })
    .positive({ message: "Quantity must be greater than zero." }),
  unit: z.enum(INVENTORY_UNITS, { message: "Select a valid unit." }),
  purchaseRateRupees: nonNegativeMoney,
});

export const purchaseInputSchema = z.object({
  supplierName: optionalText(INVENTORY_SUPPLIER_MAX),
  invoiceNumber: optionalText(INVENTORY_INVOICE_MAX),
  purchaseDate: z.coerce.date().optional(),
  items: z
    .array(purchaseLineInputSchema)
    .min(1, { message: "Add at least one item to the purchase." }),
  notes: optionalText(INVENTORY_NOTE_MAX),
  idempotencyKey: optionalText(120),
});

const movementBaseSchema = z.object({
  itemId: inventoryObjectIdSchema,
  quantity: z.coerce
    .number()
    .finite({ message: "Enter a valid quantity." })
    .positive({ message: "Quantity must be greater than zero." }),
  unit: z.enum(INVENTORY_UNITS, { message: "Select a valid unit." }),
  reason: z
    .string()
    .trim()
    .min(1, { message: "Reason is required." })
    .max(120, { message: "Reason must be 120 characters or fewer." }),
  note: optionalText(INVENTORY_NOTE_MAX),
});

export const stockAdjustmentSchema = movementBaseSchema.extend({
  mode: z.enum(["ADD", "REMOVE"]),
});

export const stockWastageSchema = movementBaseSchema;
export const stockConsumptionSchema = movementBaseSchema;

export type InventoryItemInput = z.infer<typeof inventoryItemInputSchema>;
export type InventoryItemUpdateInput = z.infer<
  typeof inventoryItemUpdateSchema
>;
export type InventoryCategoryInput = z.infer<
  typeof inventoryCategoryInputSchema
>;
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type StockWastageInput = z.infer<typeof stockWastageSchema>;
export type StockConsumptionInput = z.infer<typeof stockConsumptionSchema>;

export function firstZodMessage(result: {
  error: { issues?: { message?: string }[] };
}): string {
  return result.error.issues?.[0]?.message ?? "Invalid input.";
}
