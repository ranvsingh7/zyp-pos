export const ROLES = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  CASHIER: "CASHIER",
  WAITER: "WAITER",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export type Role = UserRole;

export const ALL_ROLES: UserRole[] = Object.values(ROLES);

/** Restaurant-facing roles that operate inside a tenant. */
export const TENANT_ROLES: UserRole[] = [
  ROLES.OWNER,
  ROLES.MANAGER,
  ROLES.CASHIER,
  ROLES.WAITER,
];

export function isSuperAdmin(role: Role | string | null | undefined): boolean {
  return role === ROLES.SUPER_ADMIN;
}

export function isTenantRole(role: Role | string | null | undefined): boolean {
  return (TENANT_ROLES as readonly string[]).includes(role ?? "");
}