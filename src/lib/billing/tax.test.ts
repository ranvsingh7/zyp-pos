import { describe, it, expect } from "vitest";
import {
  calculateBill,
  distributePaise,
  effectiveRateForDisplay,
  estimateTax,
  resolveComponentRates,
} from "./tax";

describe("distributePaise", () => {
  it("splits evenly across equal weights and sums exactly", () => {
    expect(distributePaise(5000, [1, 1, 1])).toEqual([1667, 1667, 1666]);
    const parts = distributePaise(1000, [3, 7]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts[1]).toBeGreaterThanOrEqual(parts[0]);
  });

  it("handles zero totals and empty lists", () => {
    expect(distributePaise(0, [1, 2, 3])).toEqual([0, 0, 0]);
    expect(distributePaise(100, [])).toEqual([]);
  });
});

const BASE = {
  discountPaise: 0,
  taxRatePercent: 5,
  taxInclusive: false,
  serviceChargeEnabled: false,
  serviceChargeRatePercent: 0,
  roundOffEnabled: false,
  gstScheme: "INTRA_STATE" as const,
  gstRegistered: true,
};

describe("calculateBill — tax-exclusive", () => {
  it("computes subtotal, GST split and grand total", () => {
    const out = calculateBill({
      ...BASE,
      items: [
        { unitPricePaise: 10000, quantity: 2 },
        { unitPricePaise: 0, quantity: 1 }, // free line
      ],
    });
    expect(out.subtotalPaise).toBe(20000);
    expect(out.taxableAmountPaise).toBe(20000);
    expect(out.cgstAmountPaise).toBe(500);
    expect(out.sgstAmountPaise).toBe(500);
    expect(out.igstAmountPaise).toBe(0);
    expect(out.totalTaxPaise).toBe(1000);
    expect(out.grandTotalPaise).toBe(21000);
    expect(out.items).toHaveLength(2);
  });

  it("uses IGST for inter-state sales", () => {
    const out = calculateBill({
      ...BASE,
      gstScheme: "INTER_STATE",
      items: [{ unitPricePaise: 20000, quantity: 1 }],
    });
    expect(out.cgstAmountPaise).toBe(0);
    expect(out.sgstAmountPaise).toBe(0);
    expect(out.igstAmountPaise).toBe(1000);
    expect(out.grandTotalPaise).toBe(21000);
  });

  it("shows a single tax line (no breakdown) when not GST-registered", () => {
    const out = calculateBill({
      ...BASE,
      gstRegistered: false,
      items: [{ unitPricePaise: 10000, quantity: 1 }],
    });
    expect(out.cgstAmountPaise).toBe(0);
    expect(out.sgstAmountPaise).toBe(0);
    expect(out.igstAmountPaise).toBe(0);
    expect(out.totalTaxPaise).toBe(500);
    expect(out.grandTotalPaise).toBe(10500);
  });

  it("applies order-level discount to the taxable value", () => {
    const out = calculateBill({
      ...BASE,
      discountPaise: 5000,
      items: [
        { unitPricePaise: 10000, quantity: 3 }, // subtotal 30000
      ],
    });
    expect(out.subtotalPaise).toBe(30000);
    expect(out.discountPaise).toBe(5000);
    expect(out.taxableAmountPaise).toBe(25000);
    expect(out.totalTaxPaise).toBe(1250);
    // CGST/SGST balance depends on per-line rounding of this odd tax amount.
    expect(out.cgstAmountPaise + out.sgstAmountPaise).toBe(1250);
    expect(out.grandTotalPaise).toBe(26250);
  });

  it("clamps discount at the subtotal (free bill)", () => {
    const out = calculateBill({
      ...BASE,
      discountPaise: 99999,
      items: [{ unitPricePaise: 10000, quantity: 1 }],
    });
    expect(out.discountPaise).toBe(10000);
    expect(out.taxableAmountPaise).toBe(0);
    expect(out.totalTaxPaise).toBe(0);
    expect(out.grandTotalPaise).toBe(0);
  });

  it("adds service charge on the pre-round sale value, then round-off", () => {
    const out = calculateBill({
      ...BASE,
      discountPaise: 5000,
      serviceChargeEnabled: true,
      serviceChargeRatePercent: 10,
      roundOffEnabled: true,
      items: [{ unitPricePaise: 10000, quantity: 3 }],
    });
    expect(out.taxableAmountPaise).toBe(25000);
    expect(out.totalTaxPaise).toBe(1250);
    expect(out.serviceChargeAmountPaise).toBe(2625);
    expect(out.roundOffAmountPaise).toBe(25); // 28875 -> 28900
    expect(out.grandTotalPaise).toBe(28900);
  });
});

describe("calculateBill — tax-inclusive", () => {
  const inclusive = { ...BASE, taxInclusive: true };

  it("derives the taxable base backwards so the bill keeps its GST", () => {
    const out = calculateBill({
      ...inclusive,
      items: [{ unitPricePaise: 10000, quantity: 2 }],
    });
    // 20000 * 100 / 105 = 19047.6 -> 19048 taxable, 952 tax
    expect(out.subtotalPaise).toBe(20000);
    expect(out.taxableAmountPaise).toBe(19048);
    expect(out.totalTaxPaise).toBe(952);
    expect(out.cgstAmountPaise).toBe(476);
    expect(out.sgstAmountPaise).toBe(476);
    expect(out.grandTotalPaise).toBe(20000);
  });

  it("zero rate keeps the full amount as taxable", () => {
    const out = calculateBill({
      ...inclusive,
      taxRatePercent: 0,
      items: [{ unitPricePaise: 15000, quantity: 1 }],
    });
    expect(out.taxableAmountPaise).toBe(15000);
    expect(out.totalTaxPaise).toBe(0);
    expect(out.grandTotalPaise).toBe(15000);
  });

  it("applies the order discount before inclusive GST", () => {
    const out = calculateBill({
      ...inclusive,
      discountPaise: 5000,
      items: [{ unitPricePaise: 10000, quantity: 2 }],
    });
    expect(out.subtotalPaise).toBe(20000);
    expect(out.discountPaise).toBe(5000);
    // 15000 * 100 / 105 = 14285.7 -> 14286 taxable, 714 tax
    expect(out.taxableAmountPaise).toBe(14286);
    expect(out.totalTaxPaise).toBe(714);
    expect(out.grandTotalPaise).toBe(15000);
  });
});

describe("calculateBill — column sums", () => {  it("line columns always add up to the bill totals", () => {
    const out = calculateBill({
      ...BASE,
      discountPaise: 3500,
      items: [
        { unitPricePaise: 12000, quantity: 2 },
        { unitPricePaise: 450, quantity: 7 },
        { unitPricePaise: 200, quantity: 1 },
      ],
    });
    const sum = (key: "taxableValuePaise" | "discountAmountPaise" | "cgstAmountPaise" | "sgstAmountPaise" | "igstAmountPaise" | "lineTotalPaise") =>
      out.items.reduce((total, item) => total + item[key], 0);
    expect(sum("taxableValuePaise")).toBe(out.taxableAmountPaise);
    expect(sum("discountAmountPaise")).toBe(out.discountPaise);
    expect(sum("cgstAmountPaise")).toBe(out.cgstAmountPaise);
    expect(sum("sgstAmountPaise")).toBe(out.sgstAmountPaise);
    expect(sum("igstAmountPaise")).toBe(out.igstAmountPaise);
    expect(sum("cgstAmountPaise") + sum("sgstAmountPaise") + sum("igstAmountPaise")).toBe(
      out.totalTaxPaise
    );
  });
});

describe("calculateBill — configurable component rates", () => {
  it("splits ₹1000 @ 5% into CGST ₹25 + SGST ₹25 = ₹1050", () => {
    const out = calculateBill({
      ...BASE,
      cgstRatePercent: 2.5,
      sgstRatePercent: 2.5,
      igstRatePercent: 5,
      items: [{ unitPricePaise: 100000, quantity: 1 }],
    });
    expect(out.subtotalPaise).toBe(100000);
    expect(out.cgstAmountPaise).toBe(2500);
    expect(out.sgstAmountPaise).toBe(2500);
    expect(out.igstAmountPaise).toBe(0);
    expect(out.totalTaxPaise).toBe(5000);
    expect(out.grandTotalPaise).toBe(105000);
    expect(out.cgstRatePercent).toBe(2.5);
    expect(out.sgstRatePercent).toBe(2.5);
    expect(out.igstRatePercent).toBe(5);
  });

  it("splits proportionally for asymmetric CGST/SGST rates", () => {
    const out = calculateBill({
      ...BASE,
      taxRatePercent: 4,
      cgstRatePercent: 1,
      sgstRatePercent: 3,
      items: [{ unitPricePaise: 10000, quantity: 1 }],
    });
    // 4% of 10000 = 400, weighted 1:3 -> 100 / 300.
    expect(out.totalTaxPaise).toBe(400);
    expect(out.cgstAmountPaise).toBe(100);
    expect(out.sgstAmountPaise).toBe(300);
    expect(out.grandTotalPaise).toBe(10400);
  });

  it("uses the configured IGST rate snapshot for inter-state sales", () => {
    const out = calculateBill({
      ...BASE,
      gstScheme: "INTER_STATE",
      taxRatePercent: 18,
      igstRatePercent: 18,
      items: [{ unitPricePaise: 100000, quantity: 1 }],
    });
    expect(out.igstAmountPaise).toBe(18000);
    expect(out.cgstAmountPaise).toBe(0);
    expect(out.sgstAmountPaise).toBe(0);
    expect(out.igstRatePercent).toBe(18);
    expect(out.grandTotalPaise).toBe(118000);
  });

  it("falls back to an equal split when component rates are absent (legacy)", () => {
    const out = calculateBill({
      ...BASE,
      items: [{ unitPricePaise: 100000, quantity: 1 }],
    });
    expect(out.cgstAmountPaise).toBe(2500);
    expect(out.sgstAmountPaise).toBe(2500);
    expect(out.cgstRatePercent).toBe(2.5);
    expect(out.sgstRatePercent).toBe(2.5);
    expect(out.igstRatePercent).toBe(5);
  });
});

describe("resolveComponentRates", () => {
  it("derives legacy fallbacks from the combined rate", () => {
    expect(resolveComponentRates({ taxRatePercent: 5 })).toEqual({
      cgstRatePercent: 2.5,
      sgstRatePercent: 2.5,
      igstRatePercent: 5,
    });
    expect(resolveComponentRates({ taxRatePercent: 0 })).toEqual({
      cgstRatePercent: 0,
      sgstRatePercent: 0,
      igstRatePercent: 0,
    });
  });

  it("prefers configured component rates", () => {
    expect(
      resolveComponentRates({
        taxRatePercent: 18,
        cgstRatePercent: 9,
        sgstRatePercent: 9,
        igstRatePercent: 18,
      })
    ).toEqual({ cgstRatePercent: 9, sgstRatePercent: 9, igstRatePercent: 18 });
  });
});

describe("estimateTax — display-only preview", () => {
  const config = {
    taxEnabled: true,
    taxRatePercent: 5,
    taxInclusive: false,
    gstScheme: "INTRA_STATE" as const,
    gstRegistered: true,
    cgstRatePercent: 2.5,
    sgstRatePercent: 2.5,
    igstRatePercent: 5,
  };

  it("previews CGST/SGST on a cart subtotal", () => {
    const est = estimateTax(100000, config);
    expect(est?.cgstAmountPaise).toBe(2500);
    expect(est?.sgstAmountPaise).toBe(2500);
    expect(est?.totalPaise).toBe(105000);
  });

  it("returns null when tax is disabled, zero-rated, or the cart is empty", () => {
    expect(estimateTax(100000, { ...config, taxEnabled: false })).toBeNull();
    expect(estimateTax(100000, { ...config, taxRatePercent: 0 })).toBeNull();
    expect(estimateTax(0, config)).toBeNull();
  });

  it("shows a single tax figure without breakdown when unregistered", () => {
    const est = estimateTax(100000, { ...config, gstRegistered: false });
    expect(est?.taxPaise).toBe(5000);
    expect(est?.cgstAmountPaise).toBe(0);
    expect(est?.sgstAmountPaise).toBe(0);
    expect(est?.igstAmountPaise).toBe(0);
  });
});

describe("calculateBill — per-line GST overrides", () => {
  it("taxes an overridden line at its own rate alongside the restaurant default", () => {
    const out = calculateBill({
      ...BASE,
      items: [
        { unitPricePaise: 10000, quantity: 1, taxRatePercent: 18 },
        { unitPricePaise: 10000, quantity: 1 },
      ],
    });
    expect(out.taxableAmountPaise).toBe(20000);
    expect(out.totalTaxPaise).toBe(2300); // 1000 @ 5% + 1000 @ 18%
    expect(out.items[0].taxRatePercent).toBe(18);
    expect(out.items[1].taxRatePercent).toBe(5);
    expect(out.cgstAmountPaise + out.sgstAmountPaise).toBe(2300);
    expect(out.grandTotalPaise).toBe(22300);
  });

  it("keeps the effective component split per overridden line", () => {
    const out = calculateBill({
      ...BASE,
      items: [
        {
          unitPricePaise: 10000,
          quantity: 1,
          taxRatePercent: 18,
          cgstRatePercent: 9,
          sgstRatePercent: 9,
        },
      ],
    });
    expect(out.cgstAmountPaise).toBe(900);
    expect(out.sgstAmountPaise).toBe(900);
    expect(out.igstAmountPaise).toBe(0);
    expect(out.totalTaxPaise).toBe(1800);
  });

  it("applies an inclusive override while default lines stay exclusive", () => {
    const out = calculateBill({
      ...BASE,
      items: [
        { unitPricePaise: 11800, quantity: 1, taxRatePercent: 18, taxInclusive: true },
        { unitPricePaise: 10000, quantity: 1 },
      ],
    });
    // 11800 inclusive of 18% -> taxable 10000 + tax 1800 embedded.
    expect(out.totalTaxPaise).toBe(2300);
    // Default exclusive line bills tax on top; inclusive line keeps its price.
    expect(out.grandTotalPaise).toBe(22300);
    expect(out.items[0].lineTotalPaise).toBe(11800);
    expect(out.items[1].lineTotalPaise).toBe(10500);
  });

  it("switches a single line to IGST while others stay intra-state", () => {
    const out = calculateBill({
      ...BASE,
      items: [
        {
          unitPricePaise: 20000,
          quantity: 1,
          taxRatePercent: 18,
          gstScheme: "INTER_STATE",
          igstRatePercent: 18,
        },
        { unitPricePaise: 10000, quantity: 1 },
      ],
    });
    expect(out.igstAmountPaise).toBe(3600);
    expect(out.cgstAmountPaise + out.sgstAmountPaise).toBe(500);
    expect(out.totalTaxPaise).toBe(4100);
  });

  it("allows a 0% override to tax that line as free of GST", () => {
    const out = calculateBill({
      ...BASE,
      items: [
        { unitPricePaise: 10000, quantity: 1, taxRatePercent: 0 },
        { unitPricePaise: 10000, quantity: 1 },
      ],
    });
    expect(out.totalTaxPaise).toBe(500);
    expect(out.grandTotalPaise).toBe(20500);
  });

  it("breaks column sums correctly across mixed-rate lines", () => {
    const out = calculateBill({
      ...BASE,
      discountPaise: 1000,
      items: [
        { unitPricePaise: 5000, quantity: 2, taxRatePercent: 18 },
        { unitPricePaise: 3000, quantity: 1 },
        { unitPricePaise: 700, quantity: 3, taxRatePercent: 12 },
      ],
    });
    const sum = (key: "taxableValuePaise" | "cgstAmountPaise" | "sgstAmountPaise" | "igstAmountPaise" | "lineTotalPaise") =>
      out.items.reduce((total, item) => total + item[key], 0);
    expect(sum("taxableValuePaise")).toBe(out.taxableAmountPaise);
    expect(sum("cgstAmountPaise")).toBe(out.cgstAmountPaise);
    expect(sum("sgstAmountPaise")).toBe(out.sgstAmountPaise);
    expect(sum("igstAmountPaise")).toBe(out.igstAmountPaise);
    expect(sum("cgstAmountPaise") + sum("sgstAmountPaise") + sum("igstAmountPaise")).toBe(
      out.totalTaxPaise
    );
    expect(sum("lineTotalPaise")).toBe(out.grandTotalPaise);
  });
});

describe("effectiveRateForDisplay", () => {
  it("derives the effective rate from actual amounts", () => {
    expect(effectiveRateForDisplay(900, 10000, 2.5)).toBe(9);
    expect(effectiveRateForDisplay(0, 10000, 2.5)).toBe(2.5);
    expect(effectiveRateForDisplay(0, 0, 2.5)).toBe(2.5);
  });
});