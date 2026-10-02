import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

const menuCategorySchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
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
    displayOrder: {
      type: Number,
      default: 0,
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

menuCategorySchema.index({ restaurantId: 1, name: 1 });
menuCategorySchema.index({ restaurantId: 1, isActive: 1, displayOrder: 1 });

export type MenuCategory = InferSchemaType<typeof menuCategorySchema>;

export const MenuCategoryModel =
  (models.MenuCategory as Model<MenuCategory>) ||
  model<MenuCategory>("MenuCategory", menuCategorySchema);