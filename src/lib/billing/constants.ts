import type { Role } from "@/lib/auth/roles";
import { ACTIVE_ORDER_STATUSES, type OrderStatus } from "@/lib/orders/constants";

export const BILL_STATUSES = [
  "DRAFT",
  "UNPAID",
  "PARTIAL",
  "PAID",
  "CANCELLED",
  "REFUNDED",
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  DRAFT: "Draft",
  UNPAID: "Unpaid",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const BILL_PAYMENT_METHODS = ["CASH", "UPI", "CARD", "OTHER"] as const;
export type BillPaymentMethod = (typeof BILL_PAYMENT_METHODS)[number];

export const BILL_PAYMENT_METHOD_LABELS: Record<BillPaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  OTHER: "Other",
};

export const GST_SCHEMES = ["INTRA_STATE", "INTER_STATE"] as const;
export type GstScheme = (typeof GST_SCHEMES)[number];

export const GST_SCHEME_LABELS: Record<GstScheme, string> = {
  INTRA_STATE: "CGST + SGST (intra-state)",
  INTER_STATE: "IGST (inter-state)",
};

/**
 * Real GSTIN format: 2-digit state code + 10-char PAN + entity code +
 * fixed "Z" + checksum. (The owner-registration validator uses the same
 * shape; admin schemas reuse this so both surfaces agree.)
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** Single source of truth for the default per-restaurant tax configuration. */
export const DEFAULT_TAX_CONFIG = {
  taxEnabled: true,
  defaultTaxRate: 5,
  cgstRatePercent: 2.5,
  sgstRatePercent: 2.5,
  igstRatePercent: 5,
} as const;

/** Offered default-rate presets in the tax settings UI (plus Custom). */
export const GST_RATE_PRESETS = [0, 5, 12, 18, 28] as const;

/** Upper bound for any configured tax rate percent. */
export const TAX_RATE_MAX = 100;

/** Statuses that can generate/settle a bill. CANCELLED and PAID are terminal. */
export const BILLABLE_ORDER_STATUSES: OrderStatus[] = [
  ...ACTIVE_ORDER_STATUSES,
  "HELD",
  "BILLED",
];

/** Bill lifecycle states in which payments may still be recorded. */
export const PAYABLE_BILL_STATUSES: BillStatus[] = ["DRAFT", "UNPAID", "PARTIAL"];

export const BILL_NUMBER_PAD = 6;
export const FIRST_BILL_SEQUENCE = 1;
export const BILL_PREFIX_DEFAULT = "BILL";
export const BILL_PREFIX_MAX = 10;

export const BILL_PAYMENT_REFERENCE_MAX = 100;
export const BILL_PAYMENT_NOTE_MAX = 300;
export const BILL_CANCEL_REASON_MAX = 300;

export const BILL_NUMBER_SEARCH_MAX = 40;

/** Any staff member can view bills for their own restaurant. */
export const BILL_READ_ROLES: readonly Role[] = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
];

/** Generating bills and recording payments is cash-handling work. */
export const BILL_PAYMENT_ROLES: readonly Role[] = ["OWNER", "MANAGER", "CASHIER"];

/** Cancelling a bill is a manager-level action. */
export const BILL_CANCEL_ROLES: readonly Role[] = ["OWNER", "MANAGER"];

export function isPayableBillStatus(status: BillStatus): boolean {
  return PAYABLE_BILL_STATUSES.includes(status);
}

export function isBillStatus(value: string): value is BillStatus {
  return (BILL_STATUSES as readonly string[]).includes(value);
}

export function billStatusLabel(status: BillStatus): string {
  return BILL_STATUS_LABELS[status] ?? status;
}
