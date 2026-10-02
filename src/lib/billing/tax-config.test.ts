import { describe, it, expect } from "vitest";
import {
  EMPTY_TAX_OVERRIDE,
  normalizeTaxOverride,
  resolveEffectiveTaxEnabled,
  resolveLineComponentRates,
  resolveTaxConfig,
} from "./tax-config";

const RESTAURANT = {
  taxRatePercent: 5,
  taxInclusive: false,
  gstScheme: "INTRA_STATE" as const,
};

describe("normalizeTaxOverride", () => {
  it("defaults to an empty override", () => {
    expect(normalizeTaxOverride(undefined)).toEqual(EMPTY_TAX_OVERRIDE);
    expect(normalizeTaxOverride({ enabled: false })).toEqual(EMPTY_TAX_OVERRIDE);
    expect(normalizeTaxOverride(null)).toEqual(EMPTY_TAX_OVERRIDE);
  });

  it("normalizes a full override", () => {
    expect(
      normalizeTaxOverride({ enabled: true, taxRatePercent: 18, taxMode: "EXCLUSIVE", taxType: "IGST" })
    ).toEqual({ enabled: true, taxRatePercent: 18, taxMode: "EXCLUSIVE", taxType: "IGST" });
  });
});

describe("resolveEffectiveTaxEnabled — GST registration is the master control", () => {
  it("requires both GST registration and tax enabled", () => {
    expect(resolveEffectiveTaxEnabled(true, true)).toBe(true);
    expect(resolveEffectiveTaxEnabled(false, true)).toBe(false);
    expect(resolveEffectiveTaxEnabled(true, false)).toBe(false);
    expect(resolveEffectiveTaxEnabled(false, false)).toBe(false);
  });

  it("treats nullish inputs as disabled", () => {
    expect(resolveEffectiveTaxEnabled(undefined, true)).toBe(false);
    expect(resolveEffectiveTaxEnabled(true, undefined)).toBe(false);
    expect(resolveEffectiveTaxEnabled(null, null)).toBe(false);
  });
});

describe("resolveTaxConfig — priority variant > item > restaurant", () => {
  it("inherits restaurant defaults for a legacy item with no overrides", () => {
    expect(resolveTaxConfig(RESTAURANT, undefined, undefined)).toEqual(RESTAURANT);
    expect(
      resolveTaxConfig(RESTAURANT, { enabled: false }, { enabled: false })
    ).toEqual(RESTAURANT);
  });

  it("honors the item override when there is no variant override", () => {
    const resolved = resolveTaxConfig(
      RESTAURANT,
      { enabled: true, taxRatePercent: 18, taxMode: "INCLUSIVE", taxType: "IGST" },
      undefined
    );
    expect(resolved).toEqual({
      taxRatePercent: 18,
      taxInclusive: true,
      gstScheme: "INTER_STATE",
    });
  });

  it("prefers the variant override over the item override", () => {
    const resolved = resolveTaxConfig(
      RESTAURANT,
      { enabled: true, taxRatePercent: 18, taxMode: "EXCLUSIVE", taxType: "CGST_SGST" },
      { enabled: true, taxRatePercent: 12, taxMode: "INCLUSIVE", taxType: "IGST" }
    );
    expect(resolved).toEqual({
      taxRatePercent: 12,
      taxInclusive: true,
      gstScheme: "INTER_STATE",
    });
  });

  it("falls back to the item when the variant override is disabled", () => {
    const resolved = resolveTaxConfig(
      RESTAURANT,
      { enabled: true, taxRatePercent: 18, taxMode: "EXCLUSIVE", taxType: "CGST_SGST" },
      { enabled: false, taxRatePercent: 12, taxMode: "INCLUSIVE", taxType: "IGST" }
    );
    expect(resolved.taxRatePercent).toBe(18);
    expect(resolved.taxInclusive).toBe(false);
    expect(resolved.gstScheme).toBe("INTRA_STATE");
  });

  it("falls back individual fields of a partial override to the restaurant", () => {
    const resolved = resolveTaxConfig(
      RESTAURANT,
      { enabled: true, taxRatePercent: 18, taxMode: null, taxType: null },
      undefined
    );
    expect(resolved.taxRatePercent).toBe(18);
    expect(resolved.taxInclusive).toBe(false); // from restaurant
    expect(resolved.gstScheme).toBe("INTRA_STATE"); // from restaurant
  });
});

describe("resolveLineComponentRates", () => {
  const restaurant = { cgstRatePercent: 2.5, sgstRatePercent: 2.5, igstRatePercent: 5 };

  it("scales the CGST/SGST split to the overridden combined rate", () => {
    expect(
      resolveLineComponentRates(
        { taxRatePercent: 18, taxInclusive: false, gstScheme: "INTRA_STATE" },
        restaurant
      )
    ).toEqual({ cgstRatePercent: 9, sgstRatePercent: 9, igstRatePercent: 0 });
  });

  it("keeps the whole IGST rate on IGST lines", () => {
    expect(
      resolveLineComponentRates(
        { taxRatePercent: 18, taxInclusive: false, gstScheme: "INTER_STATE" },
        restaurant
      )
    ).toEqual({ cgstRatePercent: 0, sgstRatePercent: 0, igstRatePercent: 18 });
  });

  it("preserves asymmetric restaurant ratios when scaling", () => {
    expect(
      resolveLineComponentRates(
        { taxRatePercent: 4, taxInclusive: false, gstScheme: "INTRA_STATE" },
        { cgstRatePercent: 1, sgstRatePercent: 3, igstRatePercent: 4 }
      )
    ).toEqual({ cgstRatePercent: 1, sgstRatePercent: 3, igstRatePercent: 0 });
  });
});