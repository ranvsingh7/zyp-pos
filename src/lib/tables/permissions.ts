import type { Role } from "@/lib/auth/roles";
import { TABLE_EDIT_ROLES, TABLE_STATUS_ROLES } from "@/lib/tables/constants";
import { TableForbiddenError } from "@/lib/tables/errors";

/**
 * Server-side table permissions.
 *
 * OWNER / MANAGER : full table management (create/edit/delete/activate/section mgmt).
 * CASHIER / WAITER: view tables and change table status where appropriate.
 *
 * UI hiding is never the source of truth — every write server action calls these
 * assertions before touching the database.
 */

export function canEditTables(role: Role): boolean {
  return (TABLE_EDIT_ROLES as readonly string[]).includes(role);
}

export function canChangeTableStatus(role: Role): boolean {
  return (TABLE_STATUS_ROLES as readonly string[]).includes(role);
}

export function canReadTables(): boolean {
  // Every authenticated user with a restaurant may view tables.
  return true;
}

export function assertCanEditTables(role: Role): void {
  if (!canEditTables(role)) {
    throw new TableForbiddenError();
  }
}

export function assertCanChangeTableStatus(role: Role): void {
  if (!canChangeTableStatus(role)) {
    throw new TableForbiddenError(
      "You do not have permission to change table status."
    );
  }
}