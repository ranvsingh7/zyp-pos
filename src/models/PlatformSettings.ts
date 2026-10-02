import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/** Fixed document _id for the singleton platform settings document. */
export const PLATFORM_SETTINGS_ID = "platform-settings";

/**
 * Platform-wide SaaS defaults managed by a SUPER_ADMIN. A single document with
 * a fixed _id keeps reads O(1) and prevents duplicate settings rows.
 */
const platformSettingsSchema = new Schema(
  {
    _id: { type: String, required: true },
    /** Default number of days for a trial subscription. */
    trialDurationDays: {
      type: Number,
      default: 14,
      min: 0,
      max: 365,
    },
    /** Days before expiry that a subscription is flagged EXPIRING. */
    expiryWarningDays: {
      type: Number,
      default: 7,
      min: 0,
      max: 90,
    },
    /** Days of grace after expiry before a subscription is EXPIRED. */
    gracePeriodDays: {
      type: Number,
      default: 7,
      min: 0,
      max: 90,
    },
    /** IANA timezone used to display subscription dates in the admin panel. */
    timezone: {
      type: String,
      default: "Asia/Kolkata",
      trim: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export type PlatformSettings = InferSchemaType<typeof platformSettingsSchema>;

export const PlatformSettingsModel =
  (models.PlatformSettings as Model<PlatformSettings>) ||
  model<PlatformSettings>("PlatformSettings", platformSettingsSchema);