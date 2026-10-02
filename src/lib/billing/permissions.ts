import type { Role } from "@/lib/auth/roles";
import {
  BILL_CANCEL_ROLES,
  BILL_PAYMENT_ROLES,
  BILL_READ_ROLES,
} from "./constants";
import { BillForbiddenError } from "./errors";

/**
 * Server-side billing permissions.
 *
 * OWNER / MANAGER          : full billing control (generate, pay, cancel).
 * CASHIER                  : generate bills, record payments, print — no cancellation.
 * WAITER                   : read-only billing views.
 *
 * UI hiding is never the source of truth — every write server action calls
 * these assertions before touching the database.
 */

export function canReadBills(role: Role): boolean {
  return (BILL_READ_ROLES as readonly string[]).includes(role);
}

export function canManageBills(role: Role): boolean {
  return (BILL_PAYMENT_ROLES as readonly string[]).includes(role);
}

export function canCancelBills(role: Role): boolean {
  return (BILL_CANCEL_ROLES as readonly string[]).includes(role);
}

export function assertCanReadBills(role: Role): void {
  if (!canReadBills(role)) {
    throw new BillForbiddenError("You do not have permission to view bills.");
  }
}

export function assertCanManageBills(role: Role): void {
  if (!canManageBills(role)) {
    throw new BillForbiddenError(
      "You do not have permission to manage bills and payments."
    );
  }
}

export function assertCanCancelBills(role: Role): void {
  if (!canCancelBills(role)) {
    throw new BillForbiddenError(
      "You do not have permission to cancel bills."
    );
  }
}