import "server-only";

import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import {
  TableAuditLogModel,
  TABLE_AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type TableAuditAction,
  type AuditEntityType,
} from "@/models/TableAuditLog";
import type { Role } from "@/lib/auth/roles";
import { escapeRegExp } from "@/lib/menu/utils";
import { csvLine, type CsvCell } from "@/lib/reports/csv";

/**
 * Production-grade audit service built on the single shared TableAuditLog
 * model (append-only). Every sensitive action funnels through this module so
 * request context (IP, user agent, request id) and the actor's role are
 * captured consistently. Writes are fail-soft — an audit failure must never
 * break the primary operation — but the model itself is immutable.
 */

interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

async function getRequestContext(entry: AuditEventInput): Promise<RequestContext> {
  let ip: string | null = entry.ip ?? null;
  let userAgent: string | null = entry.userAgent ?? null;
  const requestId: string | null = entry.requestId ?? randomUUID();
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    if (!ip) {
      const forwarded = h.get("x-forwarded-for");
      ip = (forwarded ? forwarded.split(",")[0].trim() : null) ?? h.get("x-real-ip");
    }
    if (!userAgent) userAgent = h.get("user-agent");
  } catch {
    // Outside a request scope (unit/e2e tests, background jobs) — keep the
    // passed-in values, fall back to a generated request id.
  }
  return { ip, userAgent, requestId };
}

async function resolveActorRole(
  actorUserId: string | null | undefined,
  actorRole: Role | null | undefined
): Promise<Role | null> {
  if (actorRole) return actorRole;
  if (!actorUserId) return null;
  try {
    await connectDB();
    const user = await UserModel.findById(actorUserId).select("role").lean();
    return (user?.role as Role) ?? null;
  } catch {
    return null;
  }
}

export interface AuditEventInput {
  restaurantId?: string | null;
  actorUserId?: string | null;
  actorRole?: Role | null;
  action: TableAuditAction;
  resourceType: AuditEntityType;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  success?: boolean;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /**
   * Display-only extras. The audit viewer renders these verbatim, so callers
   * (e.g. platform admin actions) may supply a human-readable line instead of
   * the reader deriving one. Both are optional; omitting them changes nothing.
   */
  summary?: string | null;
  entityName?: string | null;
}

/** Appends one audit record. Fail-soft: never throws into the caller. */
export async function writeAuditLog(entry: AuditEventInput): Promise<void> {
  try {
    await connectDB();
    const [ctx, role] = await Promise.all([
      getRequestContext(entry),
      resolveActorRole(entry.actorUserId, entry.actorRole),
    ]);

    await TableAuditLogModel.create({
      restaurantId:
        entry.restaurantId && mongoose.isObjectIdOrHexString(entry.restaurantId)
          ? entry.restaurantId
          : undefined,
      userId:
        entry.actorUserId && mongoose.isObjectIdOrHexString(entry.actorUserId)
          ? entry.actorUserId
          : undefined,
      actorRole: role,
      action: entry.action,
      entityType: entry.resourceType,
      entityId:
        entry.resourceId != null && entry.resourceId !== ""
          ? entry.resourceId
          : undefined,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
      reason: entry.reason?.trim() ? entry.reason.trim() : undefined,
      success: entry.success ?? true,
      summary: entry.summary?.trim() ? entry.summary.trim() : undefined,
      entityName: entry.entityName?.trim() ? entry.entityName.trim() : undefined,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: entry.metadata ?? undefined,
    });
  } catch (err) {
    console.error(
      "[audit] failed to write audit log",
      err instanceof Error ? err.message : err
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Read side (audit viewer + protected export). All queries are tenant-scoped  */
/* by restaurantId derived from the authenticated session — never from the    */
/* client.                                                                     */
/* -------------------------------------------------------------------------- */

export interface AuditLogFilters {
  /** Inclusive local start day (yyyy-mm-dd). */
  fromYmd?: string | null;
  /** Inclusive local end day (yyyy-mm-dd). */
  toYmd?: string | null;
  actorUserId?: string | null;
  action?: TableAuditAction | null;
  resourceType?: AuditEntityType | null;
  success?: boolean | null;
  /** Free-text search on the resource id (order number, bill number, …). */
  search?: string | null;
}

export interface AuditLogView {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
}

interface ObjectId {
  toString(): string;
}

function buildMatch(
  restaurantId: string,
  filters: AuditLogFilters
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  };
  if (filters.actorUserId && mongoose.isObjectIdOrHexString(filters.actorUserId)) {
    match.userId = new mongoose.Types.ObjectId(filters.actorUserId);
  }
  if (filters.action) match.action = filters.action;
  if (filters.resourceType) match.entityType = filters.resourceType;
  if (filters.success != null) match.success = filters.success;

  const or: Record<string, unknown>[] = [];
  if (filters.fromYmd || filters.toYmd) {
    const range: Record<string, Date> = {};
    if (filters.fromYmd) {
      range.$gte = localDayStart(filters.fromYmd);
    }
    if (filters.toYmd) {
      range.$lt = addDays(localDayStart(filters.toYmd), 1);
    }
    match.createdAt = range;
  }
  if (filters.search && filters.search.trim()) {
    const rx = { $regex: escapeRegExp(filters.search.trim()), $options: "i" };
    or.push({ entityId: rx });
    if (mongoose.isObjectIdOrHexString(filters.search.trim())) {
      or.push({ entityId: new mongoose.Types.ObjectId(filters.search.trim()) });
    }
  }
  if (or.length > 0) match.$or = or;
  return match;
}

function localDayStart(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function resolveActorNames(
  views: AuditLogView[]
): Promise<Map<string, string>> {
  const ids = [...new Set(views.map((v) => v.actorUserId).filter(Boolean) as string[])];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  try {
    await connectDB();
    const users = await UserModel.find({ _id: { $in: ids } })
      .select("_id fullName")
      .lean();
    for (const user of users) {
      map.set(String(user._id as unknown as ObjectId), user.fullName);
    }
  } catch {
    // Names are presentation sugar; never fail the query over them.
  }
  return map;
}

export async function listAuditLogs(
  restaurantId: string,
  filters: AuditLogFilters = {},
  pagination: { page?: number; pageSize?: number } = {}
): Promise<{ rows: AuditLogView[]; total: number; page: number; pageSize: number }> {
  await connectDB();
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 25));
  const match = buildMatch(restaurantId, filters);

  const [total, docs] = await Promise.all([
    TableAuditLogModel.countDocuments(match),
    TableAuditLogModel.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);

  const rows = docs.map(docToView);
  const names = await resolveActorNames(rows);
  for (const row of rows) {
    row.actorName = row.actorUserId ? (names.get(row.actorUserId) ?? null) : null;
  }
  return { rows, total, page, pageSize };
}

export async function countAuditLogs(
  restaurantId: string,
  filters: AuditLogFilters = {}
): Promise<number> {
  await connectDB();
  return TableAuditLogModel.countDocuments(buildMatch(restaurantId, filters));
}

function docToView(doc: Record<string, unknown>): AuditLogView {
  const createdAt = doc.createdAt as Date | undefined;
  return {
    id: String((doc._id as unknown as ObjectId).toString()),
    createdAt: createdAt ? createdAt.toISOString() : "",
    actorUserId: doc.userId ? String(doc.userId) : null,
    actorName: null,
    actorRole: doc.actorRole ? String(doc.actorRole) : null,
    action: String(doc.action ?? ""),
    resourceType: String(doc.entityType ?? ""),
    resourceId: doc.entityId != null ? String(doc.entityId) : null,
    success: doc.success == null ? true : Boolean(doc.success),
    reason: doc.reason ? String(doc.reason) : null,
    ip: doc.ip ? String(doc.ip) : null,
    userAgent: doc.userAgent ? String(doc.userAgent) : null,
    requestId: doc.requestId ? String(doc.requestId) : null,
    before: doc.before,
    after: doc.after,
    metadata: doc.metadata ? (doc.metadata as Record<string, unknown>) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Protected CSV export / backup.                                              */
/* -------------------------------------------------------------------------- */

export interface AuditExportResult {
  filename: string;
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

const EXPORT_MAX_ROWS = 250_000;
const encoder = new TextEncoder();

export async function exportAuditLogs(
  restaurantId: string,
  filters: AuditLogFilters = {}
): Promise<AuditExportResult> {
  await connectDB();
  const match = buildMatch(restaurantId, filters);
  const cursor = TableAuditLogModel.find(match)
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor();

  const transform = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transform.writable.getWriter();
  const headers = csvLine(exportHeaders);
  const names = await resolveActorNamesFromCursor(restaurantId);

  (async () => {
    let count = 0;
    try {
      await writer.write(encoder.encode(`${headers}\r\n`));
      for await (const doc of cursor as unknown as AsyncIterable<Record<string, unknown>>) {
        if (count >= EXPORT_MAX_ROWS) break;
        count += 1;
        const view = docToView(doc);
        await writer.write(
          encoder.encode(`${csvLine(exportRow(view, names))}\r\n`)
        );
      }
    } catch (err) {
      try {
        await writer.abort(err);
      } catch {
        // client closed the connection
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // already closed/aborted
      }
    }
  })();

  const filename = `zyp-pos-audit-${
    new Date().toISOString().slice(0, 10)
  }.csv`;

  return {
    filename,
    contentType: "text/csv; charset=utf-8",
    stream: transform.readable,
  };
}

const exportHeaders = [
  "Timestamp",
  "Actor ID",
  "Actor",
  "Role",
  "Action",
  "Resource",
  "Resource ID",
  "Success",
  "Reason",
  "IP",
  "Request ID",
] as CsvCell[];

async function resolveActorNamesFromCursor(
  restaurantId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    await connectDB();
    const users = await UserModel.find({ restaurantId })
      .select("_id fullName")
      .lean();
    for (const user of users) {
      map.set(String(user._id as unknown as ObjectId), user.fullName);
    }
  } catch {
    // best effort
  }
  return map;
}

function exportRow(
  view: AuditLogView,
  names: Map<string, string>
): CsvCell[] {
  return [
    view.createdAt,
    view.actorUserId ?? "",
    view.actorUserId ? (names.get(view.actorUserId) ?? "Unknown staff") : "System",
    view.actorRole ?? "",
    view.action,
    view.resourceType,
    view.resourceId ?? "",
    view.success ? "success" : "failure",
    view.reason ?? "",
    view.ip ?? "",
    view.requestId ?? "",
  ];
}

/* -------------------------------------------------------------------------- */
/* UI metadata (labels for filter dropdowns).                                  */
/* -------------------------------------------------------------------------- */

export const AUDIT_ACTIONS: readonly TableAuditAction[] = TABLE_AUDIT_ACTIONS;
export const AUDIT_ENTITY_TYPES_LIST: readonly AuditEntityType[] =
  AUDIT_ENTITY_TYPES;