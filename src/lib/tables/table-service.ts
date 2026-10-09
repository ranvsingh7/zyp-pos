import "server-only";

import { unstable_cache } from "next/cache";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { tableDataTag } from "@/lib/cache-tags";
import { withNextCache } from "@/lib/next-cache";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { TableSectionModel } from "@/models/TableSection";
import { OrderModel } from "@/models/Order";
import {
  TableNotFoundError,
  TableValidationError,
  TableInUseError,
} from "@/lib/tables/errors";
import { exactCaseInsensitiveRegex, naturalCompare } from "@/lib/tables/utils";
import type { TableInput } from "@/lib/tables/validation";
import type { TableView } from "@/lib/tables/types";
import type { TableSectionView } from "@/lib/tables/types";
import type { TableStatus } from "@/lib/tables/constants";

export interface ListTablesOptions {
  includeInactive?: boolean;
  sectionId?: string | null;
  status?: TableStatus | null;
  search?: string | null;
}

interface TableDoc {
  _id: unknown;
  name: string;
  capacity: number;
  sectionId?: unknown;
  status: TableStatus;
  isActive: boolean;
  displayOrder: number;
  position?: { x: number; y: number } | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type TableDocument = TableDoc;

export function tableToView(
  doc: TableDocument,
  sectionName: string | null
): TableView {
  const rawStatus: unknown = doc.status;
  const status: TableStatus = ["AVAILABLE", "OCCUPIED", "RESERVED"].includes(
    String(rawStatus)
  )
    ? (String(rawStatus) as TableStatus)
    : "AVAILABLE";
  return {
    id: String(doc._id),
    name: doc.name,
    capacity: doc.capacity,
    sectionId: doc.sectionId ? String(doc.sectionId) : null,
    sectionName,
    status,
    isActive: doc.isActive,
    displayOrder: doc.displayOrder,
    position: doc.position ?? null,
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
    updatedAt: doc.updatedAt ? String(doc.updatedAt) : "",
  };
}

export async function getTables(
  restaurantId: string,
  options: ListTablesOptions = {}
): Promise<TableView[]> {
  await connectDB();

  const query: Record<string, unknown> = { restaurantId };
  if (!options.includeInactive) query.isActive = true;
  if (options.sectionId) query.sectionId = options.sectionId;
  if (options.status) query.status = options.status;
  if (options.search && options.search.trim()) {
    query.name = exactCaseInsensitiveRegex(options.search.trim());
  }

  const [tables, sections] = await Promise.all([
    RestaurantTableModel.find(query).sort({ displayOrder: 1 }).lean(),
    TableSectionModel.find({ restaurantId }).select("_id name").lean(),
  ]);

  const sectionNameById = new Map<string, string>();
  for (const s of sections) {
    sectionNameById.set(String(s._id), String(s.name));
  }

  const views = tables.map((t) =>
    tableToView(
      t as unknown as TableDoc,
      t.sectionId ? sectionNameById.get(String(t.sectionId)) ?? null : null
    )
  );

  return views.sort(
    (a, b) =>
      a.displayOrder - b.displayOrder ||
      naturalCompare(a.name, b.name) ||
      a.id.localeCompare(b.id)
  );
}

export async function getTablesAndSections(
  restaurantId: string
): Promise<{ tables: TableView[]; sections: TableSectionView[] }> {
  return withNextCache(
    () =>
      unstable_cache(
        () => loadTablesAndSections(restaurantId),
        ["tables-and-sections", restaurantId],
        { tags: [tableDataTag(restaurantId)], revalidate: 300 }
      )(),
    () => loadTablesAndSections(restaurantId)
  );
}

async function loadTablesAndSections(
  restaurantId: string
): Promise<{ tables: TableView[]; sections: TableSectionView[] }> {
  await connectDB();

  const [tableDocs, sectionDocs] = await Promise.all([
    RestaurantTableModel.find({ restaurantId, isActive: true })
      .sort({ displayOrder: 1 })
      .lean(),
    TableSectionModel.find({ restaurantId, isActive: true })
      .sort({ displayOrder: 1 })
      .lean(),
  ]);

  const sectionNameById = new Map(
    sectionDocs.map((section) => [String(section._id), String(section.name)])
  );
  const tables = tableDocs
    .map((table) =>
      tableToView(
        table as unknown as TableDocument,
        table.sectionId
          ? sectionNameById.get(String(table.sectionId)) ?? null
          : null
      )
    )
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        naturalCompare(a.name, b.name) ||
        a.id.localeCompare(b.id)
    );

  const sections = sectionDocs
    .map((section) => ({
      id: String(section._id),
      name: String(section.name),
      displayOrder: section.displayOrder,
      isActive: section.isActive,
    }))
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        naturalCompare(a.name, b.name) ||
        a.id.localeCompare(b.id)
    );

  return { tables, sections };
}

async function assertUniqueTableName(
  restaurantId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const query: Record<string, unknown> = {
    restaurantId,
    name: exactCaseInsensitiveRegex(name),
  };
  if (excludeId) query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };

  const existing = await RestaurantTableModel.findOne(query)
    .select("_id")
    .lean();
  if (existing) {
    throw new TableValidationError(`A table named "${name}" already exists.`);
  }
}

async function assertSectionInRestaurant(
  restaurantId: string,
  sectionId: string
): Promise<void> {
  const section = await TableSectionModel.findOne({
    _id: sectionId,
    restaurantId,
  })
    .select("_id")
    .lean();
  if (!section) {
    throw new TableValidationError("The selected section is not valid.");
  }
}

/**
 * Returns true when this table is referenced by a current or historical order
 * (or future bill). Referenced tables can never be hard-deleted — the caller
 * should soft-delete them instead.
 */
export async function hasTableReferences(
  restaurantId: string,
  tableId: string
): Promise<boolean> {
  await connectDB();
  const existing = await OrderModel.exists({ restaurantId, tableId });
  return Boolean(existing);
}

export async function createTable(
  restaurantId: string,
  input: TableInput
): Promise<TableView> {
  await connectDB();
  const name = input.name.trim();
  await assertUniqueTableName(restaurantId, name);
  if (input.sectionId) {
    await assertSectionInRestaurant(restaurantId, input.sectionId);
  }

  const displayOrder =
    input.displayOrder ??
    (await RestaurantTableModel.countDocuments({ restaurantId }));

  const doc = await RestaurantTableModel.create({
    restaurantId,
    name,
    capacity: input.capacity,
    sectionId: input.sectionId ?? null,
    status: input.status,
    isActive: input.isActive,
    displayOrder,
    position: null,
  });

  return tableToView(doc as unknown as TableDoc, null);
}

export async function updateTable(
  restaurantId: string,
  tableId: string,
  input: TableInput
): Promise<TableView> {
  await connectDB();
  const existing = await RestaurantTableModel.findOne({
    _id: tableId,
    restaurantId,
  });
  if (!existing) throw new TableNotFoundError();

  const name = input.name.trim();
  await assertUniqueTableName(restaurantId, name, tableId);
  if (input.sectionId) {
    const currentSection = existing.sectionId
      ? String(existing.sectionId)
      : null;
    if (currentSection !== input.sectionId) {
      await assertSectionInRestaurant(restaurantId, input.sectionId);
    }
  }

  existing.name = name;
  existing.capacity = input.capacity;
  existing.sectionId = (input.sectionId ?? null) as unknown as (typeof existing)["sectionId"];
  existing.status = input.status;
  existing.isActive = input.isActive;
  existing.displayOrder = input.displayOrder ?? existing.displayOrder;
  await existing.save();

  return tableToView(existing as unknown as TableDoc, null);
}

export async function updateTableStatus(
  restaurantId: string,
  tableId: string,
  status: TableStatus
): Promise<TableView> {
  await connectDB();
  const doc = await RestaurantTableModel.findOneAndUpdate(
    { _id: tableId, restaurantId, isActive: true },
    { $set: { status } },
    { returnDocument: "after" }
  );
  if (!doc) throw new TableNotFoundError("Table not found.");
  return tableToView(doc as unknown as TableDoc, null);
}

export async function setTableActive(
  restaurantId: string,
  tableId: string,
  isActive: boolean
): Promise<TableView> {
  await connectDB();
  const doc = await RestaurantTableModel.findOneAndUpdate(
    { _id: tableId, restaurantId },
    { $set: { isActive } },
    { returnDocument: "after" }
  );
  if (!doc) throw new TableNotFoundError();
  return tableToView(doc as unknown as TableDoc, null);
}

/**
 * Hard deletes a table, but only when it has no historical/current references.
 * Prefer setTableActive(false) (soft delete) in the UI.
 */
export async function deleteTable(
  restaurantId: string,
  tableId: string
): Promise<void> {
  await connectDB();
  if (await hasTableReferences(restaurantId, tableId)) {
    throw new TableInUseError();
  }
  const result = await RestaurantTableModel.deleteOne({
    _id: tableId,
    restaurantId,
  });
  if (result.deletedCount === 0) throw new TableNotFoundError();
}

/** Reorders a restaurant's tables; records the new order in displayOrder. */
export async function reorderTables(
  restaurantId: string,
  orderedIds: string[]
): Promise<TableView[]> {
  await connectDB();

  const docs = await RestaurantTableModel.find({ restaurantId })
    .select("_id")
    .lean();
  const allowed = new Set(docs.map((d) => String(d._id)));
  if (orderedIds.some((id) => !allowed.has(id))) {
    throw new TableValidationError(
      "One or more tables do not belong to this restaurant."
    );
  }

  await Promise.all(
    orderedIds.map((id, index) =>
      RestaurantTableModel.updateOne(
        { _id: id, restaurantId },
        { $set: { displayOrder: index } }
      )
    )
  );

  return getTables(restaurantId, { includeInactive: true });
}