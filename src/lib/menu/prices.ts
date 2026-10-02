/**
 * Decimal-safe money handling for ZYP POS.
 *
 * Money is stored in the smallest currency unit (paise for INR) as integers.
 * All monetary values persisted to MongoDB (basePrice, variant price) are
 * integer paise. Rupees are accepted only at the boundaries (form input) and
 * converted with `rupeesToPaise`. Display always goes through `formatPaise`.
 */

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new Error("Invalid rupee amount.");
  }
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** "₹180" / "₹30" / "₹180.50" */
export function formatPaise(paise: number): string {
  const value = paiseToRupees(Math.round(paise));
  const formatted = Number.isInteger(value)
    ? value.toLocaleString("en-IN")
    : value.toFixed(2);
  return `₹${formatted}`;
}

/** "--" for empty, "₹180" single, "₹120 – ₹200" for a range. */
export function formatPriceRangePaise(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null) return "—";
  if (min === max) return formatPaise(min);
  return `${formatPaise(min)} – ${formatPaise(max)}`;
}