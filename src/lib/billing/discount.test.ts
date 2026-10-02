import { describe, it, expect } from "vitest";
import { resolveBillDiscount } from "@/lib/billing/discount";
import { BillValidationError } from "@/lib/billing/errors";

describe("resolveBillDiscount", () => {
  it("resolves a percentage discount against the subtotal", () => {
    const resolved = resolveBillDiscount(20000, {
      discountType: "PERCENTAGE",
      discountValue: 10,
      discountReason: "Festival offer",
    });
    expect(resolved).toEqual({
      discountPaise: 2000,
      discountType: "PERCENTAGE",
      discountValue: 10,
      discountReason: "Festival offer",
    });
  });

  it("resolves a fixed rupee discount to paise", () => {
    const resolved = resolveBillDiscount(20000, {
      discountType: "FIXED",
      discountValue: 15,
    });
    expect(resolved.discountPaise).toBe(1500);
    expect(resolved.discountType).toBe("FIXED");
  });

  it("returns a zero discount for an absent input", () => {
    expect(resolveBillDiscount(20000, {})).toEqual({
      discountPaise: 0,
      discountType: null,
      discountValue: null,
      discountReason: null,
    });
  });

  it("treats an explicit null type as no discount", () => {
    const resolved = resolveBillDiscount(20000, {
      discountType: null,
      discountValue: null,
      discountReason: null,
    });
    expect(resolved.discountPaise).toBe(0);
    expect(resolved.discountReason).toBeNull();
  });

  it("rejects a percentage over 100", () => {
    expect(() =>
      resolveBillDiscount(20000, {
        discountType: "PERCENTAGE",
        discountValue: 101,
      })
    ).toThrow(BillValidationError);
  });

  it("rejects a fixed discount above the subtotal (not clamped)", () => {
    expect(() =>
      resolveBillDiscount(5000, { discountType: "FIXED", discountValue: 60 })
    ).toThrow(BillValidationError);
  });

  it("clamps a legacy absolute-paise discount defensively", () => {
    expect(resolveBillDiscount(5000, { discountPaise: 99999 }).discountPaise).toBe(5000);
    expect(resolveBillDiscount(5000, { discountPaise: -5 }).discountPaise).toBe(0);
  });
});