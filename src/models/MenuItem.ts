import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { HSN_SAC_CODE_MAX } from "@/lib/menu/constants";
import { taxOverrideSchema } from "./tax-override";

const menuItemSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "MenuCategory",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    itemType: {
      type: String,
      enum: ["FOOD", "BEVERAGE", "OTHER"],
      default: "FOOD",
    },
    vegType: {
      type: String,
      enum: ["VEG", "NON_VEG", "EGG", "NA"],
      default: "VEG",
    },
    imageUrl: {
      type: String,
      trim: true,
      default: null,
    },
    hasVariants: {
      type: Boolean,
      default: false,
    },
    hsnSacCode: {
      // Optional HSN (goods) / SAC (services) code entered by the restaurant.
      // Purely restaurant-configured: never generated, never looked up against
      // a bundled code list. Snapshotted onto orders and bills so later menu
      // edits never rewrite history. Hidden in the UI for non-GST restaurants.
      type: String,
      trim: true,
      default: null,
      maxlength: HSN_SAC_CODE_MAX,
    },
    basePrice: {
      // Integer paise (e.g. 180 INR -> 18000). null when hasVariants is true.
      type: Number,
      default: null,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    taxOverride: {
      type: taxOverrideSchema,
      default: () => ({
        enabled: false,
        taxRatePercent: null,
        taxMode: null,
        taxType: null,
      }),
    },
  },
  {
    timestamps: true,
  }
);

menuItemSchema.index({ restaurantId: 1, categoryId: 1 });
menuItemSchema.index({ restaurantId: 1, name: 1 });
menuItemSchema.index({ restaurantId: 1, isActive: 1 });
menuItemSchema.index({ restaurantId: 1, isAvailable: 1 });

export type MenuItem = InferSchemaType<typeof menuItemSchema>;

export const MenuItemModel =
  (models.MenuItem as Model<MenuItem>) ||
  model<MenuItem>("MenuItem", menuItemSchema);