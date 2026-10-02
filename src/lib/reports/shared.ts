import "server-only";

import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import type { UtcRange } from "@/lib/orders/date-range";
import type { Role } from "@/lib/auth/roles";
import { getBusinessDateRange } from "./date-range";
import { REPORT_DATE_RANGE_LABELS } from "./constants";
import type { ReportQuery, ReportRangeMeta } from "./types";

export interface StaffInfo {
  fullName: string;
  role: Role;
}

export type StaffMap = Record<string, StaffInfo>;

export function toObjectId(id: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

/** Resolves the query's date range plus the metadata the UI displays. */
export function resolveReportRange(
  query: ReportQuery,
  now: Date = new Date()
): { range: UtcRange; meta: ReportRangeMeta } {
  const range = getBusinessDateRange(query.date, {
    from: query.from ?? undefined,
    to: query.to ?? undefined,
    now,
  });
  const label =
    query.date === "custom"
      ? `${query.from ?? "…"} → ${query.to ?? "…"}`
      : REPORT_DATE_RANGE_LABELS[query.date];
  return {
    range,
    meta: {
      filter: query.date,
      label,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
  };
}

/** Tenant-scoped staff lookup used to hydrate "by X" columns. */
export async function loadStaffMap(
  restaurantId: string,
  ids: Array<string | null | undefined>
): Promise<StaffMap> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
    .filter((id) => mongoose.isValidObjectId(id))
    .map(toObjectId);
  if (unique.length === 0) return {};
  const docs = await UserModel.find({ restaurantId, _id: { $in: unique } })
    .select("fullName role")
    .lean();
  const map: StaffMap = {};
  for (const doc of docs) {
    map[String(doc._id)] = {
      fullName: doc.fullName,
      role: doc.role as Role,
    };
  }
  return map;
}

export interface PageResult {
  page: number;
  pageCount: number;
}

export function paginate(total: number, requestedPage: number, perPage: number): PageResult {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return { page, pageCount };
}
