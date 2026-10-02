import "server-only";

import { writeAuditLog } from "@/lib/audit/audit-service";
import type { TableAuditAction, AuditEntityType } from "@/models/TableAuditLog";

export interface AuditEntryInput {
  restaurantId: string;
  userId: string;
  action: TableAuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Creates a lightweight audit-log entry for an important action. One shared
 * audit system covers tables/sections, billing, inventory, orders and KOTs
 * (he/him: keep a single trail). Fail-soft: logging errors never break the
 * primary operation. Delegates to the production audit service so request
 * context (IP, user-agent, request id) and the actor's role are captured too.
 */
export async function recordAudit(entry: AuditEntryInput): Promise<void> {
  await writeAuditLog({
    restaurantId: entry.restaurantId,
    actorUserId: entry.userId,
    action: entry.action,
    resourceType: entry.entityType,
    resourceId: entry.entityId,
    metadata: entry.metadata,
  });
}

/**
 * Backwards-compatible alias used by the tables module.
 */
export async function recordTableAudit(entry: AuditEntryInput): Promise<void> {
  return recordAudit(entry);
}