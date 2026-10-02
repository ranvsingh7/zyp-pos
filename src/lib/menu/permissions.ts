import type { Role } from "@/lib/auth/roles";

/**
 * Server-side menu permissions.
 *
 * OWNER / MANAGER : full menu access.
 * CASHIER         : read + availability toggle.
 * WAITER          : read only.
 *
 * UI hiding is never the source of truth — every write server action calls
 * these assertions before touching the database.
 */

export class MenuForbiddenError extends Error {
  constructor(message = "You do not have permission to manage the menu.") {
    super(message);
    this.name = "MenuForbiddenError";
  }
}

export const MENU_EDIT_ROLES: Role[] = ["OWNER", "MANAGER"];
export const MENU_AVAILABILITY_ROLES: Role[] = ["OWNER", "MANAGER", "CASHIER"];

export function canEditMenu(role: Role): boolean {
  return MENU_EDIT_ROLES.includes(role);
}

export function canToggleAvailability(role: Role): boolean {
  return MENU_AVAILABILITY_ROLES.includes(role);
}

export function canReadMenu(): boolean {
  // Every authenticated user with a restaurant may view the menu (WAITER/CASHIER too).
  return true;
}

export function assertCanEditMenu(role: Role): void {
  if (!canEditMenu(role)) {
    throw new MenuForbiddenError();
  }
}

export function assertCanToggleAvailability(role: Role): void {
  if (!canToggleAvailability(role)) {
    throw new MenuForbiddenError(
      "You do not have permission to update item availability."
    );
  }
}