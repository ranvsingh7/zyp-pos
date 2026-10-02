import type { GstScheme } from "./constants";

/**
 * Pure billing arithmetic. All money is integer paise; this module never
 * rounds through float currency. It is a deterministic function of its inputs
 * so unit tests can lock the exact amounts a printed bill must show.
 *
 * Bill formula (single authoritative order):
 *   subtotal − discount = taxable
 *   + tax (GST) ± round-off + service charge = grand total
 *
 * Tax is always computed as a percentage of the taxable value:
 *   - tax-exclusive prices: tax = round(taxable * rate / 100), billed on top.
 *   - tax-inclusive prices: the item price already contains GST; the taxable
 *     base is derived backwards so the fixed tax component stays consistent:
 *     taxable = round(gross * 100 / (100 + rate)); tax = gross − taxable.
 *
 * GST is split CGST/SGST (intra-state) or IGST (inter-state) per the bill's
 * configured scheme and per-component rates. Restaurants that are not
 * GST-registered still record totalTaxPaise but get no CGST/SGST/IGST
 * breakdown on the bill.
 */

export interface BillLineInput {
  unitPricePaise: number;
  quantity: number;
  /**
   * Optional per-line GST override (e.g. from a menu item/variant tax
   * override). When set, these values replace the bill-level defaults for this
   * line only; omitted component rates fall back to the bill-level ones.
   */
  taxRatePercent?: number;
  taxInclusive?: boolean;
  gstScheme?: GstScheme;
  cgstRatePercent?: number | null;
  sgstRatePercent?: number | null;
  igstRatePercent?: number | null;
}

export interface CalculateBillInput {
  items: BillLineInput[];
  discountPaise: number;
  taxRatePercent: number;
  taxInclusive: boolean;
  serviceChargeEnabled: boolean;
  serviceChargeRatePercent: number;
  roundOffEnabled: boolean;
  gstScheme: GstScheme;
  gstRegistered: boolean;
  /**
   * Per-component GST rates from the restaurant's tax settings. Optional so
   * legacy callers keep working: when absent, the split falls back to the
   * combined rate (halved for CGST/SGST), exactly matching the old behavior.
   */
  cgstRatePercent?: number | null;
  sgstRatePercent?: number | null;
  igstRatePercent?: number | null;
}

export interface BillLineOutput {
  unitPricePaise: number;
  quantity: number;
  taxableValuePaise: number;
  discountAmountPaise: number;
  taxRatePercent: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  lineTotalPaise: number;
}

export interface CalculateBillOutput {
  subtotalPaise: number;
  discountPaise: number;
  taxableAmountPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  totalTaxPaise: number;
  serviceChargeAmountPaise: number;
  roundOffAmountPaise: number;
  grandTotalPaise: number;
  taxRatePercent: number;
  taxInclusive: boolean;
  /** Effective per-component rates used for the split (also bill snapshots). */
  cgstRatePercent: number;
  sgstRatePercent: number;
  igstRatePercent: number;
  items: BillLineOutput[];
}

/** Round to nearest whole rupee, i.e. nearest 100 paise. */
function roundToPaiseUnit(paise: number, unit = 100): number {
  return Math.round(paise / unit) * unit;
}

/**
 * Distributes an integer total across parts proportionally to `weights` using
 * the largest-remainder method. The returned parts are non-negative integers
 * that always sum exactly to `total`.
 */
export function distributePaise(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) {
    return weights.map(() => 0);
  }
  const exact = weights.map((w) => (w * total) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  const remainder = total - floors.reduce((sum, v) => sum + v, 0);
  const order = floors
    .map((_, index) => index)
    .sort((a, b) => exact[b] - floors[b] - (exact[a] - floors[a]));
  for (let i = 0; i < remainder; i++) {
    floors[order[i % order.length]] += 1;
  }
  return floors;
}

function splitGst(
  taxPaise: number,
  scheme: GstScheme,
  cgstRatePercent?: number | null,
  sgstRatePercent?: number | null
): { cgst: number; sgst: number; igst: number } {
  if (scheme === "INTER_STATE") {
    return { cgst: 0, sgst: 0, igst: taxPaise };
  }
  // Rate-driven CGST/SGST split: the configured component rates are the
  // weights, so custom rates (and the default 2.5/2.5) split proportionally.
  // Legacy callers pass no rates (both weights 0) and get the historical
  // equal half-split.
  const cgstWeight = Math.max(0, cgstRatePercent ?? 0);
  const sgstWeight = Math.max(0, sgstRatePercent ?? 0);
  if (cgstWeight + sgstWeight <= 0) {
    const cgst = Math.round(taxPaise / 2);
    return { cgst, sgst: taxPaise - cgst, igst: 0 };
  }
  const [cgst, sgst] = distributePaise(taxPaise, [cgstWeight, sgstWeight]);
  return { cgst, sgst, igst: 0 };
}

/** A finite, non-negative rate, or undefined when unset/invalid. */
function sanitizeRate(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export interface ComponentRatesInput {
  taxRatePercent: number;
  cgstRatePercent?: number | null;
  sgstRatePercent?: number | null;
  igstRatePercent?: number | null;
}

export interface ComponentRates {
  cgstRatePercent: number;
  sgstRatePercent: number;
  igstRatePercent: number;
}

/**
 * Resolves the effective per-component GST rates for a bill. Unset component
 * rates fall back to the combined rate (halved for CGST/SGST), so settings
 * documents written before per-component rates existed keep their exact
 * historical split.
 */
export function resolveComponentRates(input: ComponentRatesInput): ComponentRates {
  const combined = Math.max(0, input.taxRatePercent ?? 0);
  return {
    cgstRatePercent: sanitizeRate(input.cgstRatePercent) ?? combined / 2,
    sgstRatePercent: sanitizeRate(input.sgstRatePercent) ?? combined / 2,
    igstRatePercent: sanitizeRate(input.igstRatePercent) ?? combined,
  };
}

export interface TaxEstimateInput extends ComponentRatesInput {
  taxEnabled: boolean;
  taxInclusive: boolean;
  gstScheme: GstScheme;
  gstRegistered: boolean;
}

export interface TaxEstimate {
  taxablePaise: number;
  taxPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  /** What the guest would pay for the goods (subtotal + exclusive tax). */
  totalPaise: number;
  taxRatePercent: number;
  cgstRatePercent: number;
  sgstRatePercent: number;
  igstRatePercent: number;
}

/**
 * Display-only tax preview for a pre-discount subtotal (POS cart estimate).
 * Pure and client-safe. Returns null when no tax applies. Never writes to
 * stored order totals — callers render this as an estimate only.
 */
export function estimateTax(
  subtotalPaise: number,
  input: TaxEstimateInput
): TaxEstimate | null {
  if (!input.taxEnabled || subtotalPaise <= 0) return null;
  const combined = Math.max(0, input.taxRatePercent ?? 0);
  if (combined <= 0) return null;
  const rates = resolveComponentRates({ ...input, taxRatePercent: combined });
  const { taxablePaise, taxPaise } = calculateTaxBase(
    subtotalPaise,
    combined,
    input.taxInclusive
  );
  const split = input.gstRegistered
    ? splitGst(taxPaise, input.gstScheme, rates.cgstRatePercent, rates.sgstRatePercent)
    : { cgst: 0, sgst: 0, igst: 0 };
  return {
    taxablePaise,
    taxPaise,
    cgstAmountPaise: split.cgst,
    sgstAmountPaise: split.sgst,
    igstAmountPaise: split.igst,
    totalPaise: input.taxInclusive ? subtotalPaise : taxablePaise + taxPaise,
    taxRatePercent: combined,
    ...rates,
  };
}

/**
 * Display-only rate label for a tax row. Mixed-rate bills (per-line GST
 * overrides) share a snapshot of the restaurant default rates, so the label is
 * derived from the actual amounts to stay truthful; legacy/unaffected bills
 * keep the configured rate.
 */
export function effectiveRateForDisplay(
  amountPaise: number,
  taxablePaise: number,
  configuredRatePercent: number
): number {
  if (taxablePaise > 0 && amountPaise > 0) {
    const derived = (amountPaise / taxablePaise) * 100;
    if (derived > 0.01) return Math.round(derived * 100) / 100;
  }
  return configuredRatePercent;
}

export function calculateTaxBase(
  grossAfterDiscountPaise: number,
  taxRatePercent: number,
  taxInclusive: boolean
): { taxablePaise: number; taxPaise: number } {
  if (grossAfterDiscountPaise <= 0) {
    return { taxablePaise: 0, taxPaise: 0 };
  }
  if (taxRatePercent <= 0) {
    return {
      taxablePaise: taxInclusive ? grossAfterDiscountPaise : grossAfterDiscountPaise,
      taxPaise: 0,
    };
  }
  if (taxInclusive) {
    const taxable = Math.round((grossAfterDiscountPaise * 100) / (100 + taxRatePercent));
    return { taxablePaise: taxable, taxPaise: grossAfterDiscountPaise - taxable };
  }
  const taxable = grossAfterDiscountPaise;
  const tax = Math.round((taxable * taxRatePercent) / 100);
  return { taxablePaise: taxable, taxPaise: tax };
}

export function calculateBill(input: CalculateBillInput): CalculateBillOutput {
  interface EffectiveLineTax {
    taxRatePercent: number;
    taxInclusive: boolean;
    gstScheme: GstScheme;
    cgstRatePercent: number | null;
    sgstRatePercent: number | null;
    igstRatePercent: number | null;
    groupKey: string;
  }

  const grossLines = input.items.map((item) => ({
    grossPaise: item.unitPricePaise * item.quantity,
    unitPricePaise: item.unitPricePaise,
    quantity: item.quantity,
  }));
  const subtotalPaise = grossLines.reduce((sum, line) => sum + line.grossPaise, 0);
  const discountPaise = Math.max(0, Math.min(input.discountPaise, subtotalPaise));

  // Allocate the discount across lines so the printed table columns sum
  // exactly to the bill totals.
  const lineDiscounts = distributePaise(
    discountPaise,
    grossLines.map((l) => l.grossPaise)
  );
  const lineAfterDiscount = grossLines.map((l, index) => l.grossPaise - lineDiscounts[index]);

  // Resolve the effective tax per line (per-line override, else bill defaults)
  // and bucket lines with identical tax into groups. Each group is taxed with
  // the historical whole-bill formula, so unaffected bills stay byte-identical
  // while mixed-rate bills stay column-exact within each group.
  const effective: EffectiveLineTax[] = input.items.map((item) => {
    const taxRatePercent = item.taxRatePercent ?? input.taxRatePercent;
    const taxInclusive =
      typeof item.taxInclusive === "boolean" ? item.taxInclusive : input.taxInclusive;
    const gstScheme = item.gstScheme ?? input.gstScheme;
    const cgstRatePercent = item.cgstRatePercent ?? input.cgstRatePercent ?? null;
    const sgstRatePercent = item.sgstRatePercent ?? input.sgstRatePercent ?? null;
    const igstRatePercent = item.igstRatePercent ?? input.igstRatePercent ?? null;
    const groupKey = [
      taxRatePercent,
      taxInclusive,
      gstScheme,
      String(cgstRatePercent),
      String(sgstRatePercent),
      String(igstRatePercent),
    ].join("|");
    return {
      taxRatePercent,
      taxInclusive,
      gstScheme,
      cgstRatePercent,
      sgstRatePercent,
      igstRatePercent,
      groupKey,
    };
  });

  const groupIndices = new Map<string, number[]>();
  effective.forEach((line, index) => {
    const indices = groupIndices.get(line.groupKey) ?? [];
    indices.push(index);
    groupIndices.set(line.groupKey, indices);
  });

  const lineTaxables = new Array<number>(grossLines.length).fill(0);
  const lineTaxes = new Array<number>(grossLines.length).fill(0);
  let taxableAmountPaise = 0;
  let rawTaxPaise = 0;

  for (const indices of groupIndices.values()) {
    const group = effective[indices[0]];
    const weights = indices.map((i) => lineAfterDiscount[i]);
    const groupAfterPaise = weights.reduce((sum, w) => sum + w, 0);
    const { taxablePaise, taxPaise } = calculateTaxBase(
      groupAfterPaise,
      group.taxRatePercent,
      group.taxInclusive
    );
    const taxed = distributePaise(taxablePaise, weights);
    for (let k = 0; k < indices.length; k += 1) {
      lineTaxables[indices[k]] = taxed[k];
    }
    const taxes = distributePaise(taxPaise, taxed);
    for (let k = 0; k < indices.length; k += 1) {
      lineTaxes[indices[k]] = taxes[k];
    }
    taxableAmountPaise += taxablePaise;
    rawTaxPaise += taxPaise;
  }

  const hasBreakdown = input.gstRegistered;
  const rates = resolveComponentRates(input);
  const items: BillLineOutput[] = grossLines.map((line, index) => {
    const taxLine = lineTaxes[index];
    const tax = effective[index];
    const gst = hasBreakdown
      ? splitGst(taxLine, tax.gstScheme, tax.cgstRatePercent, tax.sgstRatePercent)
      : { cgst: 0, sgst: 0, igst: 0 };
    const lineTotal = tax.taxInclusive
      ? lineAfterDiscount[index]
      : lineTaxables[index] + taxLine;
    return {
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
      taxableValuePaise: lineTaxables[index],
      discountAmountPaise: lineDiscounts[index],
      taxRatePercent: tax.taxRatePercent,
      cgstAmountPaise: gst.cgst,
      sgstAmountPaise: gst.sgst,
      igstAmountPaise: gst.igst,
      lineTotalPaise: lineTotal,
    };
  });

  const billCgst = items.reduce((sum, item) => sum + item.cgstAmountPaise, 0);
  const billSgst = items.reduce((sum, item) => sum + item.sgstAmountPaise, 0);
  const billIgst = items.reduce((sum, item) => sum + item.igstAmountPaise, 0);
  // Registered restaurants get a CGST/SGST/IGST breakdown; unregistered bills
  // still show a single "Tax" line whose amount equals the GST computed on the
  // taxable value.
  const totalTaxPaise = hasBreakdown ? billCgst + billSgst + billIgst : rawTaxPaise;

  // The billable sale value excludes nothing: it is what the guest pays for
  // food before service charge and round-off.
  const saleTotalPaise = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);

  const serviceChargeAmountPaise = input.serviceChargeEnabled
    ? Math.round((saleTotalPaise * input.serviceChargeRatePercent) / 100)
    : 0;

  const preRoundPaise = saleTotalPaise + serviceChargeAmountPaise;
  const roundedPaise = input.roundOffEnabled ? roundToPaiseUnit(preRoundPaise) : preRoundPaise;
  const roundOffAmountPaise = roundedPaise - preRoundPaise;

  return {
    subtotalPaise,
    discountPaise,
    taxableAmountPaise,
    cgstAmountPaise: billCgst,
    sgstAmountPaise: billSgst,
    igstAmountPaise: billIgst,
    totalTaxPaise,
    serviceChargeAmountPaise,
    roundOffAmountPaise,
    grandTotalPaise: roundedPaise,
    taxRatePercent: input.taxRatePercent,
    taxInclusive: input.taxInclusive,
    cgstRatePercent: rates.cgstRatePercent,
    sgstRatePercent: rates.sgstRatePercent,
    igstRatePercent: rates.igstRatePercent,
    items,
  };
}