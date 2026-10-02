import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import {
  BILL_PAYMENT_METHODS,
  BILL_PAYMENT_NOTE_MAX,
  BILL_PAYMENT_REFERENCE_MAX,
} from "@/lib/billing/constants";

/**
 * An immutable record of one payment received against a bill. A bill can have
 * many payments (split / partial payments). Payments are append-only: money is
 * never edited or deleted, only reversed via a future credit note / refund.
 */
const paymentSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    billId: {
      type: Schema.Types.ObjectId,
      ref: "Bill",
      required: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    method: {
      type: String,
      enum: BILL_PAYMENT_METHODS as unknown as string[],
      required: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
    },
    referenceNumber: {
      type: String,
      trim: true,
      default: null,
      maxlength: BILL_PAYMENT_REFERENCE_MAX,
    },
    note: {
      type: String,
      trim: true,
      default: null,
      maxlength: BILL_PAYMENT_NOTE_MAX,
    },
    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /**
     * Optional client-supplied idempotency key. Unique per restaurant so a
     * double-submit (double click / retry) can never record the same payment
     * twice.
     */
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

paymentSchema.index({ restaurantId: 1, billId: 1, createdAt: -1 });
paymentSchema.index({ restaurantId: 1, createdAt: -1 });
paymentSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);

export type Payment = InferSchemaType<typeof paymentSchema>;
export type PaymentDocument = Payment & { _id: unknown };

export const PaymentModel =
  (models.Payment as Model<Payment>) || model<Payment>("Payment", paymentSchema);
