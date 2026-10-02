import {
  Schema,
  model,
  models,
  type Model,
  type InferSchemaType,
} from "mongoose";

const inventoryCategorySchema = new Schema(
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
      maxlength: 80,
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

inventoryCategorySchema.index({ restaurantId: 1, name: 1 });
inventoryCategorySchema.index({ restaurantId: 1, isActive: 1, displayOrder: 1 });

export type InventoryCategory = InferSchemaType<
  typeof inventoryCategorySchema
>;

export const InventoryCategoryModel =
  (models.InventoryCategory as Model<InventoryCategory>) ||
  model<InventoryCategory>("InventoryCategory", inventoryCategorySchema);
