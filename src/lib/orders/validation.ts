import { z } from "zod";
import { OBJECT_ID_REGEX } from "@/lib/menu/constants";
import {
  KOT_CANCELLATION_REASON_MAX,
  ORDER_CANCEL_REASON_MAX,
  ORDER_CUSTOMER_NAME_MAX,
  ORDER_CUSTOMER_PHONE_MAX,
  ORDER_ITEM_MAX_QUANTITY,
  ORDER_ITEM_NOTE_MAX,
  ORDER_MAX_ITEMS,
  ORDER_NOTE_MAX,
  ORDER_TYPES,
} from "./constants";

export const objectIdSchema = z
  .string()
  .trim()
  .refine((v) => OBJECT_ID_REGEX.test(v), { error: "Invalid identifier." });

export const orderItemLineSchema = z.object({
  menuItemId: objectIdSchema,
  variantId: objectIdSchema.optional(),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(ORDER_ITEM_MAX_QUANTITY, "Quantity is too large."),
  note: z
    .string()
    .trim()
    .max(ORDER_ITEM_NOTE_MAX, `Note must be ${ORDER_ITEM_NOTE_MAX} characters or fewer.`)
    .optional()
    .or(z.literal("")),
});

export type OrderItemLineInput = z.infer<typeof orderItemLineSchema>;

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength, { error: `Must be ${maxLength} characters or fewer.` })
    .optional()
    .or(z.literal(""));

export const createOrderInputSchema = z
  .object({
    orderType: z.enum(ORDER_TYPES),
    tableId: objectIdSchema.optional(),
    customerName: optionalText(ORDER_CUSTOMER_NAME_MAX),
    customerPhone: optionalText(ORDER_CUSTOMER_PHONE_MAX),
    orderNote: optionalText(ORDER_NOTE_MAX),
    items: z.array(orderItemLineSchema).min(1, "Add at least one item.").max(ORDER_MAX_ITEMS),
  })
  .superRefine((data, ctx) => {
    if (data.orderType === "DINE_IN" && !data.tableId) {
      ctx.addIssue({
        code: "custom",
        path: ["tableId"],
        message: "Select a table for a dine-in order.",
      });
    }
    if (data.orderType !== "DINE_IN" && data.tableId) {
      ctx.addIssue({
        code: "custom",
        path: ["tableId"],
        message: "A table can only be selected for dine-in orders.",
      });
    }
  });

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

export const updateOrderInputSchema = z.object({
  orderId: objectIdSchema,
  customerName: optionalText(ORDER_CUSTOMER_NAME_MAX),
  customerPhone: optionalText(ORDER_CUSTOMER_PHONE_MAX),
  orderNote: optionalText(ORDER_NOTE_MAX),
  items: z.array(orderItemLineSchema).min(1, "Add at least one item.").max(ORDER_MAX_ITEMS),
});

export type UpdateOrderInput = z.infer<typeof updateOrderInputSchema>;

export const holdOrderInputSchema = z.object({ orderId: objectIdSchema });
export const resumeOrderInputSchema = z.object({ orderId: objectIdSchema });
export const sendOrderToKitchenInputSchema = z.object({ orderId: objectIdSchema });

export const printKotInputSchema = z.object({ orderId: objectIdSchema });
export type PrintKotInput = z.infer<typeof printKotInputSchema>;

export const kotIdInputSchema = z.object({ kotId: objectIdSchema });
export type KotIdInput = z.infer<typeof kotIdInputSchema>;

export const cancelKotInputSchema = z.object({
  kotId: objectIdSchema,
  reason: z
    .string()
    .trim()
    .max(
      KOT_CANCELLATION_REASON_MAX,
      `Reason must be ${KOT_CANCELLATION_REASON_MAX} characters or fewer.`
    )
    .optional()
    .or(z.literal("")),
});
export type CancelKotInput = z.infer<typeof cancelKotInputSchema>;

export const kotListInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type KotListInput = z.infer<typeof kotListInputSchema>;

export const cancelOrderInputSchema = z.object({
  orderId: objectIdSchema,
  reason: z
    .string()
    .trim()
    .max(ORDER_CANCEL_REASON_MAX, `Reason must be ${ORDER_CANCEL_REASON_MAX} characters or fewer.`)
    .optional()
    .or(z.literal("")),
});

export type CancelOrderInput = z.infer<typeof cancelOrderInputSchema>;

export const moveOrderInputSchema = z.object({
  orderId: objectIdSchema,
  destinationTableId: objectIdSchema,
});

export type MoveOrderInput = z.infer<typeof moveOrderInputSchema>;

export function firstZodMessage(result: {
  error: { issues: { message?: string }[] };
}): string {
  return result.error.issues[0]?.message ?? "Invalid input.";
}