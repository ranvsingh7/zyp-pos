import { describe, it, expect } from "vitest";
import {
  rupeesToPaise,
  paiseToRupees,
  formatPaise,
  formatPriceRangePaise,
} from "@/lib/menu/prices";

describe("prices", () => {
  it("converts rupees to integer paise", () => {
    expect(rupeesToPaise(180)).toBe(18000);
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(180.5)).toBe(18050);
    expect(rupeesToPaise(0.5)).toBe(50);
  });

  it("rounds fractional paise", () => {
    expect(rupeesToPaise(10.005)).toBe(1001);
  });

  it("rejects non-finite input", () => {
    expect(() => rupeesToPaise(NaN as unknown as number)).toThrow();
    expect(() => rupeesToPaise(Infinity as unknown as number)).toThrow();
  });

  it("converts paise back to rupees", () => {
    expect(paiseToRupees(18000)).toBe(180);
    expect(paiseToRupees(18050)).toBe(180.5);
    expect(paiseToRupees(0)).toBe(0);
  });

  it("formats paise without trailing zeros", () => {
    expect(formatPaise(18000)).toBe("₹180");
    expect(formatPaise(2500)).toBe("₹25");
    expect(formatPaise(18050)).toBe("₹180.50");
  });

  it("formats price ranges", () => {
    expect(formatPriceRangePaise(null, null)).toBe("—");
    expect(formatPriceRangePaise(18000, 18000)).toBe("₹180");
    expect(formatPriceRangePaise(12000, 20000)).toBe("₹120 – ₹200");
  });
});