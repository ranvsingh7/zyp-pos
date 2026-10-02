import type { Role } from "@/lib/auth/roles";
import {
  INVENTORY_MANAGE_ROLES,
  INVENTORY_VIEW_ROLES,
} from "@/lib/inventory/constants";
import { InventoryForbiddenError } from "@/lib/inventory/errors";

/**
 * Server-side inventory permissions.
 *
 * OWNER / MANAGER       : view + every write (items, purchases, adjustments,
 *                         wastage, consumption, categories).
 * CASHIER               : view inventory only.
 * WAITER                : no inventory access (not in the view allow-list).
 *
 * UI hiding is never the source of truth — every server action and page calls
 * these assertions before touching the database.
 */

export function canViewInventory(role: Role): boolean {
  return (INVENTORY_VIEW_ROLES as readonly string[]).includes(role);
}

export function canManageInventory(role: Role): boolean {
  return (INVENTORY_MANAGE_ROLES as readonly string[]).includes(role);
}

export function assertCanViewInventory(role: Role): void {
  if (!canViewInventory(role)) {
    throw new InventoryForbiddenError(
      "You do not have permission to view inventory."
    );
  }
}

export function assertCanManageInventory(role: Role): void {
  if (!canManageInventory(role)) {
    throw new InventoryForbiddenError();
  }
}
