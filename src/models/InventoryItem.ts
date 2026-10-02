import {
  Schema,
  model,
  models,
  type Model,
  type InferSchemaType,
} from "mongoose";
import { INVENTORY_BASE_UNITS, INVENTORY_UNITS } from "@/lib/inventory/constants";

/**
 * A stocked ingredient / consumable.
 *
 * Stock balances are stored in `baseUnit` as integers (rounded). `unit` is the
 * display / purchase unit the restaurant thinks in. `costPricePaise` is the
 * cost of ONE base unit in integer paise (e.g. ₹280 per KG -> 28 paise per G),
 * which keeps inventory value = currentStock * costPricePaise.
 */
const inventoryItemSchema = new Schema(
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
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "InventoryCategory",
      default: null,
    },
    /** Display / purchase unit. */
    unit: {
      type: String,
      enum: INVENTORY_UNITS as unknown as string[],
      required: true,
    },
    /** Canonical unit stock is stored in. */
    baseUnit: {
      type: String,
      enum: INVENTORY_BASE_UNITS as unknown as string[],
      required: true,
    },
    /** Current stock in `baseUnit` (integer). */
    currentStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Reorder threshold in `baseUnit` (integer). */
    minimumStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Cost of one `baseUnit` in integer paise. */
    costPricePaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    sku: {
      type: String,
      trim: true,
      default: null,
      maxlength: 40,
    },
    isActive: {
      type: Boolean,
      default: true,
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

inventoryItemSchema.index({ restaurantId: 1, name: 1 });
inventoryItemSchema.index({ restaurantId: 1, isActive: 1 });
inventoryItemSchema.index({ restaurantId: 1, categoryId: 1 });
inventoryItemSchema.index({ restaurantId: 1, currentStock: 1 });
inventoryItemSchema.index(
  { restaurantId: 1, sku: 1 },
  {
    unique: true,
    partialFilterExpression: { sku: { $type: "string" } },
  }
);

export type InventoryItem = InferSchemaType<typeof inventoryItemSchema>;

export const InventoryItemModel =
  (models.InventoryItem as Model<InventoryItem>) ||
  model<InventoryItem>("InventoryItem", inventoryItemSchema);
