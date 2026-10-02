import { Schema } from "mongoose";
import { TAX_MODES, TAX_TYPES } from "@/lib/billing/tax-config";

/**
 * Optional per-menu-item / per-menu-variant GST override. When `enabled` is
 * false the line inherits the restaurant defaults. Shared as an embedded
 * subdocument by MenuItem and MenuVariant.
 */
export const taxOverrideSchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },
    taxRatePercent: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    taxMode: {
      type: String,
      enum: TAX_MODES,
      default: null,
    },
    taxType: {
      type: String,
      enum: TAX_TYPES,
      default: null,
    },
  },
  { _id: false }
);