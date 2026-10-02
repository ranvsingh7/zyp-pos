import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { TABLE_STATUSES, type TableStatus } from "@/lib/tables/constants";

const tablePositionSchema = new Schema(
  {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  { _id: false }
);

const restaurantTableSchema = new Schema(
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
    capacity: {
      type: Number,
      required: true,
      min: 1,
      max: 20,
    },
    sectionId: {
      type: Schema.Types.ObjectId,
      ref: "TableSection",
      default: null,
    },
    status: {
      type: String,
      enum: TABLE_STATUSES as unknown as string[],
      default: "AVAILABLE",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    // Reserved for the future floor-plan drag/drop editor. Not used yet.
    position: {
      type: tablePositionSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

restaurantTableSchema.index({ restaurantId: 1 });
restaurantTableSchema.index({ restaurantId: 1, name: 1 });
restaurantTableSchema.index({ restaurantId: 1, sectionId: 1 });
restaurantTableSchema.index({ restaurantId: 1, status: 1 });
restaurantTableSchema.index({ restaurantId: 1, isActive: 1 });

export type RestaurantTable = InferSchemaType<typeof restaurantTableSchema>;

export const RestaurantTableModel =
  (models.RestaurantTable as Model<RestaurantTable>) ||
  model<RestaurantTable>("RestaurantTable", restaurantTableSchema);

export function isTableStatus(value: unknown): value is TableStatus {
  return (
    typeof value === "string" &&
    (TABLE_STATUSES as readonly string[]).includes(value)
  );
}