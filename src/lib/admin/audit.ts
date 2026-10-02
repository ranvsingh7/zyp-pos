import "server-only";

import type { ObjectId } from "mongoose";
import type { AuditEntityType, TableAuditAction } from "@/models/TableAuditLog";
import { writeAuditLog } from "@/lib/audit/audit-service";

/**
 * Platform-admin audit entry point.
 *
 * A SUPER_ADMIN acts without a restaurant session, so these events are not
 * tenant-scoped; `restaurantId` is null for genuinely platform-level resources
 * (a plan) and set for everything that belongs to a venue.
 *
 * This is a thin adapter over the one shared writer, `writeAuditLog`, rather
 * than a second implementation. Routing both paths through the same function is
 * what guarantees the whole application has a single audit trail with one
 * write contract, one request-context capture (ip / user agent / request id) and
 * one fail-soft policy — rather than a platform path that quietly omits fields
 * the tenant path records.
 *
 * Fail-soft is deliberate and matches `writeAuditLog`: an audit write must
 * never abort a business operation that already succeeded, and the audit model
 * is append-only/immutable so a failed write cannot leave a partial record
 * behind. Failures are logged, not swallowed silently.
 */

interface PlatformAuditInput {
  action: TableAuditAction;
  /** Platform-admin events have no tenant; null keeps the tenant scope intact. */
  restaurantId?: ObjectId | string | null;
  actorId?: ObjectId | string | null;
  actorRole?: string | null;
  entityType: AuditEntityType | string;
  entityId?: ObjectId | string | null;
  entityName?: string | null;
  summary?: string | null;
  /** State before the change. Only ever business fields — never secrets. */
  before?: unknown;
  /** State after the change. Only ever business fields — never secrets. */
  after?: unknown;
  reason?: string | null;
  success?: boolean;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Append one platform-scoped audit row. Errors must never break the business
 * operation, so failures are reported by the shared writer, not thrown.
 */
export async function logPlatformAudit(
  input: PlatformAuditInput
): Promise<void> {
  await writeAuditLog({
    action: input.action,
    restaurantId: input.restaurantId != null ? String(input.restaurantId) : null,
    actorUserId: input.actorId != null ? String(input.actorId) : null,
    actorRole: (input.actorRole ?? "SUPER_ADMIN") as never,
    resourceType: input.entityType as AuditEntityType,
    resourceId: input.entityId != null ? String(input.entityId) : null,
    // `summary`/`entityName` are display-only extras on top of the canonical
    // audit fields; the writer passes them through when present.
    entityName: input.entityName ?? null,
    summary: input.summary ?? null,
    before: input.before,
    after: input.after,
    reason: input.reason ?? null,
    success: input.success ?? true,
    metadata: input.metadata ?? undefined,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    requestId: input.requestId ?? null,
  });
}
