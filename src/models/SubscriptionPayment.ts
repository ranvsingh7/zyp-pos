import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { SUBSCRIPTION_PAYMENT_METHODS, SUBSCRIPTION_PAYMENT_STATUSES } from "@/lib/admin/constants";

export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

/**
 * Platform subscription payment ledger. This is independent of the restaurant
 * billing Payment model — it records what the restaurant paid ZYP POS for its
 * SaaS subscription. Payments are manually recorded by a SUPER_ADMIN today; the
 * shape is ready for an automated payment gateway (reference/status/method).
 */
const subscriptionPaymentSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
    },
    /** Platform invoice number, e.g. SUB-000042. Unique across tenants. */
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: SUBSCRIPTION_PAYMENT_METHODS as unknown as string[],
      required: true,
    },
    transactionReference: {
      type: String,
      trim: true,
      default: null,
    },
    periodStartDate: { type: Date, default: null },
    periodEndDate: { type: Date, default: null },
    status: {
      type: String,
      enum: SUBSCRIPTION_PAYMENT_STATUSES as unknown as string[],
      default: "PENDING",
    },
    paidAt: { type: Date, default: null },
    note: {
      type: String,
      trim: true,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionPaymentSchema.index({ restaurantId: 1, paidAt: -1 });
subscriptionPaymentSchema.index({ subscriptionId: 1, createdAt: 1 });
subscriptionPaymentSchema.index({ status: 1, paidAt: -1 });
// A bank/UPI reference must identify exactly one payment across the platform.
// The partial filter indexes only real string references, so the many
// `transactionReference: null` rows are not treated as duplicates of each other.
subscriptionPaymentSchema.index(
  { transactionReference: 1 },
  {
    unique: true,
    partialFilterExpression: { transactionReference: { $type: "string" } },
    name: "subscription_payment_reference_unique",
  }
);

export type SubscriptionPayment = InferSchemaType<
  typeof subscriptionPaymentSchema
>;

export const SubscriptionPaymentModel =
  (models.SubscriptionPayment as Model<SubscriptionPayment>) ||
  model<SubscriptionPayment>("SubscriptionPayment", subscriptionPaymentSchema);