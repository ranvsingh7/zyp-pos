import type { Role } from "@/lib/auth/roles";
import {
  ORDERS_READ_ROLES,
  ORDER_CANCEL_ROLES,
  ORDER_OPERATOR_ROLES,
} from "./constants";
import { OrderForbiddenError } from "./errors";

/**
 * Server-side order permissions.
 *
 * OWNER / MANAGER          : full order control + orders management (read).
 * CASHIER                  : create / edit / hold / resume / send to kitchen /
 *                            cancel / move, view orders + details, permitted
 *                            operational actions.
 * WAITER                   : create / edit / hold / send to kitchen / move, view
 *                            orders + details + print/reprint KOT — no cancel.
 *
 * UI hiding is never the source of truth — every write server action calls
 * these assertions before touching the database.
 */

export function canOperateOrders(role: Role): boolean {
  return (ORDER_OPERATOR_ROLES as readonly string[]).includes(role);
}

export function canCancelOrders(role: Role): boolean {
  return (ORDER_CANCEL_ROLES as readonly string[]).includes(role);
}

/** Every staff role may view their own restaurant's orders. */
export function canViewOrders(role: Role): boolean {
  return (ORDERS_READ_ROLES as readonly string[]).includes(role);
}

export function assertCanOperateOrders(role: Role): void {
  if (!canOperateOrders(role)) {
    throw new OrderForbiddenError("You do not have permission to use the POS.");
  }
}

export function assertCanCancelOrders(role: Role): void {
  if (!canCancelOrders(role)) {
    throw new OrderForbiddenError("You do not have permission to cancel orders.");
  }
}

export function assertCanViewOrders(role: Role): void {
  if (!canViewOrders(role)) {
    throw new OrderForbiddenError("You do not have permission to view orders.");
  }
}