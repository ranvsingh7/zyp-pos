import {
  Schema,
  model,
  models,
  type Model,
  type InferSchemaType,
} from "mongoose";
import { INVENTORY_UNITS } from "@/lib/inventory/constants";

const purchaseLineSchema = new Schema(
  {
    inventoryItemId: {
      type: Schema.Types.ObjectId,
      ref: "InventoryItem",
      required: true,
    },
    /** Frozen name at the time of purchase, so history survives renames. */
    itemNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    /** Quantity in the entered `unit`. */
    quantity: {
      type: Number,
      required: true,
      min: Number.EPSILON,
    },
    unit: {
      type: String,
      enum: INVENTORY_UNITS as unknown as string[],
      required: true,
    },
    /** Quantity converted to the item's base unit (integer). */
    baseQuantity: {
      type: Number,
      required: true,
      min: 1,
    },
    /** Purchase rate per entered `unit`, in integer paise. */
    purchaseRatePaise: {
      type: Number,
      required: true,
      min: 0,
    },
    /** quantity * purchaseRatePaise, in integer paise. */
    totalAmountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Stock in base unit before / after this line was posted. */
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
  },
  { _id: false }
);

export const PURCHASE_STATUSES = ["POSTED", "REVERSED"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

const purchaseSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    purchaseNumber: {
      type: String,
      required: true,
      trim: true,
    },
    purchaseSequence: {
      type: Number,
      required: true,
      min: 1,
    },
    supplierName: {
      type: String,
      trim: true,
      default: null,
      maxlength: 120,
    },
    invoiceNumber: {
      type: String,
      trim: true,
      default: null,
      maxlength: 80,
    },
    purchaseDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    items: {
      type: [purchaseLineSchema],
      required: true,
      validate: {
        validator: (value: unknown[]) => Array.isArray(value) && value.length > 0,
        message: "A purchase must contain at least one item.",
      },
    },
    subtotalPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: PURCHASE_STATUSES as unknown as string[],
      default: "POSTED",
    },
    /** Soft-reversal audit trail: a REVERSED purchase is never deleted. */
    reversedAt: {
      type: Date,
      default: null,
    },
    reversedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reversalReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: 300,
    },
    /** Unique per restaurant when present; guards double submission. */
    idempotencyKey: {
      type: String,
      default: null,
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

purchaseSchema.index({ restaurantId: 1, purchaseNumber: 1 }, { unique: true });
purchaseSchema.index({ restaurantId: 1, createdAt: -1 });
purchaseSchema.index({ restaurantId: 1, purchaseDate: -1 });
purchaseSchema.index({ restaurantId: 1, invoiceNumber: 1 });
purchaseSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);

export type Purchase = InferSchemaType<typeof purchaseSchema>;

export const PurchaseModel =
  (models.Purchase as Model<Purchase>) ||
  model<Purchase>("Purchase", purchaseSchema);
