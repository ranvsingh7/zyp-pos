import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { MENU_SIZE_UNITS } from "@/lib/menu/constants";
import { taxOverrideSchema } from "./tax-override";

const menuVariantSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    menuItemId: {
      type: Schema.Types.ObjectId,
      ref: "MenuItem",
      required: true,
    },
    name: {
      // Machine id of the variant (uppercased), e.g. "HALF", "200ML".
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      uppercase: true,
    },
    displayName: {
      // Human label, e.g. "Half", "200 ml".
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    price: {
      // Integer paise (e.g. 180 INR -> 18000).
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    sku: {
      type: String,
      trim: true,
      default: null,
    },
    sizeValue: {
      type: Number,
      default: null,
      min: 0,
    },
    sizeUnit: {
      type: String,
      enum: MENU_SIZE_UNITS,
      default: null,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
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

menuVariantSchema.index({ restaurantId: 1, menuItemId: 1 });
menuVariantSchema.index({ restaurantId: 1, menuItemId: 1, name: 1 });

export type MenuVariant = InferSchemaType<typeof menuVariantSchema>;

export const MenuVariantModel =
  (models.MenuVariant as Model<MenuVariant>) ||
  model<MenuVariant>("MenuVariant", menuVariantSchema);