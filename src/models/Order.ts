import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import {
  DISCOUNT_TYPES,
  ORDER_TYPES,
  ORDER_STATUSES,
  ORDER_ITEM_MAX_QUANTITY,
  ORDER_ITEM_NOTE_MAX,
  ORDER_NOTE_MAX,
  ORDER_CUSTOMER_NAME_MAX,
  ORDER_CUSTOMER_PHONE_MAX,
  ORDER_CANCEL_REASON_MAX,
  ORDER_DISCOUNT_REASON_MAX,
} from "@/lib/orders/constants";
import { HSN_SAC_CODE_MAX } from "@/lib/menu/constants";

const orderItemSchema = new Schema(
  {
    menuItemId: {
      type: Schema.Types.ObjectId,
      ref: "MenuItem",
      required: true,
    },
    nameSnapshot: {
      // Name of the menu item captured when the line was added/saved so
      // historical orders stay readable even if the menu later changes.
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "MenuVariant",
      default: null,
    },
    variantNameSnapshot: {
      type: String,
      trim: true,
      default: null,
      maxlength: 100,
    },
    hsnSacCode: {
      // HSN/SAC copied from the menu item when the line was added/saved, so a
      // later menu edit cannot rewrite what this order was sold under.
      type: String,
      trim: true,
      default: null,
      maxlength: HSN_SAC_CODE_MAX,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: ORDER_ITEM_MAX_QUANTITY,
    },
    unitPricePaise: {
      // Integer paise captured from the Menu at add time. The POS never
      // trusts a price sent from the browser.
      type: Number,
      required: true,
      min: 0,
    },
    note: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_ITEM_NOTE_MAX,
    },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    orderNumber: {
      // Human-friendly sequential number unique per restaurant, e.g. 1001.
      type: Number,
      required: true,
      min: 1,
    },
    orderType: {
      type: String,
      enum: ORDER_TYPES as unknown as string[],
      required: true,
    },
    status: {
      type: String,
      enum: ORDER_STATUSES as unknown as string[],
      default: "OPEN",
    },
    tableId: {
      type: Schema.Types.ObjectId,
      ref: "RestaurantTable",
      default: null,
    },
    tableNameSnapshot: {
      type: String,
      trim: true,
      default: null,
      maxlength: 50,
    },
    customerName: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_CUSTOMER_NAME_MAX,
    },
    customerPhone: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_CUSTOMER_PHONE_MAX,
    },
    items: {
      type: [orderItemSchema],
      default: [],
    },
    totalPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    discountPaise: {
      // Order-level discount applied at billing time (default 0). Never
      // exceeds totalPaise; validated server-side.
      type: Number,
      default: 0,
      min: 0,
    },
    discountType: {
      // Human-readable kind captured when the discount was applied
      // ("PERCENTAGE" | "FIXED"). Null for legacy absolute-paise discounts.
      type: String,
      enum: DISCOUNT_TYPES as unknown as string[],
      default: null,
    },
    discountValue: {
      // The entered value in discountType units: percent for PERCENTAGE,
      // rupees for FIXED. Mirrors what cashier chose, stored for the bill.
      type: Number,
      default: null,
      min: 0,
    },
    discountReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_DISCOUNT_REASON_MAX,
    },
    orderNote: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_NOTE_MAX,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    heldAt: {
      type: Date,
      default: null,
    },
    resumedAt: {
      type: Date,
      default: null,
    },
    sentToKitchenAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_CANCEL_REASON_MAX,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ restaurantId: 1, createdAt: -1 });
// Unique per restaurant: a concurrent create (two staff, two tabs) must never
// mint the same sequential order number. The service re-mints on conflict.
orderSchema.index({ restaurantId: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ restaurantId: 1, status: 1 });
orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, orderType: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, tableId: 1, status: 1 });
orderSchema.index({ restaurantId: 1, tableId: 1, createdAt: -1 });
// Reporting: cancellation windows.
orderSchema.index({ restaurantId: 1, status: 1, cancelledAt: -1 });

export type OrderItem = InferSchemaType<typeof orderItemSchema>;
export type Order = InferSchemaType<typeof orderSchema>;
export type OrderDocument = Order & { _id: unknown };

export const OrderModel =
  (models.Order as Model<Order>) || model<Order>("Order", orderSchema);