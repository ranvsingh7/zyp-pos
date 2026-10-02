import { formatPaise, rupeesToPaise } from "@/lib/menu/prices";
import { DISCOUNT_PERCENT_MAX, type DiscountType } from "./constants";

export interface OrderDiscountInfo {
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string | null;
}

/**
 * Pure order-discount arithmetic shared by the POS cart (display estimate) and
 * the order service (authoritative amount). All money is integer paise.
 *
 * - PERCENTAGE: `discountValue` is a percentage of the subtotal (0–100).
 * - FIXED: `discountValue` is a rupee amount, converted to paise.
 *
 * The returned amount is always clamped to the subtotal so a bill can never go
 * negative. Callers that need a hard rejection (order service) validate the
 * value separately.
 */
export function computeOrderDiscountPaise(
  discountType: DiscountType,
  discountValue: number,
  subtotalPaise: number
): number {
  if (
    subtotalPaise <= 0 ||
    !Number.isFinite(discountValue) ||
    discountValue <= 0
  ) {
    return 0;
  }
  if (discountType === "PERCENTAGE") {
    const percent = Math.min(DISCOUNT_PERCENT_MAX, Math.max(0, discountValue));
    return Math.min(subtotalPaise, Math.round((subtotalPaise * percent) / 100));
  }
  return Math.min(subtotalPaise, rupeesToPaise(discountValue));
}

/** Display label for a discount snapshot: "10%" or "₹10". Empty when none. */
export function discountValueLabel(
  discountType: DiscountType | null,
  discountValue: number | null
): string {
  if (discountType === "PERCENTAGE") return `${discountValue}%`;
  if (discountType === "FIXED") {
    return formatPaise(rupeesToPaise(discountValue ?? 0));
  }
  return "";
}