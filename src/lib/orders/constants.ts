import type { Role } from "@/lib/auth/roles";

export const ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "QUICK_SALE"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = [
  "OPEN",
  "HELD",
  "KOT_SENT",
  "PREPARING",
  "READY",
  "SERVED",
  "BILLED",
  "PAID",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Statuses that represent a live order at the restaurant. These occupy a
 * table (DINE_IN) and are listed as "active" for reopening.
 *
 * HELD is deliberately excluded: holding an order releases the floor and the
 * table becomes available again until the order is resumed.
 */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "OPEN",
  "KOT_SENT",
  "PREPARING",
  "READY",
  "SERVED",
];

/** Statuses whose items can still be edited. After KOT_SENT no silent edits. */
export const EDITABLE_ORDER_STATUSES: OrderStatus[] = ["OPEN"];

/** Statuses a table may be released/occupied around (future billing extends this). */
export const TABLE_OCCUPYING_STATUSES: OrderStatus[] = ACTIVE_ORDER_STATUSES;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  OPEN: "Open",
  HELD: "Held",
  KOT_SENT: "Sent to Kitchen",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  BILLED: "Billed",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const orderTypeLabel = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  QUICK_SALE: "Quick sale",
} as const satisfies Record<OrderType, string>;

export const FIRST_ORDER_NUMBER = 1001;

export const KOT_NUMBER_PREFIX = "K-";
export const KOT_NUMBER_PAD = 3;
export const FIRST_KOT_NUMBER = 1;

/**
 * Future Settings > Kitchen Mode. Only the manual PRINTER workflow is wired
 * today (SAVE ORDER → PRINT KOT → browser print). KDS / BOTH arrive with the
 * kitchen display module; the architecture is kept compatible.
 */
export const KITCHEN_MODES = ["PRINTER", "KDS", "BOTH"] as const;
export type KitchenMode = (typeof KITCHEN_MODES)[number];
export const DEFAULT_KITCHEN_MODE: KitchenMode = "PRINTER";

export const ORDER_ITEM_MAX_QUANTITY = 999;
export const ORDER_MAX_ITEMS = 200;

export const ORDER_ITEM_NOTE_MAX = 500;
export const ORDER_NOTE_MAX = 1000;
export const ORDER_CUSTOMER_NAME_MAX = 100;
export const ORDER_CUSTOMER_PHONE_MAX = 20;
export const ORDER_CANCEL_REASON_MAX = 300;
export const KOT_CANCELLATION_REASON_MAX = 500;

/**
 * Discount kinds. PERCENTAGE value is a percent (0–100); FIXED value is a
 * rupee amount. Available to the billing stage: discounts are chosen at
 * bill-generation time and snapshot onto the Bill (never the Order). The
 * shared arithmetic in `@/lib/orders/discount` is reused by billing too.
 */
export const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** Upper bound for a percentage discount (%). */
export const DISCOUNT_PERCENT_MAX = 100;

/** Longest allowed discount reason. */
export const ORDER_DISCOUNT_REASON_MAX = 300;

/** Every POS operator may create, edit, hold and send orders to the kitchen. */
export const ORDER_OPERATOR_ROLES: readonly Role[] = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
];

/** Cancelling an order is limited to cash-handling roles + management. */
export const ORDER_CANCEL_ROLES: readonly Role[] = ["OWNER", "MANAGER", "CASHIER"];

/**
 * Orders Management module (list + details). Every staff role may view their
 * own restaurant's orders and order details. Financial actions (bill, payment,
 * cancel) continue to use the existing billing / cancel role gates.
 */
export const ORDERS_READ_ROLES: readonly Role[] = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
];

/** Orders Management role that may also perform management-level actions. */
export const ORDERS_MANAGE_ROLES: readonly Role[] = ["OWNER", "MANAGER"];

/** Orders list page size (server-side pagination). */
export const ORDERS_PAGE_SIZE = 25;

/** Selectable order type filters ("" = all). */
export const ORDERS_TYPE_FILTERS = ["", ...ORDER_TYPES] as const;

/** Selectable order status filters ("" = all). Derived only from the model. */
export const ORDERS_STATUS_FILTERS = ["", ...ORDER_STATUSES] as const;

/** Selectable payment status filters derived from the Bill lifecycle. */
export const ORDERS_PAYMENT_FILTERS = ["", "UNPAID", "PARTIAL", "PAID"] as const;

/** Sort options for the orders list. */
export const ORDER_SORTS = [
  "newest",
  "oldest",
  "amount_desc",
  "amount_asc",
  "number",
] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];
export const DEFAULT_ORDER_SORT: OrderSort = "newest";

/** Longest allowed search query (protects the regex / $or clauses). */
export const ORDER_SEARCH_MAX = 80;