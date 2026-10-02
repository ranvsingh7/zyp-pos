import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { businessTypes } from "@/lib/business-types";
import { LOGO_MIME_TYPES } from "@/lib/settings/constants";

/**
 * Logo is stored as binary on the restaurant itself (never an external URL):
 * the bytes live in MongoDB and are only ever served back through the
 * authenticated /api/settings/logo route, so a tenant can never point the app
 * at a third-party host.
 */
const restaurantLogoSchema = new Schema(
  {
    data: {
      type: Buffer,
      required: true,
    },
    mimeType: {
      type: String,
      enum: LOGO_MIME_TYPES as unknown as string[],
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const restaurantSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      required: true,
      trim: true,
    },
    pincode: {
      type: String,
      required: true,
      trim: true,
    },
    gstRegistered: {
      type: Boolean,
      default: false,
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    businessType: {
      type: String,
      enum: businessTypes,
      required: true,
    },
    logoUrl: {
      type: String,
      trim: true,
      default: null,
    },
    logo: {
      type: restaurantLogoSchema,
      default: null,
      // Read `logo.data` only through `toLogoBuffer()` in settings-service.
      // `.lean()` yields a mongodb-driver `Binary`, which is NOT a Node Buffer:
      // `Buffer.from(binary)` silently produces a 0-length buffer rather than
      // throwing, so a naive read looks like "no logo" and the file is lost.
      // Hydrated documents do convert to a real Buffer, so lean and hydrated
      // reads of the same row return different types — hence the helper.
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

restaurantSchema.index({ ownerId: 1 }, { unique: true });
restaurantSchema.index({ name: 1 });

export type Restaurant = InferSchemaType<typeof restaurantSchema>;

export const RestaurantModel =
  (models.Restaurant as Model<Restaurant>) ||
  model<Restaurant>("Restaurant", restaurantSchema);