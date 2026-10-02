import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

const tableSectionSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
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

tableSectionSchema.index({ restaurantId: 1, name: 1 });
tableSectionSchema.index({ restaurantId: 1, displayOrder: 1 });

export type TableSection = InferSchemaType<typeof tableSectionSchema>;

export const TableSectionModel =
  (models.TableSection as Model<TableSection>) ||
  model<TableSection>("TableSection", tableSectionSchema);