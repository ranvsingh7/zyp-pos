import "server-only";

import { connectDB } from "@/lib/db";
import { RestaurantModel } from "@/models/Restaurant";
import {
  RestaurantSettingsModel,
  type RestaurantSettings,
} from "@/models/RestaurantSettings";
import { DEFAULT_TAX_CONFIG, type GstScheme } from "./constants";
import { resolveEffectiveTaxEnabled } from "./tax-config";

export interface TaxSettingsView {
  taxEnabled: boolean;
  defaultTaxRate: number;
  taxInclusive: boolean;
  gstScheme: GstScheme;
  cgstRatePercent: number;
  sgstRatePercent: number;
  igstRatePercent: number;
  gstRegistered: boolean;
}

/**
 * Server-side loader for a restaurant's tax configuration (POS estimate,
 * admin settings UI). Applies the same legacy fallbacks as bill generation:
 * settings documents written before per-component rates existed resolve to
 * the historical behavior (tax at defaultTaxRate, split equally).
 */
export async function getRestaurantTaxSettings(
  restaurantId: string
): Promise<TaxSettingsView> {
  await connectDB();
  const [settings, restaurant] = await Promise.all([
    RestaurantSettingsModel.findOne({ restaurantId }).lean(),
    RestaurantModel.findById(restaurantId).select("gstRegistered").lean(),
  ]);
  const doc = settings as unknown as RestaurantSettings | null;
  const defaultTaxRate = doc?.defaultTaxRate ?? DEFAULT_TAX_CONFIG.defaultTaxRate;
  const gstRegistered = restaurant?.gstRegistered ?? false;
  return {
    // GST registration is the master control on taxation: an unregistered
    // restaurant is always reported as tax-disabled.
    taxEnabled: resolveEffectiveTaxEnabled(
      doc?.taxEnabled ?? DEFAULT_TAX_CONFIG.taxEnabled,
      gstRegistered
    ),
    defaultTaxRate,
    taxInclusive: doc?.taxInclusive ?? false,
    gstScheme: (doc?.gstScheme as GstScheme | undefined) ?? "INTRA_STATE",
    cgstRatePercent: doc?.cgstRatePercent ?? defaultTaxRate / 2,
    sgstRatePercent: doc?.sgstRatePercent ?? defaultTaxRate / 2,
    igstRatePercent: doc?.igstRatePercent ?? defaultTaxRate,
    gstRegistered,
  };
}
