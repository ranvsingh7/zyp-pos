import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { BILL_STATUSES } from "@/lib/billing/constants";
import { GST_SCHEMES } from "@/lib/billing/constants";
import { HSN_SAC_CODE_MAX } from "@/lib/menu/constants";
import {
  ORDER_TYPES,
  ORDER_CUSTOMER_NAME_MAX,
  ORDER_CUSTOMER_PHONE_MAX,
  DISCOUNT_TYPES,
  ORDER_DISCOUNT_REASON_MAX,
} from "@/lib/orders/constants";

const billItemSchema = new Schema(
  {
    menuItemId: {
      type: Schema.Types.ObjectId,
      ref: "MenuItem",
      required: true,
    },
    // Immutable snapshots. A bill must never change when the menu is edited
    // after the fact.
    nameSnapshot: { type: String, required: true, trim: true, maxlength: 100 },
    variantId: { type: Schema.Types.ObjectId, ref: "MenuVariant", default: null },
    variantNameSnapshot: { type: String, trim: true, default: null, maxlength: 100 },
    hsnSacCode: {
      // Carried over from the order line's snapshot. Never re-read from the
      // menu at print time — an edited menu item must not change a printed or
      // stored bill.
      type: String,
      trim: true,
      default: null,
      maxlength: HSN_SAC_CODE_MAX,
    },
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    taxableValuePaise: { type: Number, required: true, min: 0 },
    discountAmountPaise: { type: Number, default: 0, min: 0 },
    taxRatePercent: { type: Number, default: 0, min: 0 },
    cgstAmountPaise: { type: Number, default: 0, min: 0 },
    sgstAmountPaise: { type: Number, default: 0, min: 0 },
    igstAmountPaise: { type: Number, default: 0, min: 0 },
    lineTotalPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const billSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    orderNumber: { type: Number, required: true, min: 1 },
    orderType: {
      type: String,
      enum: ORDER_TYPES as unknown as string[],
      required: true,
    },
    // Human-facing sequential number unique per restaurant, e.g. BILL-000001.
    billNumber: { type: String, required: true, trim: true },
    billSequence: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: BILL_STATUSES as unknown as string[],
      default: "UNPAID",
    },
    // Financial-progress mirror of `status` (kept in sync by the service so
    // reporting can index one field).
    paymentStatus: {
      type: String,
      enum: BILL_STATUSES as unknown as string[],
      default: "UNPAID",
    },

    // Order context snapshot.
    tableId: { type: Schema.Types.ObjectId, ref: "RestaurantTable", default: null },
    tableNameSnapshot: { type: String, trim: true, default: null, maxlength: 50 },
    customerName: { type: String, trim: true, default: null, maxlength: ORDER_CUSTOMER_NAME_MAX },
    customerPhone: { type: String, trim: true, default: null, maxlength: ORDER_CUSTOMER_PHONE_MAX },

    items: { type: [billItemSchema], default: [] },

    // Money snapshot (integer paise).
    subtotalPaise: { type: Number, required: true, min: 0 },
    discountPaise: { type: Number, default: 0, min: 0 },
    discountType: {
      // Mirrors the order's discount snapshot: "PERCENTAGE" | "FIXED".
      type: String,
      enum: DISCOUNT_TYPES as unknown as string[],
      default: null,
    },
    discountValue: {
      // Discount in discountType units (percent or rupees) at bill time.
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
    taxableAmountPaise: { type: Number, required: true, min: 0 },
    cgstAmountPaise: { type: Number, default: 0, min: 0 },
    sgstAmountPaise: { type: Number, default: 0, min: 0 },
    igstAmountPaise: { type: Number, default: 0, min: 0 },
    totalTaxPaise: { type: Number, default: 0, min: 0 },

    // Tax configuration snapshot.
    taxRatePercent: { type: Number, default: 0, min: 0 },
    cgstRatePercent: { type: Number, default: 0, min: 0 },
    sgstRatePercent: { type: Number, default: 0, min: 0 },
    igstRatePercent: { type: Number, default: 0, min: 0 },
    taxInclusive: { type: Boolean, default: false },
    gstScheme: { type: String, enum: GST_SCHEMES as unknown as string[], default: "INTRA_STATE" },
    gstRegistered: { type: Boolean, default: false },
    gstin: { type: String, trim: true, default: null },

    serviceChargeEnabled: { type: Boolean, default: false },
    serviceChargeRatePercent: { type: Number, default: 0, min: 0 },
    serviceChargeAmountPaise: { type: Number, default: 0, min: 0 },
    roundOffEnabled: { type: Boolean, default: false },
    roundOffAmountPaise: { type: Number, default: 0 },

    grandTotalPaise: { type: Number, required: true, min: 0 },
    paidAmountPaise: { type: Number, default: 0, min: 0 },
    dueAmountPaise: { type: Number, required: true, min: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    paidAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, default: null, maxlength: 300 },

    printedAt: { type: Date, default: null },
    printedCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
  }
);

// One bill per order (idempotent generation) and one number per restaurant.
billSchema.index({ restaurantId: 1, orderId: 1 }, { unique: true });
billSchema.index({ restaurantId: 1, billNumber: 1 }, { unique: true });
billSchema.index({ restaurantId: 1, billSequence: 1 });
billSchema.index({ restaurantId: 1, createdAt: -1 });
billSchema.index({ restaurantId: 1, paymentStatus: 1 });
billSchema.index({ restaurantId: 1, status: 1 });
// Reporting: paid-bill sales/GST windows and cancellation windows.
billSchema.index({ restaurantId: 1, status: 1, paidAt: -1 });
billSchema.index({ restaurantId: 1, status: 1, cancelledAt: -1 });

export type BillItem = InferSchemaType<typeof billItemSchema>;
export type Bill = InferSchemaType<typeof billSchema>;
export type BillDocument = Bill & { _id: unknown };

export const BillModel =
  (models.Bill as Model<Bill>) || model<Bill>("Bill", billSchema);
