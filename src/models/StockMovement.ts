import {
  Schema,
  model,
  models,
  type Model,
  type InferSchemaType,
} from "mongoose";
import {
  INVENTORY_UNITS,
  STOCK_MOVEMENT_REFERENCE_TYPES,
  STOCK_MOVEMENT_TYPES,
} from "@/lib/inventory/constants";

/**
 * Append-only stock ledger. Every change to `InventoryItem.currentStock` must
 * create exactly one movement. Movements are never updated or deleted.
 *
 * `quantity` / `unit` preserve what the user entered; `baseQuantity` is the
 * magnitude in the item's base unit and `beforeStock` / `afterStock` are base
 * unit balances. `direction` is derived from `type` and stored for filtering.
 */
const stockMovementSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    inventoryItemId: {
      type: Schema.Types.ObjectId,
      ref: "InventoryItem",
      required: true,
    },
    /** Frozen item name, so history survives renames. */
    itemNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: STOCK_MOVEMENT_TYPES as unknown as string[],
      required: true,
    },
    direction: {
      type: String,
      enum: ["IN", "OUT"],
      required: true,
    },
    /** Magnitude entered by the user, always positive, in `unit`. */
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Magnitude converted to base unit, always positive (integer). */
    baseQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      enum: INVENTORY_UNITS as unknown as string[],
      required: true,
    },
    /** Balance in base unit before / after this movement. */
    beforeStock: {
      type: Number,
      required: true,
      min: 0,
    },
    afterStock: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Rate per entered `unit` in paise, when the movement came from a purchase. */
    ratePaise: {
      type: Number,
      default: null,
      min: 0,
    },
    referenceType: {
      type: String,
      enum: STOCK_MOVEMENT_REFERENCE_TYPES as unknown as string[],
      required: true,
    },
    referenceId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
      maxlength: 120,
    },
    note: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

stockMovementSchema.index({
  restaurantId: 1,
  inventoryItemId: 1,
  createdAt: -1,
});
stockMovementSchema.index({ restaurantId: 1, type: 1, createdAt: -1 });
stockMovementSchema.index({ restaurantId: 1, createdAt: -1 });
stockMovementSchema.index({ restaurantId: 1, createdBy: 1, createdAt: -1 });

export type StockMovement = InferSchemaType<typeof stockMovementSchema>;

export const StockMovementModel =
  (models.StockMovement as Model<StockMovement>) ||
  model<StockMovement>("StockMovement", stockMovementSchema);
