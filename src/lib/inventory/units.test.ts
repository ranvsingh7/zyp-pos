import { describe, it, expect } from "vitest";
import {
  baseUnitFor,
  conversionFactor,
  convertQuantity,
  formatQuantity,
  formatStockQuantity,
  fromBaseQuantity,
  isUnitCompatibleWithBase,
  ratePerBasePaise,
  ratePerUnitPaise,
  stockStatusFor,
  toBaseQuantity,
} from "@/lib/inventory/units";

describe("inventory unit conversion", () => {
  it("maps display units to their base unit", () => {
    expect(baseUnitFor("KG")).toBe("G");
    expect(baseUnitFor("G")).toBe("G");
    expect(baseUnitFor("L")).toBe("ML");
    expect(baseUnitFor("ML")).toBe("ML");
    expect(baseUnitFor("DOZEN")).toBe("PCS");
    expect(baseUnitFor("PCS")).toBe("PCS");
    expect(baseUnitFor("PACK")).toBe("PACK");
    expect(baseUnitFor("BOX")).toBe("BOX");
  });

  it("converts within a family and rejects cross-family conversions", () => {
    expect(conversionFactor("KG", "G")).toBe(1000);
    expect(conversionFactor("G", "KG")).toBe(0.001);
    expect(conversionFactor("L", "ML")).toBe(1000);
    expect(conversionFactor("DOZEN", "PCS")).toBe(12);
    expect(conversionFactor("KG", "ML")).toBeNull();
    expect(conversionFactor("L", "PCS")).toBeNull();
    expect(conversionFactor("PACK", "BOX")).toBeNull();
    expect(convertQuantity(2, "KG", "G")).toBe(2000);
    expect(convertQuantity(2, "KG", "ML")).toBeNull();
  });

  it("rounds base quantities to whole base units", () => {
    expect(toBaseQuantity(12, "KG")).toBe(12000);
    expect(toBaseQuantity(0.5, "KG")).toBe(500);
    expect(toBaseQuantity(2, "DOZEN")).toBe(24);
    expect(fromBaseQuantity(12000, "KG")).toBe(12);
    expect(fromBaseQuantity(500, "KG")).toBe(0.5);
  });

  it("checks base-unit compatibility (accepts equivalent display units)", () => {
    expect(isUnitCompatibleWithBase("G", "KG")).toBe(true);
    expect(isUnitCompatibleWithBase("G", "G")).toBe(true);
    expect(isUnitCompatibleWithBase("G", "L")).toBe(false);
    expect(isUnitCompatibleWithBase("PCS", "DOZEN")).toBe(true);
    expect(isUnitCompatibleWithBase("PCS", "KG")).toBe(false);
  });

  it("converts cost between base and display units", () => {
    // ₹280 per KG -> 28 paise per G
    expect(ratePerBasePaise(28000, "KG")).toBe(28);
    expect(ratePerUnitPaise(28, "KG")).toBe(28000);
    expect(ratePerBasePaise(2500, "PCS")).toBe(2500);
  });

  it("formats stock quantities with unit labels", () => {
    expect(formatStockQuantity(12000, "KG")).toBe("12 kg");
    expect(formatStockQuantity(500, "KG")).toBe("0.5 kg");
    expect(formatQuantity(10, "KG")).toBe("10 kg");
    expect(formatQuantity(500, "G")).toBe("500 g");
  });

  it("derives stock status from balances", () => {
    expect(stockStatusFor(0, 5)).toBe("OUT_OF_STOCK");
    expect(stockStatusFor(3, 5)).toBe("LOW_STOCK");
    expect(stockStatusFor(5, 5)).toBe("LOW_STOCK");
    expect(stockStatusFor(10, 5)).toBe("IN_STOCK");
    expect(stockStatusFor(1, 0)).toBe("IN_STOCK");
  });
});
