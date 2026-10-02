import { describe, it, expect } from "vitest";
import { menuItemInputSchema, menuVariantInputSchema } from "./validation";

const VALID_ITEM = {
  name: "Paneer Butter Masala",
  categoryId: "507f1f77bcf86cd799439011",
  itemType: "FOOD",
  vegType: "VEG",
  hasVariants: false,
  basePriceRupees: 180,
  isAvailable: true,
  isActive: true,
};

describe("taxOverrideInputSchema via menuItemInputSchema", () => {
  it("accepts a disabled override and defaults to empty", () => {
    const result = menuItemInputSchema.safeParse(VALID_ITEM);
    expect(result.success && result.data.taxOverride).toEqual({
      enabled: false,
      taxRatePercent: null,
      taxMode: null,
      taxType: null,
    });
  });

  it("accepts a complete CGST/SGST exclusive override", () => {
    const result = menuItemInputSchema.safeParse({
      ...VALID_ITEM,
      taxOverride: {
        enabled: true,
        taxRatePercent: 18,
        taxMode: "EXCLUSIVE",
        taxType: "CGST_SGST",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts all preset rates and custom rates up to 100", () => {
    for (const rate of [0, 5, 12, 18, 28, 100]) {
      const result = menuItemInputSchema.safeParse({
        ...VALID_ITEM,
        taxOverride: { enabled: true, taxRatePercent: rate, taxMode: "INCLUSIVE", taxType: "IGST" },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects rates above 100 and negative rates", () => {
    for (const rate of [101, -1]) {
      const result = menuItemInputSchema.safeParse({
        ...VALID_ITEM,
        taxOverride: { enabled: true, taxRatePercent: rate, taxMode: "EXCLUSIVE", taxType: "IGST" },
      });
      expect(result.success).toBe(false);
    }
  });

  it("requires rate/mode/type when the override is enabled", () => {
    const missingRate = menuItemInputSchema.safeParse({
      ...VALID_ITEM,
      taxOverride: { enabled: true, taxRatePercent: null, taxMode: "EXCLUSIVE", taxType: "IGST" },
    });
    expect(missingRate.success).toBe(false);

    const missingMode = menuItemInputSchema.safeParse({
      ...VALID_ITEM,
      taxOverride: { enabled: true, taxRatePercent: 18, taxMode: null, taxType: "IGST" },
    });
    expect(missingMode.success).toBe(false);

    const missingType = menuItemInputSchema.safeParse({
      ...VALID_ITEM,
      taxOverride: { enabled: true, taxRatePercent: 18, taxMode: "EXCLUSIVE", taxType: null },
    });
    expect(missingType.success).toBe(false);
  });

  it("rejects invalid enum values for mode and type", () => {
    const badMode = menuItemInputSchema.safeParse({
      ...VALID_ITEM,
      taxOverride: { enabled: true, taxRatePercent: 18, taxMode: "EXCLUSIVO", taxType: "IGST" },
    });
    expect(badMode.success).toBe(false);

    const badType = menuItemInputSchema.safeParse({
      ...VALID_ITEM,
      taxOverride: { enabled: true, taxRatePercent: 18, taxMode: "EXCLUSIVE", taxType: "CGST" },
    });
    expect(badType.success).toBe(false);
  });
});

describe("taxOverrideInputSchema via menuVariantInputSchema", () => {
  const VALID_VARIANT = {
    name: "Half",
    displayName: "Half",
    priceRupees: 100,
    sizeValue: 250,
    sizeUnit: "ML",
    isActive: true,
  };

  it("accepts a variant with a per-variant override", () => {
    const result = menuVariantInputSchema.safeParse({
      ...VALID_VARIANT,
      taxOverride: { enabled: true, taxRatePercent: 12, taxMode: "INCLUSIVE", taxType: "CGST_SGST" },
    });
    expect(result.success).toBe(true);
  });
});