import type { OrderStatus, OrderType } from "@/lib/orders/constants";
import type { BillStatus } from "@/lib/billing/constants";

/**
 * Badge tone maps for the Orders module. Pure/UI-only so both client and
 * server components can rely on them for identical colouring.
 */
export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  OPEN: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  HELD: "bg-muted text-muted-foreground",
  KOT_SENT: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PREPARING: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  READY: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  SERVED: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  BILLED: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "bg-destructive/15 text-destructive",
};

export const PAYMENT_STATUS_TONE: Record<BillStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  UNPAID: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  PARTIAL: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "bg-destructive/15 text-destructive",
  REFUNDED: "bg-muted text-muted-foreground",
};

export const ORDER_TYPE_TONE: Record<OrderType, string> = {
  DINE_IN: "bg-muted text-muted-foreground",
  TAKEAWAY: "bg-muted text-muted-foreground",
  QUICK_SALE: "bg-muted text-muted-foreground",
};