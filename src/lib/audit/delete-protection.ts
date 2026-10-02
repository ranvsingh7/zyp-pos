import "server-only";

import { writeAuditLog } from "./audit-service";
import type { AuditEntityType } from "@/models/TableAuditLog";
import type { Role } from "@/lib/auth/roles";

/**
 * Financial & operational records that must NEVER be physically deleted. Any
 * delete attempt is rejected (403-style exception) and recorded as a
 * DELETE_ATTEMPT audit event. The supported alternative is the soft
 * cancel/void/reverse workflow for the record type:
 *
 *   ORDER         -> cancelOrder (CANCELLED status)                  [serve]
 *   BILL          -> cancelBill   (CANCELLED status)                  [billing]
 *   PAYMENT       -> append-only Payment ledger; refunds via new flows, never delete
 *   KOT           -> immutable KOT history; printer/kitchen module owns it
 *   PURCHASE      -> reversePurchase (POSTED -> REVERSED)           [purchase]
 *   STOCK_MOVEMENT-> append-only stock ledger; corrections are new movements
 *   AUDIT_LOG     -> append-only evidence; export/backup is read-only
 */
export const PROTECTED_RESOURCE_TYPES: readonly AuditEntityType[] = [
  "ORDER",
  "BILL",
  "PAYMENT",
  "KOT",
  "PURCHASE",
  "STOCK_MOVEMENT",
  "AUDIT_LOG",
];

export class ProtectedRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectedRecordError";
  }
}

export interface DeleteAttemptContext {
  restaurantId?: string | null;
  actorUserId?: string | null;
  actorRole?: Role | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Rejects a physical delete of a protected resource and records the attempt.
 * Returns normally when the resource type is not protected (catalog/floor-plan
 * records such as menu items, tables and sections are legitimately deletable).
 */
export async function assertNotDeletable(
  resourceType: AuditEntityType,
  resourceId: string | null | undefined,
  ctx: DeleteAttemptContext = {}
): Promise<void> {
  if (!(PROTECTED_RESOURCE_TYPES as readonly string[]).includes(resourceType)) {
    return;
  }
  const reason = ctx.reason ?? "Physical deletion is prohibited for this record type.";

  await writeAuditLog({
    restaurantId: ctx.restaurantId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: "DELETE_ATTEMPT",
    resourceType,
    resourceId: resourceId ?? undefined,
    after: null,
    reason,
    success: false,
    metadata: ctx.metadata,
  });

  throw new ProtectedRecordError(
    `Record type '${resourceType}' cannot be deleted. Use the soft-delete/cancel/void workflow instead.`
  );
}