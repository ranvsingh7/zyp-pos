import { rupeesToPaise } from "@/lib/menu/prices";
import { computeOrderDiscountPaise } from "@/lib/orders/discount";
import {
  DISCOUNT_PERCENT_MAX,
  type DiscountType,
} from "@/lib/orders/constants";
import { BillValidationError } from "./errors";

export interface BillDiscountInput {
  discountType?: DiscountType | null;
  discountValue?: number | null;
  discountReason?: string | null;
  /** Legacy absolute-paise discount, preserved from a pre-refactor order snapshot. */
  discountPaise?: number | null;
}

export interface ResolvedBillDiscount {
  discountPaise: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string | null;
}

function cleanText(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

/**
 * Resolves the bill-level discount (type + value + reason) OR a legacy
 * absolute-paise amount into a single authoritative snapshot, validated
 * against the bill subtotal.
 *
 * The amount is computed server-side from the subtotal — never trusted from
 * the browser. A percentage discount must stay within 0–100%; a fixed
 * discount can never exceed the subtotal (rejected, not silently clamped, so
 * an over-discount surfaces as a cash mistake). The legacy paise path clamps
 * defensively since those orders were validated when the discount was saved.
 *
 * Discounts are intentionally NOT written back to the order: they live only
 * on the generated bill snapshot.
 */
export function resolveBillDiscount(
  subtotalPaise: number,
  input: BillDiscountInput
): ResolvedBillDiscount {
  const { discountType } = input;

  if (discountType) {
    const discountValue = input.discountValue ?? 0;
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      throw new BillValidationError("Enter a valid discount value.");
    }

    if (discountType === "PERCENTAGE") {
      if (discountValue > DISCOUNT_PERCENT_MAX) {
        throw new BillValidationError(
          "Discount percentage cannot exceed 100%."
        );
      }
      return {
        discountPaise: computeOrderDiscountPaise(
          "PERCENTAGE",
          discountValue,
          subtotalPaise
        ),
        discountType: "PERCENTAGE",
        discountValue,
        discountReason: cleanText(input.discountReason),
      };
    }

    if (discountValue <= 0) {
      throw new BillValidationError("Enter the discount amount in rupees.");
    }
    const rawPaise = rupeesToPaise(discountValue);
    if (rawPaise > subtotalPaise) {
      throw new BillValidationError(
        "Discount cannot exceed the bill subtotal."
      );
    }
    return {
      discountPaise: rawPaise,
      discountType: "FIXED",
      discountValue,
      discountReason: cleanText(input.discountReason),
    };
  }

  // Legacy absolute-paise discount carried from a pre-refactor order.
  const discountPaise =
    input.discountPaise != null
      ? Math.min(subtotalPaise, Math.max(0, Math.round(input.discountPaise)))
      : 0;
  return {
    discountPaise,
    discountType: null,
    discountValue: null,
    discountReason: cleanText(input.discountReason),
  };
}