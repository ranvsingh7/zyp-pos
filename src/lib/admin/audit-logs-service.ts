import "server-only";

import type { QueryFilter } from "mongoose";
import { connectDB } from "@/lib/db";
import { TableAuditLogModel, TABLE_AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/models/TableAuditLog";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";

export interface PlatformAuditLogView {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PlatformAuditFilters {
  action?: string;
  entityType?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

export async function listPlatformAuditLogs(
  filters: PlatformAuditFilters = {}
): Promise<{ items: PlatformAuditLogView[]; total: number; page: number; pageSize: number }> {
  await connectDB();
  const page = Math.max(1, Number(filters.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(filters.pageSize ?? 25)));

  const query: QueryFilter<Record<string, unknown>> = {};
  if (filters.action) {
    query.action = filters.action;
  }
  if (filters.entityType) {
    query.entityType = filters.entityType;
  }
  if (filters.dateFrom || filters.dateTo) {
    query.createdAt = {};
    if (filters.dateFrom) query.createdAt.$gte = filters.dateFrom;
    if (filters.dateTo) query.createdAt.$lte = filters.dateTo;
  }
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    query.$or = [
      { summary: { $regex: term, $options: "i" } },
      { entityName: { $regex: term, $options: "i" } },
    ];
  }

  const [logs, total] = await Promise.all([
    TableAuditLogModel.find(query as QueryFilter<{ createdAt: Date }>)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    TableAuditLogModel.countDocuments(query as QueryFilter<{ createdAt: Date }>),
  ]);

  const actorIds = [
    ...new Set(logs.flatMap((log) => (log.userId ? [String(log.userId)] : []))),
  ];
  const restaurantIds = [
    ...new Set(
      logs.flatMap((log) =>
        log.restaurantId ? [String(log.restaurantId)] : []
      )
    ),
  ];
  const [users, restaurants] = await Promise.all([
    actorIds.length
      ? UserModel.find({ _id: { $in: actorIds } })
          .select("_id fullName email")
          .lean()
      : [],
    restaurantIds.length
      ? RestaurantModel.find({ _id: { $in: restaurantIds } })
          .select("_id name")
          .lean()
      : [],
  ]);

  const userById = new Map(users.map((u) => [String(u._id), u]));
  const restaurantById = new Map(
    restaurants.map((r) => [String(r._id), String(r.name)])
  );

  const items = logs.map((log) => {
    const actor = log.userId ? userById.get(String(log.userId)) : null;
    return {
      id: String(log._id),
      action: String(log.action),
      entityType: String(log.entityType ?? ""),
      entityId: log.entityId != null ? String(log.entityId) : null,
      entityName: log.entityName ? String(log.entityName) : null,
      restaurantId: log.restaurantId ? String(log.restaurantId) : null,
      restaurantName: log.restaurantId
        ? restaurantById.get(String(log.restaurantId)) ?? null
        : null,
      actorId: log.userId ? String(log.userId) : null,
      actorName: actor ? String(actor.fullName) : null,
      actorRole: log.actorRole ? String(log.actorRole) : null,
      summary: log.summary ? String(log.summary) : null,
      metadata: log.metadata && typeof log.metadata === "object"
        ? (log.metadata as Record<string, unknown>)
        : null,
      createdAt: new Date(log.createdAt as string | number | Date),
    };
  });

  return { items, total, page, pageSize };
}

export { TABLE_AUDIT_ACTIONS, AUDIT_ENTITY_TYPES };