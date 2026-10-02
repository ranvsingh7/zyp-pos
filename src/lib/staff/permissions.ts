import type { Role } from "@/lib/auth/roles";
import { STAFF_MANAGE_ROLES } from "./constants";

/**
 * Server-side RBAC for staff management. Reading the staff list is allowed for
 * every tenant role; creating, editing, activating/deactivating and resetting
 * passwords is owner/manager work. Mirrors the settings permission model so
 * both surfaces fail identically at the server, not just in the UI.
 */
export class StaffForbiddenError extends Error {
  constructor(message = "You do not have permission to manage staff.") {
    super(message);
    this.name = "StaffForbiddenError";
  }
}

export function canManageStaff(role: Role): boolean {
  return (STAFF_MANAGE_ROLES as readonly string[]).includes(role);
}

export function assertCanManageStaff(role: Role): void {
  if (!canManageStaff(role)) throw new StaffForbiddenError();
}
