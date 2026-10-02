import type { OrderStatus, OrderType } from "./constants";

export interface OrderItemView {
  /** menuItemId as string (the source in the Menu module). */
  menuItemId: string;
  /** Name captured at order time so historical orders stay readable. */
  nameSnapshot: string;
  variantId: string | null;
  variantNameSnapshot: string | null;
  /**
   * HSN/SAC captured from the menu item at order time. Null when the item had
   * no code configured; never re-read from the menu afterwards.
   */
  hsnSacCode: string | null;
  quantity: number;
  /** Integer paise, captured from the menu at add time. */
  unitPricePaise: number;
  note: string | null;
  lineTotalPaise: number;
  /**
   * How many units of this line are already covered by printed KOTs (the
   * incremental ledger). These units are locked — the kitchen has seen them.
   */
  printedQuantity: number;
  /**
   * How many units of this line are NOT yet printed (new/unsent). These are the
   * only units staff may edit/annotate; the next KOT print carries them.
   */
  unsentQuantity: number;
}

export interface OrderView {
  id: string;
  orderNumber: number;
  orderType: OrderType;
  status: OrderStatus;
  tableId: string | null;
  tableNameSnapshot: string | null;
  customerName: string | null;
  customerPhone: string | null;
  items: OrderItemView[];
  totalPaise: number;
/**
 * What the next KOT print would carry:
 *  - "ADD" → no KOT printed yet; the first (complete) KOT is pending
 *    (PRINT KOT)
 *  - "MODIFY" → KOTs exist and the pending delta has newly-added items /
 *    increased quantities (PRINT UPDATED KOT)
 *  - null → nothing pending ("No changes to print")
 * Server-computed by comparing the current order to the accumulated printed
 * ledger (all printed KOTs), so it survives reloads without storing extra
 * state. Removals/decreases never produce a pending print.
 */
  pendingKitchenPrint: "ADD" | "MODIFY" | null;
  /**
   * The exact item lines the next KOT print would carry (the pending INCREMENTAL
   * delta: new items + increased quantities since the last printed KOT). Empty
   * when nothing is pending. The first print carries the complete order.
   */
  pendingKitchenItems: KotItemView[];
  /** Order-level discount in paise; applied when the bill is generated. */
  discountPaise: number;
  /** Kind of discount applied ("PERCENTAGE" | "FIXED"); null for legacy. */
  discountType: "PERCENTAGE" | "FIXED" | null;
  /** Discount in discountType units (percent or rupees); null when legacy. */
  discountValue: number | null;
  /** Free-text reason for the discount, if any. */
  discountReason: string | null;
  orderNote: string | null;
  createdBy: string;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
  heldAt: string | null;
  resumedAt: string | null;
  sentToKitchenAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  paidAt: string | null;
}

export type KotItemAction = "ADDED";

export interface KotItemView {
  name: string;
  variant: string | null;
  quantity: number;
  note: string | null;
  /** Always "ADDED" — a KOT only ever adds items/quantities, never removes. */
  action: KotItemAction;
}

export interface KotView {
  id: string;
  kotNumber: string;
  orderNumber: number;
  orderType: OrderType;
  /**
   * "MODIFIED" is retained for legacy records created by earlier editing
   * semantics. New KOTs are always "NEW".
   */
  type: "NEW" | "MODIFIED";
  /**
   * PENDING = printed but not yet confirmed as received by kitchen.
   * SENT = confirmed as received by kitchen.
   */
  state: "PENDING" | "SENT";
  /** ACTIVE = live; CANCELLED = voided (snapshot preserved, not actionable). */
  status: "ACTIVE" | "CANCELLED";
  cancellationReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  tableName: string | null;
  customerName: string | null;
  items: KotItemView[];
  orderNote: string | null;
  printedAt: string | null;
  printedCount: number;
  createdAt: string;
  createdBy: string;
}

/**
 * One row of the Orders Management list. Amounts fall back to the order
 * snapshot (totalPaise) until a bill exists, at which point the immutable bill
 * snapshot is authoritative. `paymentStatus` / `billNumber` are null when the
 * order has no bill yet.
 */
export interface OrderListRow {
  id: string;
  orderNumber: number;
  orderType: OrderType;
  status: OrderStatus;
  tableId: string | null;
  tableNameSnapshot: string | null;
  customerName: string | null;
  customerPhone: string | null;
  itemsCount: number;
  amountPaise: number;
  createdAt: string;
  paidAt: string | null;
  createdByName: string;
  paymentStatus: import("@/lib/billing/constants").BillStatus | null;
  billId: string | null;
  billNumber: string | null;
  billGrandTotalPaise: number | null;
}

/** Aggregate KPI cards shown at the top of the Orders list. */
export interface OrdersSummary {
  todayOrders: number;
  todaySalesPaise: number;
  unpaidBills: number;
  paidBills: number;
  cancelledOrders: number;
}

export interface OrderListResult {
  rows: OrderListRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

/** Display name + role of a staff member, used for "Created by" and payments. */
export interface StaffMember {
  fullName: string;
  role: import("@/lib/auth/roles").Role;
}

export type StaffMap = Record<string, StaffMember>;

/** Everything a server-rendered order details page needs. */
export interface OrderDetailsView {
  order: OrderView;
  kots: KotView[];
  bill: import("@/lib/billing/types").BillView | null;
  staff: StaffMap;
}