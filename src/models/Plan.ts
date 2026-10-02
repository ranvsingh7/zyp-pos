import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { MAX_PLAN_GRACE_PERIOD_DAYS, PLAN_BILLING_CYCLES } from "@/lib/admin/constants";

/** Plan billing cycles available on the platform. */
export type PlanBillingCycle = (typeof PLAN_BILLING_CYCLES)[number];

const planSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    description: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
    /** Plan list price displayed in the storefront (integer paise). */
    pricePaise: {
      type: Number,
      required: true,
      min: 0,
    },
    billingCycle: {
      type: String,
      enum: PLAN_BILLING_CYCLES as unknown as string[],
      required: true,
    },
    /**
     * Duration of one paid period. Defaults are derived from billingCycle when
     * not explicitly set by an admin.
     */
    durationDays: {
      type: Number,
      required: true,
      min: 1,
    },
    /**
     * Days after expiry during which a restaurant on this plan may still
     * operate. Part of the plan so the access gate never needs a second source
     * of truth.
     */
    gracePeriodDays: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_PLAN_GRACE_PERIOD_DAYS,
    },
    /**
     * Free tier flag. A FREE plan is priced at ₹0, never requires payment and
     * is stored as a TRIAL subscription — it is a plan, not a separate
     * subscription system.
     */
    isFree: {
      type: Boolean,
      required: true,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** Feature checklist shown on the storefront / admin UI. */
    features: {
      type: [String],
      default: [],
    },
    /**
     * Service keys from the centralized catalog that this plan includes.
     *
     * Only keys, never display names: renaming a service in the catalog must
     * not invalidate the plans that already grant it.
     *
     * `[]` is a meaningful value here — a plan that includes no services — so
     * it differs from a plan document written before this field existed only
     * by absence, which the read path treats as "not configured yet".
     */
    serviceKeys: {
      type: [String],
      default: [],
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

planSchema.index({ name: 1 });
planSchema.index({ isActive: 1 });

export type Plan = InferSchemaType<typeof planSchema>;

export const PlanModel =
  (models.Plan as Model<Plan>) || model<Plan>("Plan", planSchema);