import type { GstScheme } from "./constants";

export const TAX_MODES = ["INCLUSIVE", "EXCLUSIVE"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_TYPES = ["CGST_SGST", "IGST"] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  INCLUSIVE: "Inclusive",
  EXCLUSIVE: "Exclusive",
};

export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  CGST_SGST: "CGST + SGST",
  IGST: "IGST",
};

export interface TaxOverrideConfig {
  enabled: boolean;
  taxRatePercent: number | null;
  taxMode: TaxMode | null;
  taxType: TaxType | null;
}

export const EMPTY_TAX_OVERRIDE: TaxOverrideConfig = {
  enabled: false,
  taxRatePercent: null,
  taxMode: null,
  taxType: null,
};

export interface RestaurantTaxDefaults {
  taxRatePercent: number;
  taxInclusive: boolean;
  gstScheme: GstScheme;
}

export interface ResolvedLineTax {
  taxRatePercent: number;
  taxInclusive: boolean;
  gstScheme: GstScheme;
}

/**
 * GST registration is the master control on taxation: without it, tax is
 * never applicable no matter what the settings say. Everything else
 * (menus, rate presets, overrides) is irrelevant until the restaurant is
 * registered AND tax is enabled.
 */
export function resolveEffectiveTaxEnabled(
  taxEnabled: boolean | null | undefined,
  gstRegistered: boolean | null | undefined
): boolean {
  return Boolean(taxEnabled) && Boolean(gstRegistered);
}

export function normalizeTaxOverride(
  input: Partial<TaxOverrideConfig> | null | undefined
): TaxOverrideConfig {
  const enabled = Boolean(input?.enabled);
  if (!enabled) return { ...EMPTY_TAX_OVERRIDE };
  return {
    enabled: true,
    taxRatePercent:
      typeof input?.taxRatePercent === "number" && Number.isFinite(input.taxRatePercent)
        ? input.taxRatePercent
        : null,
    taxMode:
      input?.taxMode === "INCLUSIVE" || input?.taxMode === "EXCLUSIVE"
        ? input.taxMode
        : null,
    taxType:
      input?.taxType === "CGST_SGST" || input?.taxType === "IGST" ? input.taxType : null,
  };
}

/**
 * Resolves the effective tax for a line using the priority
 * variant override > item override > restaurant default.
 */
export function resolveTaxConfig(
  restaurant: RestaurantTaxDefaults,
  item?: Partial<TaxOverrideConfig> | null,
  variant?: Partial<TaxOverrideConfig> | null
): ResolvedLineTax {
  const itemConfig = normalizeTaxOverride(item);
  const variantConfig = normalizeTaxOverride(variant);
  const chosen = variantConfig.enabled
    ? variantConfig
    : itemConfig.enabled
      ? itemConfig
      : null;
  if (!chosen) {
    return {
      taxRatePercent: restaurant.taxRatePercent,
      taxInclusive: restaurant.taxInclusive,
      gstScheme: restaurant.gstScheme,
    };
  }
  return {
    taxRatePercent: chosen.taxRatePercent ?? restaurant.taxRatePercent,
    taxInclusive:
      chosen.taxMode === "INCLUSIVE"
        ? true
        : chosen.taxMode === "EXCLUSIVE"
          ? false
          : restaurant.taxInclusive,
    gstScheme:
      chosen.taxType === "CGST_SGST"
        ? "INTRA_STATE"
        : chosen.taxType === "IGST"
          ? "INTER_STATE"
          : restaurant.gstScheme,
  };
}

export interface LineComponentRates {
  cgstRatePercent: number;
  sgstRatePercent: number;
  igstRatePercent: number;
}

/**
 * Maps a resolved combined rate + scheme to component rates used to split GST.
 * CGST+SGST lines split following the restaurant's configured component ratio
 * scaled to this line's combined rate (e.g. a 2.5/2.5 restaurant setting and an
 * 18% override produce 9/9). IGST lines carry the whole rate as IGST.
 */
export function resolveLineComponentRates(
  line: ResolvedLineTax,
  restaurantComponents: {
    cgstRatePercent: number | null;
    sgstRatePercent: number | null;
    igstRatePercent: number | null;
  }
): LineComponentRates {
  const rate = Math.max(0, line.taxRatePercent);
  if (line.gstScheme === "INTER_STATE") {
    return { cgstRatePercent: 0, sgstRatePercent: 0, igstRatePercent: rate };
  }
  const cgst = Math.max(0, restaurantComponents.cgstRatePercent ?? 0);
  const sgst = Math.max(0, restaurantComponents.sgstRatePercent ?? 0);
  if (cgst + sgst > 0) {
    return {
      cgstRatePercent: round2(rate * (cgst / (cgst + sgst))),
      sgstRatePercent: round2(rate * (sgst / (cgst + sgst))),
      igstRatePercent: 0,
    };
  }
  return { cgstRatePercent: round2(rate / 2), sgstRatePercent: round2(rate / 2), igstRatePercent: 0 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}