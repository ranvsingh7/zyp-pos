import { TENANT_ROLES, type Role, type UserRole } from "@/lib/auth/roles";

/**
 * Staff management lives inside one restaurant, so the assignable roles are
 * exactly the tenant roles from the existing RBAC table. `SUPER_ADMIN` is a
 * platform role and can never be handed out from inside a tenant.
 */
export const STAFF_ASSIGNABLE_ROLES = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
] as const satisfies readonly UserRole[];

export type StaffAssignableRole = (typeof STAFF_ASSIGNABLE_ROLES)[number];

/** Runtime guard so the tuple above can never drift from the RBAC table. */
export function isStaffAssignableRole(role: unknown): role is StaffAssignableRole {
  return (
    typeof role === "string" &&
    (STAFF_ASSIGNABLE_ROLES as readonly string[]).includes(role) &&
    (TENANT_ROLES as readonly string[]).includes(role)
  );
}

export const STAFF_ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  WAITER: "Waiter",
};

/** Roles allowed to manage the staff list of their own restaurant. */
export const STAFF_MANAGE_ROLES: readonly Role[] = ["OWNER", "MANAGER"];

/** Staff list is a single screen; the cap is a safety bound, not pagination. */
export const STAFF_MAX_ROWS = 200;
export const STAFF_SEARCH_MAX_LENGTH = 80;
export const STAFF_PHONE_MAX_LENGTH = 15;
export const STAFF_NAME_MAX_LENGTH = 80;

/** Mirrors the signup policy so staff and owner credentials behave the same. */
export const STAFF_PASSWORD_MIN_LENGTH = 8;
