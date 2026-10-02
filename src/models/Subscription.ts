import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { SUBSCRIPTION_STATUSES, PLAN_BILLING_CYCLES } from "@/lib/admin/constants";

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const subscriptionSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    /**
     * Plan name as it was at the moment this subscription was priced. Editing
     * or renaming the plan later must not rewrite history.
     */
    planName: {
      type: String,
      trim: true,
      default: null,
    },
    /**
     * Plan duration snapshot (days). The expiry date below is always this
     * value added to the start date.
     *
     * Not `required`: subscriptions created before this snapshot existed have
     * no value here, and the read paths fall back to the stored start/expiry
     * pair. Every write goes through subscription-service, which always sets it
     * from the plan.
     */
    durationDays: {
      type: Number,
      min: 1,
    },
    /**
     * Plan grace period snapshot (days). The access gate reads this, never the
     * live plan, so a plan edit cannot silently widen a venue's access.
     *
     * Optional for the same reason as `durationDays`; the service always sets it.
     */
    gracePeriodDays: {
      type: Number,
      min: 0,
    },
    /** Plan tier snapshot: a free plan is stored as a TRIAL subscription. */
    isFree: {
      type: Boolean,
      default: false,
    },
    /**
     * The services this subscription was granted, frozen at issue time.
     *
     * This is the entitlement snapshot: editing the plan afterwards must not
     * silently widen or narrow a venue that has already been sold a term, and
     * an existing subscription must not be rewritten just because a new
     * service was added to the catalog. Only an explicit create, renew or
     * plan change writes it.
     *
     * `default: undefined` is load-bearing. Mongoose implicitly defaults an
     * array field to `[]`, which would erase the difference between "this
     * subscription was granted nothing" and "this subscription predates
     * service snapshots". With no default, a pre-migration document reads back
     * as `undefined` and the read path can apply the documented fallback
     * instead of silently locking a long-standing restaurant out of features
     * it has always had.
     */
    serviceKeys: {
      type: [String],
      default: undefined,
    },
    /** Plan list price at the moment the subscription is priced (paise). */
    listPricePaise: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Admin-approved discount off the list price (paise). */
    discountAmountPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** What the customer actually pays per period = list - discount (paise). */
    finalPricePaise: {
      type: Number,
      required: true,
      min: 0,
    },
    billingCycle: {
      type: String,
      enum: PLAN_BILLING_CYCLES as unknown as string[],
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES as unknown as string[],
      default: "TRIAL",
    },
    autoRenew: {
      type: Boolean,
      default: false,
    },
    /** What the displayed storefront price is anchored to when autoRenew. */
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /**
     * Set when a SUPER_ADMIN puts the subscription on hold, and cleared again
     * when it is resumed. The reason is also mirrored into the append-only
     * subscription history and the platform audit log, so this is a fast path
     * for showing "why is this venue blocked" on the admin card.
     */
    suspendedAt: {
      type: Date,
      default: null,
    },
    suspendedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    suspensionReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ restaurantId: 1 }, { unique: true });
subscriptionSchema.index({ restaurantId: 1, status: 1, expiryDate: 1 });
subscriptionSchema.index({ status: 1, expiryDate: 1 });
subscriptionSchema.index({ planId: 1 });
subscriptionSchema.index({ expiryDate: 1 });

export type Subscription = InferSchemaType<typeof subscriptionSchema>;

export const SubscriptionModel =
  (models.Subscription as Model<Subscription>) ||
  model<Subscription>("Subscription", subscriptionSchema);