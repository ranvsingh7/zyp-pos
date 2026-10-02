import { describe, it, expect } from "vitest";
import {
  computeOrderDiscountPaise,
  discountValueLabel,
} from "@/lib/orders/discount";

describe("computeOrderDiscountPaise", () => {
  it("computes a 10% discount on a subtotal", () => {
    expect(computeOrderDiscountPaise("PERCENTAGE", 10, 20000)).toBe(2000);
  });

  it("computes a fractional percent", () => {
    expect(computeOrderDiscountPaise("PERCENTAGE", 12.5, 20000)).toBe(2500);
  });

  it("returns 0 for a 0% discount", () => {
    expect(computeOrderDiscountPaise("PERCENTAGE", 0, 20000)).toBe(0);
  });

  it("clamps a 100% discount to the subtotal", () => {
    expect(computeOrderDiscountPaise("PERCENTAGE", 100, 20000)).toBe(20000);
  });

  it("converts a fixed rupee discount to paise", () => {
    expect(computeOrderDiscountPaise("FIXED", 5, 20000)).toBe(500);
  });

  it("handles fractional fixed rupees", () => {
    expect(computeOrderDiscountPaise("FIXED", 15.5, 20000)).toBe(1550);
  });

  it("clamps a fixed discount to the subtotal", () => {
    expect(computeOrderDiscountPaise("FIXED", 500, 20000)).toBe(20000);
  });

  it("returns 0 when the subtotal is empty", () => {
    expect(computeOrderDiscountPaise("PERCENTAGE", 10, 0)).toBe(0);
  });

  it("returns 0 for a non-finite value", () => {
    expect(computeOrderDiscountPaise("PERCENTAGE", Number.NaN, 20000)).toBe(0);
  });
});

describe("discountValueLabel", () => {
  it("labels a percentage", () => {
    expect(discountValueLabel("PERCENTAGE", 10)).toBe("10%");
  });

  it("labels a fixed amount in rupees", () => {
    expect(discountValueLabel("FIXED", 10)).toBe("₹10");
  });

  it("is empty when no discount", () => {
    expect(discountValueLabel(null, null)).toBe("");
  });
});