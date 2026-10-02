import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { PurchaseModel } from "@/models/Purchase";
import { InventoryItemModel } from "@/models/InventoryItem";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { UserModel } from "@/models/User";
import {
  DEFAULT_PURCHASE_PREFIX,
  MONGODB_DUPLICATE_KEY,
  PURCHASE_NUMBER_PAD,
  PURCHASE_PAGE_SIZE,
  type InventoryBaseUnit,
} from "@/lib/inventory/constants";
import {
  IncompatibleUnitError,
  InsufficientStockError,
  InventoryItemNotFoundError,
  PurchaseNotFoundError,
  PurchaseValidationError,
} from "@/lib/inventory/errors";
import { applyStockChange } from "@/lib/inventory/stock-service";
import {
  formatQuantity,
  formatStockQuantity,
  isUnitCompatibleWithBase,
  toBaseQuantity,
} from "@/lib/inventory/units";
import {
  containsCaseInsensitiveRegex,
  dateRangeFilter,
  toIso,
} from "@/lib/inventory/utils";
import { rupeesToPaise } from "@/lib/menu/prices";
import { recordAudit } from "@/lib/tables/audit";
import type { NormalizedPurchaseQuery } from "@/lib/inventory/query";
import type {
  Paged,
  PurchaseDetailView,
  PurchaseLineView,
  PurchaseRowView,
} from "@/lib/inventory/types";
import type { PurchaseInput } from "@/lib/inventory/validation";

interface PurchaseLineDoc {
  inventoryItemId: unknown;
  itemNameSnapshot: string;
  quantity: number;
  unit: PurchaseLineView["unit"];
  baseQuantity: number;
  purchaseRatePaise: number;
  totalAmountPaise: number;
  beforeStock: number;
  afterStock: number;
}

interface PurchaseDoc {
  _id: unknown;
  purchaseNumber: string;
  purchaseSequence: number;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  purchaseDate?: unknown;
  items: PurchaseLineDoc[];
  subtotalPaise: number;
  notes?: string | null;
  status: PurchaseRowView["status"];
  reversedAt?: unknown;
  reversedBy?: unknown;
  reversalReason?: string | null;
  createdBy: unknown;
  createdAt?: unknown;
}

function purchaseLineToView(
  line: PurchaseLineDoc
): PurchaseLineView {
  return {
    inventoryItemId: String(line.inventoryItemId),
    itemName: line.itemNameSnapshot,
    quantity: line.quantity,
    unit: line.unit,
    quantityLabel: formatQuantity(line.quantity, line.unit),
    baseQuantity: line.baseQuantity,
    purchaseRatePaise: line.purchaseRatePaise,
    totalAmountPaise: line.totalAmountPaise,
    beforeStock: line.beforeStock,
    afterStock: line.afterStock,
    beforeStockLabel: formatStockQuantity(line.beforeStock, line.unit),
    afterStockLabel: formatStockQuantity(line.afterStock, line.unit),
  };
}

function purchaseToRow(
  doc: PurchaseDoc,
  createdByName: string | null
): PurchaseRowView {
  return {
    id: String(doc._id),
    purchaseNumber: doc.purchaseNumber,
    purchaseDate: toIso(doc.purchaseDate),
    supplierName: doc.supplierName ?? null,
    invoiceNumber: doc.invoiceNumber ?? null,
    itemCount: doc.items.length,
    subtotalPaise: doc.subtotalPaise,
    status: doc.status,
    createdByName,
    createdAt: toIso(doc.createdAt),
  };
}

function purchaseToDetail(
  doc: PurchaseDoc,
  createdByName: string | null
): PurchaseDetailView {
  return {
    ...purchaseToRow(doc, createdByName),
    items: doc.items.map(purchaseLineToView),
    notes: doc.notes ?? null,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === MONGODB_DUPLICATE_KEY
  );
}

export function formatPurchaseNumber(
  prefix: string,
  sequence: number
): string {
  const safePrefix =
    (prefix || DEFAULT_PURCHASE_PREFIX).trim().toUpperCase().slice(0, 12) ||
    DEFAULT_PURCHASE_PREFIX;
  return `${safePrefix}-${String(sequence).padStart(PURCHASE_NUMBER_PAD, "0")}`;
}

async function resolvePurchasePrefix(restaurantId: string): Promise<string> {
  const settings = await RestaurantSettingsModel.findOne({ restaurantId })
    .select("purchasePrefix")
    .lean();
  return settings?.purchasePrefix || DEFAULT_PURCHASE_PREFIX;
}

async function nextPurchaseSequence(restaurantId: string): Promise<number> {
  const last = await PurchaseModel.findOne({ restaurantId })
    .sort({ purchaseSequence: -1 })
    .select("purchaseSequence")
    .lean();
  return (last?.purchaseSequence ?? 0) + 1;
}

async function userNameMap(
  userIds: unknown[]
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean).map((id) => String(id)))];
  if (!ids.length) return new Map();
  const users = await UserModel.find({ _id: { $in: ids } })
    .select("_id fullName")
    .lean();
  const map = new Map<string, string>();
  for (const user of users) map.set(String(user._id), String(user.fullName));
  return map;
}

/**
 * Records a purchase: validates every line, allocates a restaurant-scoped
 * purchase number, persists the purchase (idempotency-guarded), then applies
 * each line to stock as PURCHASE movements. Cost price is refreshed to the
 * latest purchase rate (per base unit).
 */
export async function createPurchase(
  restaurantId: string,
  userId: string,
  input: PurchaseInput
): Promise<PurchaseDetailView> {
  await connectDB();

  if (input.idempotencyKey) {
    const existing = await PurchaseModel.findOne({
      restaurantId,
      idempotencyKey: input.idempotencyKey,
    }).lean();
    if (existing) {
      const names = await userNameMap([existing.createdBy]);
      return purchaseToDetail(
        existing as unknown as PurchaseDoc,
        names.get(String(existing.createdBy)) ?? null
      );
    }
  }

  if (!input.items.length) {
    throw new PurchaseValidationError("Add at least one item to the purchase.");
  }

  const itemIds = [...new Set(input.items.map((i) => i.inventoryItemId))];
  const itemDocs = await InventoryItemModel.find({
    _id: { $in: itemIds },
    restaurantId,
  }).lean();
  const itemById = new Map(
    itemDocs.map((item) => [String(item._id), item])
  );

  const prepared = input.items.map((line) => {
    const item = itemById.get(line.inventoryItemId);
    if (!item) {
      throw new PurchaseValidationError(
        "One or more selected items are not valid."
      );
    }
    if (!item.isActive) {
      throw new PurchaseValidationError(
        `${item.name} is inactive and cannot be purchased.`
      );
    }
    const baseUnit = String(item.baseUnit) as InventoryBaseUnit;
    if (!isUnitCompatibleWithBase(baseUnit, line.unit)) {
      throw new IncompatibleUnitError(
        `${item.name} is tracked in ${baseUnit}. Use a compatible unit.`
      );
    }
    const baseQuantity = toBaseQuantity(line.quantity, line.unit);
    if (baseQuantity <= 0) {
      throw new PurchaseValidationError("Quantity is too small to record.");
    }
    const ratePaise = rupeesToPaise(line.purchaseRateRupees);
    return {
      item,
      quantity: line.quantity,
      unit: line.unit,
      baseQuantity,
      ratePaise,
      totalAmountPaise: Math.round(line.quantity * ratePaise),
    };
  });

  const subtotalPaise = prepared.reduce(
    (sum, line) => sum + line.totalAmountPaise,
    0
  );
  const prefix = await resolvePurchasePrefix(restaurantId);
  const purchaseDate = input.purchaseDate ?? new Date();

  let purchase: (PurchaseDoc & { _id: mongoose.Types.ObjectId }) | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sequence = await nextPurchaseSequence(restaurantId);
    const purchaseNumber = formatPurchaseNumber(prefix, sequence);
    try {
      const created = await PurchaseModel.create({
        restaurantId,
        purchaseNumber,
        purchaseSequence: sequence,
        supplierName: input.supplierName,
        invoiceNumber: input.invoiceNumber,
        purchaseDate,
        items: prepared.map((line) => ({
          inventoryItemId: line.item._id,
          itemNameSnapshot: line.item.name,
          quantity: line.quantity,
          unit: line.unit,
          baseQuantity: line.baseQuantity,
          purchaseRatePaise: line.ratePaise,
          totalAmountPaise: line.totalAmountPaise,
          beforeStock: 0,
          afterStock: 0,
        })),
        subtotalPaise,
        notes: input.notes,
        status: "POSTED",
        idempotencyKey: input.idempotencyKey,
        createdBy: userId,
      });
      purchase = created as unknown as PurchaseDoc & {
        _id: mongoose.Types.ObjectId;
      };
      break;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Either the idempotency key already exists (double submit) or the
      // purchase number collided. Resolve accordingly.
      if (input.idempotencyKey) {
        const existing = await PurchaseModel.findOne({
          restaurantId,
          idempotencyKey: input.idempotencyKey,
        }).lean();
        if (existing) {
          const names = await userNameMap([existing.createdBy]);
          return purchaseToDetail(
            existing as unknown as PurchaseDoc,
            names.get(String(existing.createdBy)) ?? null
          );
        }
      }
      lastError = err;
    }
  }

  if (!purchase) {
    console.error("[inventory] could not allocate purchase number", lastError);
    throw new PurchaseValidationError(
      "Could not allocate a purchase number. Please try again."
    );
  }

  const enrichedLines: PurchaseLineDoc[] = [];
  for (const line of prepared) {
    const result = await applyStockChange({
      restaurantId,
      userId,
      itemId: String(line.item._id),
      quantity: line.quantity,
      unit: line.unit,
      type: "PURCHASE",
      referenceType: "PURCHASE",
      referenceId: String(purchase._id),
      reason: input.supplierName ?? "Purchase",
      note: input.notes,
      ratePaisePerUnit: line.ratePaise,
      updateCostPrice: true,
    });
    enrichedLines.push({
      inventoryItemId: line.item._id,
      itemNameSnapshot: line.item.name,
      quantity: line.quantity,
      unit: line.unit,
      baseQuantity: line.baseQuantity,
      purchaseRatePaise: line.ratePaise,
      totalAmountPaise: line.totalAmountPaise,
      beforeStock: result.beforeStock,
      afterStock: result.afterStock,
    });
  }

  let finalDoc = purchase as unknown as PurchaseDoc;
  try {
    await PurchaseModel.updateOne(
      { _id: purchase._id, restaurantId },
      { $set: { items: enrichedLines } }
    );
    // Re-read as a plain object so the returned view carries the real `_id`
    // (spreading a hydrated Mongoose document would drop it).
    const reloaded = await PurchaseModel.findOne({
      _id: purchase._id,
      restaurantId,
    }).lean();
    if (reloaded) finalDoc = reloaded as unknown as PurchaseDoc;
  } catch (err) {
    console.error("[inventory] failed to enrich purchase lines", err);
  }

  await recordAudit({
    restaurantId,
    userId,
    action: "PURCHASE_CREATED",
    entityType: "PURCHASE",
    entityId: String(purchase._id),
    metadata: {
      purchaseNumber: purchase.purchaseNumber,
      itemCount: enrichedLines.length,
      subtotalPaise,
    },
  });

  const names = await userNameMap([userId]);
  return purchaseToDetail(
    finalDoc,
    names.get(String(userId)) ?? null
  );
}

export async function listPurchases(
  restaurantId: string,
  query: NormalizedPurchaseQuery
): Promise<Paged<PurchaseRowView>> {
  await connectDB();

  const filter: Record<string, unknown> = { restaurantId };
  if (query.q) {
    const rx = containsCaseInsensitiveRegex(query.q);
    filter.$or = [
      { purchaseNumber: rx },
      { invoiceNumber: rx },
      { supplierName: rx },
    ];
  }
  const range = dateRangeFilter("purchaseDate", query.from, query.to);
  if (range) Object.assign(filter, range);

  const pageSize = PURCHASE_PAGE_SIZE;
  const skip = (query.page - 1) * pageSize;

  const [docs, total] = await Promise.all([
    PurchaseModel.find(filter)
      .sort({ purchaseDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    PurchaseModel.countDocuments(filter),
  ]);

  const names = await userNameMap(docs.map((doc) => doc.createdBy));
  const rows = (docs as unknown as PurchaseDoc[]).map((doc) =>
    purchaseToRow(doc, names.get(String(doc.createdBy)) ?? null)
  );

  return {
    rows,
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
  };
}

export async function getPurchaseById(
  restaurantId: string,
  purchaseId: string
): Promise<PurchaseDetailView> {
  await connectDB();
  const doc = await PurchaseModel.findOne({
    _id: purchaseId,
    restaurantId,
  }).lean();
  if (!doc) throw new PurchaseNotFoundError();
  const names = await userNameMap([doc.createdBy]);
  return purchaseToDetail(
    doc as unknown as PurchaseDoc,
    names.get(String(doc.createdBy)) ?? null
  );
}

/**
 * Soft-reverses a POSTED purchase: stock already added by its lines is
 * returned to the items (ADJUSTMENT_OUT movements) and the purchase itself
 * flips to REVERSED — it is never deleted. Stock sufficiency is preflighted
 * for every line before the first movement runs, so a reversal cannot leave a
 * half-applied refund (standalone-Mongo limitation: no multi-doc transaction).
 */
export async function reversePurchase(
  restaurantId: string,
  purchaseId: string,
  userId: string,
  reason?: string
): Promise<PurchaseDetailView> {
  await connectDB();
  const purchase = await PurchaseModel.findOne({
    _id: purchaseId,
    restaurantId,
  }).lean();
  if (!purchase) throw new PurchaseNotFoundError();

  const status = String(purchase.status ?? "POSTED") as PurchaseRowView["status"];
  if (status === "REVERSED") {
    throw new PurchaseValidationError("This purchase has already been reversed.");
  }
  if (status !== "POSTED") {
    throw new PurchaseValidationError("Only posted purchases can be reversed.");
  }

  const lines = (purchase as unknown as PurchaseDoc).items ?? [];
  if (lines.length === 0) {
    throw new PurchaseValidationError("This purchase has no lines to reverse.");
  }

  const reversalReason = reason?.trim() ? reason.trim() : null;

  // Preflight: every item must have enough stock to give back, otherwise we
  // abort before touching anything.
  for (const line of lines) {
    const item = await InventoryItemModel.findOne({
      _id: line.inventoryItemId,
      restaurantId,
    }).lean();
    if (!item) throw new InventoryItemNotFoundError();
    const available = Number(item.currentStock ?? 0);
    const baseQuantity = Number(line.baseQuantity ?? 0);
    if (available < baseQuantity) {
      throw new InsufficientStockError(
        `${line.itemNameSnapshot}: available ${formatQuantity(available, line.unit)}, reversal needs ${formatQuantity(baseQuantity, line.unit)}. Stock was consumed after posting; reverse the related consumption first.`
      );
    }
  }

  for (const line of lines) {
    await applyStockChange({
      restaurantId,
      userId,
      itemId: String(line.inventoryItemId),
      quantity: line.quantity,
      unit: line.unit,
      type: "ADJUSTMENT_OUT",
      referenceType: "PURCHASE",
      referenceId: String(purchase._id),
      reason: `Reversal of purchase ${(purchase as unknown as PurchaseDoc).purchaseNumber}`,
      note: reversalReason,
    });
  }

  const updated = await PurchaseModel.findOneAndUpdate(
    { _id: purchase._id, restaurantId, status: "POSTED" },
    {
      $set: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversedBy: userId,
        reversalReason,
      },
    },
    { returnDocument: "after" }
  ).lean();
  if (!updated) {
    throw new PurchaseValidationError(
      "This purchase changed concurrently and could not be reversed. Please refresh and retry."
    );
  }

  await recordAudit({
    restaurantId,
    userId,
    action: "PURCHASE_REVERSED",
    entityType: "PURCHASE",
    entityId: String(purchase._id),
    metadata: {
      purchaseNumber: (purchase as unknown as PurchaseDoc).purchaseNumber,
      reason: reversalReason,
      linesReversed: lines.length,
    },
  });

  const names = await userNameMap([userId]);
  return purchaseToDetail(
    updated as unknown as PurchaseDoc,
    names.get(String(userId)) ?? null
  );
}
