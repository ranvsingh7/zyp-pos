import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { InventoryItemModel } from "@/models/InventoryItem";
import { InventoryCategoryModel } from "@/models/InventoryCategory";
import {
  INVENTORY_PAGE_SIZE,
  LOW_STOCK_DASHBOARD_LIMIT,
  type InventoryBaseUnit,
  type InventoryStockStatus,
  type InventoryUnit,
} from "@/lib/inventory/constants";
import {
  DuplicateInventoryCategoryError,
  DuplicateInventoryItemError,
  InventoryCategoryNotFoundError,
  InventoryItemNotFoundError,
  InventoryValidationError,
} from "@/lib/inventory/errors";
import {
  baseUnitFor,
  formatStockQuantity,
  ratePerBasePaise,
  ratePerUnitPaise,
  stockStatusFor,
  toBaseQuantity,
  unitLabel,
} from "@/lib/inventory/units";
import {
  containsCaseInsensitiveRegex,
  exactCaseInsensitiveRegex,
  toIso,
} from "@/lib/inventory/utils";
import { formatPaise, rupeesToPaise } from "@/lib/menu/prices";
import { recordAudit } from "@/lib/tables/audit";
import type {
  InventoryCategoryInput,
  InventoryItemInput,
} from "@/lib/inventory/validation";
import type {
  NormalizedInventoryQuery,
} from "@/lib/inventory/query";
import type {
  InventoryCategoryView,
  InventoryItemView,
  InventorySummary,
  Paged,
} from "@/lib/inventory/types";

interface InventoryItemDoc {
  _id: unknown;
  name: string;
  description?: string | null;
  categoryId?: unknown;
  unit: string;
  baseUnit: string;
  currentStock: number;
  minimumStock: number;
  costPricePaise: number;
  sku?: string | null;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function inventoryItemToView(
  doc: InventoryItemDoc,
  categoryName: string | null
): InventoryItemView {
  const unit = doc.unit as InventoryUnit;
  const currentStock = doc.currentStock ?? 0;
  const minimumStock = doc.minimumStock ?? 0;
  const costPricePaise = doc.costPricePaise ?? 0;
  const costPerUnitPaise = ratePerUnitPaise(costPricePaise, unit);

  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description ?? null,
    categoryId: doc.categoryId ? String(doc.categoryId) : null,
    categoryName,
    sku: doc.sku ?? null,
    isActive: doc.isActive,
    unit,
    baseUnit: doc.baseUnit as InventoryBaseUnit,
    currentStock,
    minimumStock,
    costPricePaise,
    stockValuePaise: Math.round(currentStock * costPricePaise),
    status: stockStatusFor(currentStock, minimumStock),
    currentStockLabel: formatStockQuantity(currentStock, unit),
    minimumStockLabel: formatStockQuantity(minimumStock, unit),
    costPerUnitPaise,
    costPerUnitLabel: `${formatPaise(costPerUnitPaise)} / ${unitLabel(unit)}`,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function listInventoryCategories(
  restaurantId: string,
  options: { includeInactive?: boolean } = {}
): Promise<InventoryCategoryView[]> {
  await connectDB();
  const query: Record<string, unknown> = { restaurantId };
  if (!options.includeInactive) query.isActive = true;

  const [categories, counts] = await Promise.all([
    InventoryCategoryModel.find(query).sort({ displayOrder: 1, name: 1 }).lean(),
    InventoryItemModel.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          isActive: true,
          categoryId: { $ne: null },
        },
      },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]),
  ]);

  const countByCategory = new Map<string, number>();
  for (const row of counts as { _id: unknown; count: number }[]) {
    countByCategory.set(String(row._id), row.count);
  }

  return categories.map((category) => ({
    id: String(category._id),
    name: category.name,
    displayOrder: category.displayOrder ?? 0,
    isActive: category.isActive,
    itemCount: countByCategory.get(String(category._id)) ?? 0,
  }));
}

async function assertUniqueCategoryName(
  restaurantId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const query: Record<string, unknown> = {
    restaurantId,
    name: exactCaseInsensitiveRegex(name),
  };
  if (excludeId) query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
  if (await InventoryCategoryModel.exists(query)) {
    throw new DuplicateInventoryCategoryError(
      `A category named "${name}" already exists.`
    );
  }
}

export async function createInventoryCategory(
  restaurantId: string,
  input: InventoryCategoryInput
): Promise<InventoryCategoryView> {
  await connectDB();
  const name = input.name.trim();
  await assertUniqueCategoryName(restaurantId, name);
  const displayOrder =
    input.displayOrder ??
    (await InventoryCategoryModel.countDocuments({ restaurantId }));

  const doc = await InventoryCategoryModel.create({
    restaurantId,
    name,
    displayOrder,
    isActive: input.isActive,
  });

  return {
    id: String(doc._id),
    name: doc.name,
    displayOrder: doc.displayOrder,
    isActive: doc.isActive,
    itemCount: 0,
  };
}

export async function updateInventoryCategory(
  restaurantId: string,
  categoryId: string,
  input: InventoryCategoryInput
): Promise<InventoryCategoryView> {
  await connectDB();
  const existing = await InventoryCategoryModel.findOne({
    _id: categoryId,
    restaurantId,
  });
  if (!existing) throw new InventoryCategoryNotFoundError();

  const name = input.name.trim();
  await assertUniqueCategoryName(restaurantId, name, categoryId);

  existing.name = name;
  existing.displayOrder = input.displayOrder ?? existing.displayOrder;
  existing.isActive = input.isActive;
  await existing.save();

  const itemCount = await InventoryItemModel.countDocuments({
    restaurantId,
    categoryId,
    isActive: true,
  });

  return {
    id: String(existing._id),
    name: existing.name,
    displayOrder: existing.displayOrder,
    isActive: existing.isActive,
    itemCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Items                                                                      */
/* -------------------------------------------------------------------------- */

async function assertUniqueItemName(
  restaurantId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const query: Record<string, unknown> = {
    restaurantId,
    name: exactCaseInsensitiveRegex(name),
  };
  if (excludeId) query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
  if (await InventoryItemModel.exists(query)) {
    throw new DuplicateInventoryItemError(
      `An inventory item named "${name}" already exists.`
    );
  }
}

async function assertUniqueSku(
  restaurantId: string,
  sku: string | null,
  excludeId?: string
): Promise<void> {
  if (!sku) return;
  const query: Record<string, unknown> = {
    restaurantId,
    sku: exactCaseInsensitiveRegex(sku),
  };
  if (excludeId) query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
  if (await InventoryItemModel.exists(query)) {
    throw new DuplicateInventoryItemError(
      `An item with SKU "${sku}" already exists.`
    );
  }
}

async function assertCategoryInRestaurant(
  restaurantId: string,
  categoryId: string
): Promise<void> {
  const exists = await InventoryCategoryModel.exists({
    _id: categoryId,
    restaurantId,
  });
  if (!exists) {
    throw new InventoryValidationError("The selected category is not valid.");
  }
}

async function categoryNameFor(
  restaurantId: string,
  categoryId: unknown
): Promise<string | null> {
  if (!categoryId) return null;
  const category = await InventoryCategoryModel.findOne({
    _id: categoryId,
    restaurantId,
  })
    .select("name")
    .lean();
  return category ? String(category.name) : null;
}

export async function createInventoryItem(
  restaurantId: string,
  userId: string,
  input: InventoryItemInput
): Promise<InventoryItemView> {
  await connectDB();
  const name = input.name.trim();
  await assertUniqueItemName(restaurantId, name);
  await assertUniqueSku(restaurantId, input.sku ?? null);
  if (input.categoryId) {
    await assertCategoryInRestaurant(restaurantId, input.categoryId);
  }

  const unit = input.unit;
  const doc = await InventoryItemModel.create({
    restaurantId,
    name,
    description: input.description,
    categoryId: input.categoryId,
    unit,
    baseUnit: baseUnitFor(unit),
    currentStock: 0,
    minimumStock: toBaseQuantity(input.minimumStock, unit),
    costPricePaise: ratePerBasePaise(rupeesToPaise(input.costPriceRupees), unit),
    sku: input.sku,
    isActive: input.isActive,
    createdBy: userId,
  });

  await recordAudit({
    restaurantId,
    userId,
    action: "INVENTORY_ITEM_CREATED",
    entityType: "INVENTORY_ITEM",
    entityId: String(doc._id),
    metadata: { name, unit },
  });

  return inventoryItemToView(
    doc as unknown as InventoryItemDoc,
    await categoryNameFor(restaurantId, doc.categoryId)
  );
}

export async function updateInventoryItem(
  restaurantId: string,
  userId: string,
  itemId: string,
  input: InventoryItemInput
): Promise<InventoryItemView> {
  await connectDB();
  const existing = await InventoryItemModel.findOne({
    _id: itemId,
    restaurantId,
  });
  if (!existing) throw new InventoryItemNotFoundError();

  const name = input.name.trim();
  await assertUniqueItemName(restaurantId, name, itemId);
  await assertUniqueSku(restaurantId, input.sku ?? null, itemId);
  if (input.categoryId) {
    await assertCategoryInRestaurant(restaurantId, input.categoryId);
  }

  // Changing the family of an item's unit would silently reinterpret existing
  // stock balances, so it is rejected. Display-unit changes within the same
  // family (KG <-> G) are allowed.
  const nextBaseUnit = baseUnitFor(input.unit);
  if (String(existing.baseUnit) !== nextBaseUnit) {
    throw new InventoryValidationError(
      `This item's stock is tracked in ${existing.baseUnit}. You can only use a compatible unit (for example kg or g).`
    );
  }

  existing.name = name;
  existing.description = input.description as typeof existing.description;
  existing.categoryId =
    (input.categoryId ?? null) as unknown as typeof existing.categoryId;
  existing.unit = input.unit;
  existing.minimumStock = toBaseQuantity(input.minimumStock, input.unit);
  existing.costPricePaise = ratePerBasePaise(
    rupeesToPaise(input.costPriceRupees),
    input.unit
  );
  existing.sku = input.sku as typeof existing.sku;
  existing.isActive = input.isActive;
  await existing.save();

  await recordAudit({
    restaurantId,
    userId,
    action: "INVENTORY_ITEM_UPDATED",
    entityType: "INVENTORY_ITEM",
    entityId: itemId,
    metadata: { name, unit: input.unit },
  });

  return inventoryItemToView(
    existing as unknown as InventoryItemDoc,
    await categoryNameFor(restaurantId, existing.categoryId)
  );
}

export async function setInventoryItemActive(
  restaurantId: string,
  userId: string,
  itemId: string,
  isActive: boolean
): Promise<InventoryItemView> {
  await connectDB();
  const doc = await InventoryItemModel.findOneAndUpdate(
    { _id: itemId, restaurantId },
    { $set: { isActive } },
    { returnDocument: "after" }
  );
  if (!doc) throw new InventoryItemNotFoundError();

  await recordAudit({
    restaurantId,
    userId,
    action: isActive
      ? "INVENTORY_ITEM_REACTIVATED"
      : "INVENTORY_ITEM_DEACTIVATED",
    entityType: "INVENTORY_ITEM",
    entityId: itemId,
    metadata: { name: doc.name },
  });

  return inventoryItemToView(
    doc as unknown as InventoryItemDoc,
    await categoryNameFor(restaurantId, doc.categoryId)
  );
}

export async function getInventoryItem(
  restaurantId: string,
  itemId: string
): Promise<InventoryItemView> {
  await connectDB();
  const doc = await InventoryItemModel.findOne({
    _id: itemId,
    restaurantId,
  }).lean();
  if (!doc) throw new InventoryItemNotFoundError();
  return inventoryItemToView(
    doc as unknown as InventoryItemDoc,
    await categoryNameFor(restaurantId, doc.categoryId)
  );
}

function itemMatch(
  restaurantId: string,
  query: NormalizedInventoryQuery
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  };
  match.isActive = query.filter !== "inactive";
  if (query.categoryId) {
    match.categoryId = new mongoose.Types.ObjectId(query.categoryId);
  }
  if (query.q) {
    const rx = containsCaseInsensitiveRegex(query.q);
    match.$or = [{ name: rx }, { sku: rx }];
  }
  return match;
}

const STATUS_BY_FILTER: Partial<
  Record<NormalizedInventoryQuery["filter"], InventoryStockStatus>
> = {
  in: "IN_STOCK",
  low: "LOW_STOCK",
  out: "OUT_OF_STOCK",
};

function itemSortSpec(
  sort: NormalizedInventoryQuery["sort"]
): Record<string, 1 | -1> {
  switch (sort) {
    case "stock_asc":
      return { currentStock: 1, sortName: 1 };
    case "stock_desc":
      return { currentStock: -1, sortName: 1 };
    case "value_desc":
      return { stockValuePaise: -1, sortName: 1 };
    case "cost_desc":
      return { costPricePaise: -1, sortName: 1 };
    case "recent":
      return { updatedAt: -1 };
    case "name":
    default:
      return { sortName: 1 };
  }
}

export async function listInventoryItems(
  restaurantId: string,
  query: NormalizedInventoryQuery
): Promise<Paged<InventoryItemView>> {
  await connectDB();

  const basePipeline: mongoose.PipelineStage[] = [
    { $match: itemMatch(restaurantId, query) },
    {
      $addFields: {
        sortName: { $toLower: "$name" },
        stockValuePaise: { $multiply: ["$currentStock", "$costPricePaise"] },
        status: {
          $cond: [
            { $lte: ["$currentStock", 0] },
            "OUT_OF_STOCK",
            {
              $cond: [
                { $lte: ["$currentStock", "$minimumStock"] },
                "LOW_STOCK",
                "IN_STOCK",
              ],
            },
          ],
        },
      },
    },
  ];

  const wantedStatus = STATUS_BY_FILTER[query.filter];
  if (wantedStatus) {
    basePipeline.push({ $match: { status: wantedStatus } });
  }

  const pageSize = INVENTORY_PAGE_SIZE;
  const skip = (query.page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    InventoryItemModel.aggregate([
      ...basePipeline,
      { $sort: itemSortSpec(query.sort) },
      { $skip: skip },
      { $limit: pageSize },
    ]),
    InventoryItemModel.aggregate([...basePipeline, { $count: "total" }]),
  ]);

  const total = (countRows[0] as { total?: number } | undefined)?.total ?? 0;

  const categoryIds = [
    ...new Set(
      (rows as InventoryItemDoc[])
        .map((row) => (row.categoryId ? String(row.categoryId) : null))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const categoryNameById = new Map<string, string>();
  if (categoryIds.length) {
    const categories = await InventoryCategoryModel.find({
      restaurantId,
      _id: { $in: categoryIds },
    })
      .select("_id name")
      .lean();
    for (const category of categories) {
      categoryNameById.set(String(category._id), String(category.name));
    }
  }

  const views = (rows as InventoryItemDoc[]).map((row) =>
    inventoryItemToView(
      row,
      row.categoryId
        ? categoryNameById.get(String(row.categoryId)) ?? null
        : null
    )
  );

  return {
    rows: views,
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
  };
}

export async function getInventorySummary(
  restaurantId: string
): Promise<InventorySummary> {
  await connectDB();
  const base = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    isActive: true,
  };

  const [totalItems, lowStockCount, outOfStockCount, valueRows] =
    await Promise.all([
      InventoryItemModel.countDocuments(base),
      InventoryItemModel.countDocuments({
        ...base,
        $expr: {
          $and: [
            { $gt: ["$currentStock", 0] },
            { $lte: ["$currentStock", "$minimumStock"] },
          ],
        },
      }),
      InventoryItemModel.countDocuments({
        ...base,
        $expr: { $lte: ["$currentStock", 0] },
      }),
      InventoryItemModel.aggregate([
        { $match: base },
        {
          $group: {
            _id: null,
            value: { $sum: { $multiply: ["$currentStock", "$costPricePaise"] } },
          },
        },
      ]),
    ]);

  const inventoryValuePaise = Math.round(
    (valueRows[0] as { value?: number } | undefined)?.value ?? 0
  );

  return {
    totalItems,
    inStockCount: Math.max(0, totalItems - lowStockCount - outOfStockCount),
    lowStockCount,
    outOfStockCount,
    inventoryValuePaise,
  };
}

async function listItemsByStatus(
  restaurantId: string,
  status: InventoryStockStatus,
  limit: number
): Promise<InventoryItemView[]> {
  await connectDB();
  const rows = await InventoryItemModel.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        isActive: true,
      },
    },
    {
      $addFields: {
        status: {
          $cond: [
            { $lte: ["$currentStock", 0] },
            "OUT_OF_STOCK",
            {
              $cond: [
                { $lte: ["$currentStock", "$minimumStock"] },
                "LOW_STOCK",
                "IN_STOCK",
              ],
            },
          ],
        },
      },
    },
    { $match: { status } },
    { $sort: { currentStock: 1, name: 1 } },
    { $limit: limit },
  ]);
  return (rows as InventoryItemDoc[]).map((row) =>
    inventoryItemToView(row, null)
  );
}

export async function listLowStockItems(
  restaurantId: string,
  limit: number = LOW_STOCK_DASHBOARD_LIMIT
): Promise<InventoryItemView[]> {
  return listItemsByStatus(restaurantId, "LOW_STOCK", limit);
}

export async function listOutOfStockItems(
  restaurantId: string,
  limit: number = LOW_STOCK_DASHBOARD_LIMIT
): Promise<InventoryItemView[]> {
  return listItemsByStatus(restaurantId, "OUT_OF_STOCK", limit);
}

/** Server-side item search for pickers (never loads the whole catalogue). */
export async function searchInventoryItems(
  restaurantId: string,
  term: string,
  limit = 20
): Promise<InventoryItemView[]> {
  await connectDB();
  const query: Record<string, unknown> = { restaurantId, isActive: true };
  const trimmed = term.trim();
  if (trimmed) {
    const rx = containsCaseInsensitiveRegex(trimmed);
    query.$or = [{ name: rx }, { sku: rx }];
  }

  const docs = await InventoryItemModel.find(query)
    .sort({ name: 1 })
    .limit(Math.min(Math.max(limit, 1), 50))
    .lean();

  return (docs as unknown as InventoryItemDoc[]).map((doc) =>
    inventoryItemToView(doc, null)
  );
}


