import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { SUBSCRIPTION_HISTORY_ACTIONS } from "@/lib/admin/constants";

export type SubscriptionHistoryAction = (typeof SUBSCRIPTION_HISTORY_ACTIONS)[number];

/**
 * Immutable ledger of every meaningful subscription change. The `from` block
 * preserves the previous financial/period state verbatim (old plan, old price,
 * old dates) so "2025-26 PRO ₹7,999 → 2026-27 PRO ₹9,999" is never overwritten
 * — each change appends a new row with full before/after snapshots.
 */
const subscriptionHistorySchema = new Schema(
  {
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    action: {
      type: String,
      enum: SUBSCRIPTION_HISTORY_ACTIONS as unknown as string[],
      required: true,
    },
    /** Snapshot of the subscription BEFORE the change (may be null for CREATED). */
    from: {
      planName: { type: String, default: null },
      planId: { type: Schema.Types.ObjectId, default: null },
      listPricePaise: { type: Number, default: null },
      discountAmountPaise: { type: Number, default: null },
      finalPricePaise: { type: Number, default: null },
      startDate: { type: Date, default: null },
      expiryDate: { type: Date, default: null },
    },
    /** Snapshot of the subscription AFTER the change. */
    to: {
      planName: { type: String, default: null },
      planId: { type: Schema.Types.ObjectId, default: null },
      listPricePaise: { type: Number, default: null },
      discountAmountPaise: { type: Number, default: null },
      finalPricePaise: { type: Number, default: null },
      startDate: { type: Date, default: null },
      expiryDate: { type: Date, default: null },
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    changedByRole: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    changedAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    timestamps: true,
  }
);

subscriptionHistorySchema.index({ subscriptionId: 1, createdAt: -1 });
subscriptionHistorySchema.index({ restaurantId: 1, createdAt: -1 });

export type SubscriptionHistory = InferSchemaType<
  typeof subscriptionHistorySchema
>;

export const SubscriptionHistoryModel =
  (models.SubscriptionHistory as Model<SubscriptionHistory>) ||
  model<SubscriptionHistory>("SubscriptionHistory", subscriptionHistorySchema);