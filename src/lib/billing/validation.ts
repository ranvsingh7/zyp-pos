import { z } from "zod";
import { OBJECT_ID_REGEX } from "@/lib/menu/constants";
import {
  DISCOUNT_PERCENT_MAX,
  DISCOUNT_TYPES,
  ORDER_DISCOUNT_REASON_MAX,
} from "@/lib/orders/constants";
import {
  BILL_CANCEL_REASON_MAX,
  BILL_NUMBER_SEARCH_MAX,
  BILL_PAYMENT_METHODS,
  BILL_PAYMENT_NOTE_MAX,
  BILL_PAYMENT_REFERENCE_MAX,
  BILL_STATUSES,
} from "./constants";

export const objectIdSchema = z
  .string()
  .trim()
  .refine((v) => OBJECT_ID_REGEX.test(v), { error: "Invalid identifier." });

const billDiscountTypeSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.enum(DISCOUNT_TYPES).optional().nullable()
);

const billDiscountValueSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.coerce.number().min(0, "Discount cannot be negative.").optional().nullable()
);

const billDiscountReasonSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string()
    .trim()
    .max(ORDER_DISCOUNT_REASON_MAX, {
      error: `Must be ${ORDER_DISCOUNT_REASON_MAX} characters or fewer.`,
    })
    .optional()
    .nullable()
);

export const billDiscountFields = {
  discountType: billDiscountTypeSchema,
  discountValue: billDiscountValueSchema,
  discountReason: billDiscountReasonSchema,
} as const;

const methodSchema = z.enum(BILL_PAYMENT_METHODS);
const statusFilterSchema = z
  .enum(BILL_STATUSES)
  .optional()
  .or(z.literal(""));

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, "Idempotency key cannot be empty.")
  .max(100, "Idempotency key is too long.")
  .optional()
  .or(z.literal(""));

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength, { error: `Must be ${maxLength} characters or fewer.` })
    .optional()
    .or(z.literal(""));

export const generateBillInputSchema = z
  .object({
    orderId: objectIdSchema,
    ...billDiscountFields,
  })
  .superRefine((data, ctx) => {
    if (
      data.discountType === "PERCENTAGE" &&
      data.discountValue != null &&
      data.discountValue > DISCOUNT_PERCENT_MAX
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["discountValue"],
        message: "Discount percentage cannot exceed 100%.",
      });
    }
  });
export type GenerateBillInput = z.infer<typeof generateBillInputSchema>;

export const billIdInputSchema = z.object({ billId: objectIdSchema });
export type BillIdInput = z.infer<typeof billIdInputSchema>;

export const recordPaymentInputSchema = z.object({
  billId: objectIdSchema,
  method: methodSchema,
  amountPaise: z.coerce
    .number()
    .int("Amount must be a whole number of paise.")
    .min(1, "Enter an amount greater than zero."),
  referenceNumber: optionalText(BILL_PAYMENT_REFERENCE_MAX),
  note: optionalText(BILL_PAYMENT_NOTE_MAX),
  idempotencyKey: idempotencyKeySchema,
});
export type RecordPaymentInput = z.infer<typeof recordPaymentInputSchema>;

export const completePaymentInputSchema = z.object({
  billId: objectIdSchema,
  method: methodSchema,
  referenceNumber: optionalText(BILL_PAYMENT_REFERENCE_MAX),
  note: optionalText(BILL_PAYMENT_NOTE_MAX),
  idempotencyKey: idempotencyKeySchema,
});
export type CompletePaymentInput = z.infer<typeof completePaymentInputSchema>;

export const cancelBillInputSchema = z.object({
  billId: objectIdSchema,
  reason: optionalText(BILL_CANCEL_REASON_MAX),
});
export type CancelBillInput = z.infer<typeof cancelBillInputSchema>;

export const listBillsInputSchema = z.object({
  status: statusFilterSchema,
  search: optionalText(BILL_NUMBER_SEARCH_MAX),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListBillsInput = z.infer<typeof listBillsInputSchema>;

export function firstZodMessage(result: {
  error: { issues: { message?: string }[] };
}): string {
  return result.error.issues[0]?.message ?? "Invalid input.";
}