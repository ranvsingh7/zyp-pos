import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { InventoryItemModel } from "@/models/InventoryItem";
import { StockMovementModel } from "@/models/StockMovement";
import { UserModel } from "@/models/User";
import {
  MOVEMENT_PAGE_SIZE,
  isStockInType,
  type InventoryBaseUnit,
  type InventoryUnit,
  type StockMovementReferenceType,
  type StockMovementType,
} from "@/lib/inventory/constants";
import {
  IncompatibleUnitError,
  InsufficientStockError,
  InventoryItemNotFoundError,
  InventoryValidationError,
} from "@/lib/inventory/errors";
import {
  formatQuantity,
  formatStockQuantity,
  isUnitCompatibleWithBase,
  ratePerBasePaise,
  toBaseQuantity,
} from "@/lib/inventory/units";
import {
  containsCaseInsensitiveRegex,
  dateRangeFilter,
  toIso,
} from "@/lib/inventory/utils";
import { recordAudit } from "@/lib/tables/audit";
import type { NormalizedMovementQuery } from "@/lib/inventory/query";
import type { Paged, StockMovementView } from "@/lib/inventory/types";

interface StockMovementDoc {
  _id: unknown;
  inventoryItemId: unknown;
  itemNameSnapshot: string;
  type: StockMovementType;
  direction: "IN" | "OUT";
  quantity: number;
  baseQuantity: number;
  unit: InventoryUnit;
  beforeStock: number;
  afterStock: number;
  ratePaise?: number | null;
  referenceType: StockMovementReferenceType;
  referenceId?: unknown;
  reason?: string | null;
  note?: string | null;
  createdBy: unknown;
  createdAt?: unknown;
}

export function stockMovementToView(
  doc: StockMovementDoc,
  createdByName: string | null
): StockMovementView {
  const sign = doc.direction === "IN" ? "+" : "-";
  return {
    id: String(doc._id),
    inventoryItemId: String(doc.inventoryItemId),
    itemName: doc.itemNameSnapshot,
    type: doc.type,
    direction: doc.direction,
    quantity: doc.quantity,
    unit: doc.unit,
    quantityLabel: `${sign}${formatQuantity(doc.quantity, doc.unit)}`,
    baseQuantity: doc.baseQuantity,
    beforeStock: doc.beforeStock,
    afterStock: doc.afterStock,
    beforeStockLabel: formatStockQuantity(doc.beforeStock, doc.unit),
    afterStockLabel: formatStockQuantity(doc.afterStock, doc.unit),
    ratePaise: doc.ratePaise ?? null,
    referenceType: doc.referenceType,
    referenceId: doc.referenceId ? String(doc.referenceId) : null,
    reason: doc.reason ?? null,
    note: doc.note ?? null,
    createdByName,
    createdAt: toIso(doc.createdAt),
  };
}

async function userNameMap(
  userIds: unknown[]
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      userIds.filter(Boolean).map((id) => String(id))
    ),
  ];
  if (!ids.length) return new Map();
  const users = await UserModel.find({ _id: { $in: ids } })
    .select("_id fullName")
    .lean();
  const map = new Map<string, string>();
  for (const user of users) map.set(String(user._id), String(user.fullName));
  return map;
}

export interface ApplyStockChangeInput {
  restaurantId: string;
  userId: string;
  itemId: string;
  quantity: number;
  unit: InventoryUnit;
  type: StockMovementType;
  referenceType: StockMovementReferenceType;
  referenceId?: string | null;
  reason?: string | null;
  note?: string | null;
  /** Purchase rate per entered unit, in paise (used when updateCostPrice). */
  ratePaisePerUnit?: number | null;
  /** For purchases: make this the item's latest cost price. */
  updateCostPrice?: boolean;
}

export interface ApplyStockChangeResult {
  itemId: string;
  movementId: string;
  beforeStock: number;
  afterStock: number;
  baseQuantity: number;
}

/**
 * Applies a single stock change and writes the matching ledger entry.
 *
 * The balance is updated with an atomic conditional `$inc` (never a
 * read-modify-write), so concurrent movements cannot lose updates and stock
 * can never go negative. We deliberately do not rely on multi-document
 * transactions: the same approach the billing module uses, and it works on
 * both standalone and replica-set MongoDB. The trade-off is documented in
 * docs/inventory-management-module.md (item balance is a cache of the ledger).
 */
export async function applyStockChange(
  input: ApplyStockChangeInput
): Promise<ApplyStockChangeResult> {
  await connectDB();

  const item = await InventoryItemModel.findOne({
    _id: input.itemId,
    restaurantId: input.restaurantId,
  }).lean();
  if (!item) throw new InventoryItemNotFoundError();
  if (!item.isActive) {
    throw new InventoryValidationError(
      "This item is inactive. Reactivate it before moving stock."
    );
  }

  const baseUnit = String(item.baseUnit) as InventoryBaseUnit;
  if (!isUnitCompatibleWithBase(baseUnit, input.unit)) {
    throw new IncompatibleUnitError(
      `Stock for ${item.name} is tracked in ${baseUnit}. Use a compatible unit.`
    );
  }

  const baseQuantity = toBaseQuantity(input.quantity, input.unit);
  if (baseQuantity <= 0) {
    throw new InventoryValidationError("Quantity is too small to record.");
  }

  const isIn = isStockInType(input.type);
  let updated: Record<string, unknown> | null = null;

  if (isIn) {
    const update: Record<string, unknown> = {
      $inc: { currentStock: baseQuantity },
    };
    if (input.updateCostPrice && input.ratePaisePerUnit != null) {
      update.$set = {
        costPricePaise: ratePerBasePaise(
          input.ratePaisePerUnit,
          input.unit
        ),
      };
    }
    updated = await InventoryItemModel.findOneAndUpdate(
      { _id: input.itemId, restaurantId: input.restaurantId, isActive: true },
      update,
      { returnDocument: "after" }
    ).lean();
  } else {
    updated = await InventoryItemModel.findOneAndUpdate(
      {
        _id: input.itemId,
        restaurantId: input.restaurantId,
        isActive: true,
        currentStock: { $gte: baseQuantity },
      },
      { $inc: { currentStock: -baseQuantity } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      throw new InsufficientStockError(
        formatStockQuantity(item.currentStock ?? 0, input.unit)
      );
    }
  }

  if (!updated) throw new InventoryItemNotFoundError();

  const afterStock = Number(updated.currentStock);
  const beforeStock = isIn
    ? afterStock - baseQuantity
    : afterStock + baseQuantity;

  const movement = await StockMovementModel.create({
    restaurantId: input.restaurantId,
    inventoryItemId: item._id,
    itemNameSnapshot: item.name,
    type: input.type,
    direction: isIn ? "IN" : "OUT",
    quantity: input.quantity,
    baseQuantity,
    unit: input.unit,
    beforeStock,
    afterStock,
    ratePaise: input.ratePaisePerUnit ?? null,
    referenceType: input.referenceType,
    referenceId: input.referenceId ?? null,
    reason: input.reason ?? null,
    note: input.note ?? null,
    createdBy: input.userId,
  });

  return {
    itemId: String(item._id),
    movementId: String(movement._id),
    beforeStock,
    afterStock,
    baseQuantity,
  };
}

export interface StockChangeSummary {
  itemId: string;
  movementId: string;
  currentStock: number;
  currentStockLabel: string;
  itemName: string;
}

async function loadItemName(restaurantId: string, itemId: string) {
  const item = await InventoryItemModel.findOne({
    _id: itemId,
    restaurantId,
  })
    .select("name unit")
    .lean();
  if (!item) throw new InventoryItemNotFoundError();
  return item;
}

export async function adjustStock(
  restaurantId: string,
  userId: string,
  input: {
    itemId: string;
    mode: "ADD" | "REMOVE";
    quantity: number;
    unit: InventoryUnit;
    reason: string;
    note?: string | null;
  }
): Promise<StockChangeSummary> {
  const item = await loadItemName(restaurantId, input.itemId);
  const type: StockMovementType =
    input.mode === "ADD" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
  const referenceType: StockMovementReferenceType =
    input.mode === "ADD" && input.reason === "Opening Stock"
      ? "OPENING"
      : "ADJUSTMENT";

  const result = await applyStockChange({
    restaurantId,
    userId,
    itemId: input.itemId,
    quantity: input.quantity,
    unit: input.unit,
    type,
    referenceType,
    reason: input.reason,
    note: input.note ?? null,
  });

  await recordAudit({
    restaurantId,
    userId,
    action: input.mode === "ADD" ? "STOCK_ADDED" : "STOCK_REMOVED",
    entityType: "STOCK_MOVEMENT",
    entityId: result.movementId,
    metadata: {
      itemId: input.itemId,
      itemName: item.name,
      quantity: input.quantity,
      unit: input.unit,
      reason: input.reason,
    },
  });

  return {
    itemId: input.itemId,
    movementId: result.movementId,
    currentStock: result.afterStock,
    currentStockLabel: formatStockQuantity(result.afterStock, input.unit),
    itemName: item.name,
  };
}

export async function recordWastage(
  restaurantId: string,
  userId: string,
  input: {
    itemId: string;
    quantity: number;
    unit: InventoryUnit;
    reason: string;
    note?: string | null;
  }
): Promise<StockChangeSummary> {
  const item = await loadItemName(restaurantId, input.itemId);
  const result = await applyStockChange({
    restaurantId,
    userId,
    itemId: input.itemId,
    quantity: input.quantity,
    unit: input.unit,
    type: "WASTAGE",
    referenceType: "WASTAGE",
    reason: input.reason,
    note: input.note ?? null,
  });

  await recordAudit({
    restaurantId,
    userId,
    action: "STOCK_WASTAGE_RECORDED",
    entityType: "STOCK_MOVEMENT",
    entityId: result.movementId,
    metadata: {
      itemId: input.itemId,
      itemName: item.name,
      quantity: input.quantity,
      unit: input.unit,
      reason: input.reason,
    },
  });

  return {
    itemId: input.itemId,
    movementId: result.movementId,
    currentStock: result.afterStock,
    currentStockLabel: formatStockQuantity(result.afterStock, input.unit),
    itemName: item.name,
  };
}

export async function recordConsumption(
  restaurantId: string,
  userId: string,
  input: {
    itemId: string;
    quantity: number;
    unit: InventoryUnit;
    reason: string;
    note?: string | null;
  }
): Promise<StockChangeSummary> {
  const item = await loadItemName(restaurantId, input.itemId);
  const result = await applyStockChange({
    restaurantId,
    userId,
    itemId: input.itemId,
    quantity: input.quantity,
    unit: input.unit,
    type: "CONSUMPTION",
    referenceType: "CONSUMPTION",
    reason: input.reason,
    note: input.note ?? null,
  });

  await recordAudit({
    restaurantId,
    userId,
    action: "STOCK_CONSUMPTION_RECORDED",
    entityType: "STOCK_MOVEMENT",
    entityId: result.movementId,
    metadata: {
      itemId: input.itemId,
      itemName: item.name,
      quantity: input.quantity,
      unit: input.unit,
      reason: input.reason,
    },
  });

  return {
    itemId: input.itemId,
    movementId: result.movementId,
    currentStock: result.afterStock,
    currentStockLabel: formatStockQuantity(result.afterStock, input.unit),
    itemName: item.name,
  };
}

export async function listStockMovements(
  restaurantId: string,
  query: NormalizedMovementQuery
): Promise<Paged<StockMovementView>> {
  await connectDB();

  const filter: Record<string, unknown> = { restaurantId };
  if (query.type) filter.type = query.type;
  if (query.itemId) filter.inventoryItemId = query.itemId;
  const range = dateRangeFilter("createdAt", query.from, query.to);
  if (range) Object.assign(filter, range);
  if (query.q) {
    const rx = containsCaseInsensitiveRegex(query.q);
    filter.$or = [{ itemNameSnapshot: rx }, { reason: rx }];
  }

  const pageSize = MOVEMENT_PAGE_SIZE;
  const skip = (query.page - 1) * pageSize;

  const [docs, total] = await Promise.all([
    StockMovementModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    StockMovementModel.countDocuments(filter),
  ]);

  const names = await userNameMap(docs.map((doc) => doc.createdBy));
  const rows = (docs as unknown as StockMovementDoc[]).map((doc) =>
    stockMovementToView(
      doc,
      names.get(String(doc.createdBy)) ?? null
    )
  );

  return {
    rows,
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
  };
}

export async function listItemMovements(
  restaurantId: string,
  itemId: string,
  limit = 10
): Promise<StockMovementView[]> {
  await connectDB();
  const docs = await StockMovementModel.find({
    restaurantId,
    inventoryItemId: new mongoose.Types.ObjectId(itemId),
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 50))
    .lean();

  const names = await userNameMap(docs.map((doc) => doc.createdBy));
  return (docs as unknown as StockMovementDoc[]).map((doc) =>
    stockMovementToView(doc, names.get(String(doc.createdBy)) ?? null)
  );
}
