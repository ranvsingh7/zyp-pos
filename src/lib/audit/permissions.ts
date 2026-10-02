import type { Role } from "@/lib/auth/roles";

/**
 * Server-side RBAC for the audit trail (viewer + export). Only OWNER and
 * MANAGER may read audit evidence; CASHIER/WAITER are always denied at the
 * server regardless of what the UI hides.
 */
export const AUDIT_VIEW_ROLES: readonly Role[] = ["OWNER", "MANAGER"];

export function canViewAuditLogs(role: Role): boolean {
  return (AUDIT_VIEW_ROLES as readonly string[]).includes(role);
}

export class AuditForbiddenError extends Error {
  constructor(message = "You do not have permission to view audit logs.") {
    super(message);
    this.name = "AuditForbiddenError";
  }
}

export function assertCanViewAuditLogs(role: Role): void {
  if (!canViewAuditLogs(role)) throw new AuditForbiddenError();
}