import type { Role } from "@/lib/auth/roles";
import { SETTINGS_MANAGE_ROLES } from "./constants";

/**
 * Server-side RBAC for restaurant settings (profile, tax, numbering, service
 * charge, round-off and the restaurant logo). Reading the settings page is
 * allowed for every tenant role; writing is owner/manager work.
 */
export class SettingsForbiddenError extends Error {
  constructor(message = "You do not have permission to change restaurant settings.") {
    super(message);
    this.name = "SettingsForbiddenError";
  }
}

export function canManageSettings(role: Role): boolean {
  return (SETTINGS_MANAGE_ROLES as readonly string[]).includes(role);
}

export function assertCanManageSettings(role: Role): void {
  if (!canManageSettings(role)) throw new SettingsForbiddenError();
}
