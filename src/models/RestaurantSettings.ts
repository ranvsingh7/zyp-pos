import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { GST_SCHEMES } from "@/lib/billing/constants";

const restaurantSettingsSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true,
    },
    currency: {
      type: String,
      default: "INR",
      enum: ["INR"],
    },
    defaultTaxRate: {
      // Combined GST rate driving the total tax. New restaurants default to
      // 5% (CGST 2.5 + SGST 2.5); the split weights live on the component
      // rates below so billing never hardcodes the split.
      type: Number,
      default: 5,
    },
    taxEnabled: {
      // Master switch: false forces zero tax regardless of the rates.
      type: Boolean,
      default: true,
    },
    cgstRatePercent: {
      type: Number,
      default: 2.5,
    },
    sgstRatePercent: {
      type: Number,
      default: 2.5,
    },
    igstRatePercent: {
      type: Number,
      default: 5,
    },
    taxInclusive: {
      type: Boolean,
      default: false,
    },
    gstScheme: {
      // CGST+SGST for intra-state sales, IGST for inter-state. Billing uses
      // this configured rule to split the GST on the bill.
      type: String,
      enum: GST_SCHEMES as unknown as string[],
      default: "INTRA_STATE",
    },
    serviceChargeEnabled: {
      type: Boolean,
      default: false,
    },
    serviceChargeRate: {
      type: Number,
      default: 0,
    },
    roundOffEnabled: {
      type: Boolean,
      default: false,
    },
    billPrefix: {
      type: String,
      default: "BILL",
    },
    kotPrefix: {
      type: String,
      default: "KOT",
    },
    purchasePrefix: {
      // Prefix for inventory purchase numbers (PUR-0001). Configurable.
      type: String,
      default: "PUR",
      trim: true,
      maxlength: 12,
    },
    upiId: {
      // Restaurant-level UPI handle (something@provider) used as the payee in
      // the bill's "Scan to Pay" QR. Stored here, on the existing
      // per-restaurant settings document, so it is isolated per tenant like
      // every other setting. Null/absent means no QR is printed at all.
      type: String,
      default: null,
      trim: true,
      maxlength: 256,
    },
  },
  {
    timestamps: true,
  }
);

export type RestaurantSettings = InferSchemaType<typeof restaurantSettingsSchema>;

export const RestaurantSettingsModel =
  (models.RestaurantSettings as Model<RestaurantSettings>) ||
  model<RestaurantSettings>("RestaurantSettings", restaurantSettingsSchema);