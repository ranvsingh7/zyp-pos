import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import {
  KotModel,
  type KitchenOrderTicketDocument,
  type KotItem,
} from "@/models/KitchenOrderTicket";
import { OrderModel, type OrderItem } from "@/models/Order";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { OrderNotFoundError, OrderValidationError } from "@/lib/orders/errors";
import {
  ACTIVE_ORDER_STATUSES,
  FIRST_KOT_NUMBER,
  KOT_NUMBER_PAD,
  KOT_NUMBER_PREFIX,
  KOT_CANCELLATION_REASON_MAX,
  ORDER_CANCEL_REASON_MAX,
  type OrderStatus,
  type OrderType,
} from "@/lib/orders/constants";
import type { KotItemAction, KotView } from "@/lib/orders/types";
import type { Role } from "@/lib/auth/roles";
import { writeAuditLog } from "@/lib/audit/audit-service";

function toKotView(doc: KitchenOrderTicketDocument): KotView {
  return {
    id: String(doc._id),
    kotNumber: doc.kotNumber,
    orderNumber: doc.orderNumber,
    orderType: doc.orderType as OrderType,
    type: (doc.type === "MODIFIED" ? "MODIFIED" : "NEW") as KotView["type"],
    state: (doc.state === "SENT" ? "SENT" : "PENDING") as KotView["state"],
    // Status is additive; legacy documents read as ACTIVE.
    status: (doc.status === "CANCELLED" ? "CANCELLED" : "ACTIVE") as KotView["status"],
    cancellationReason: doc.cancellationReason ?? null,
    cancelledAt: doc.cancelledAt ? String(doc.cancelledAt) : null,
    cancelledBy: doc.cancelledBy ? String(doc.cancelledBy) : null,
    tableName: doc.tableName ?? null,
    customerName: doc.customerName ?? null,
    items: (doc.items as unknown as KotItem[]).map((item) => ({
      name: item.name,
      variant: item.variant ?? null,
      quantity: item.quantity,
      note: item.note ?? null,
      action: "ADDED" as KotItemAction,
    })),
    orderNote: doc.orderNote ?? null,
    printedAt: doc.printedAt ? String(doc.printedAt) : null,
    printedCount: doc.printedCount,
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
    createdBy: String(doc.createdBy),
  };
}

/**
 * Next sequential KOT number for a restaurant.
 *
 * The maximum is derived numerically, never by sorting `kotNumber` as a string:
 * the stored value is zero-padded to three digits, so beyond 999 the string
 * order stops matching the numeric order ("K-999" sorts above "K-1000") and a
 * lexicographic max would keep re-minting a number that already exists, tripping
 * the unique {restaurantId, kotNumber} index on every attempt. Slice the digits
 * off the end of the prefix and let MongoDB do the arithmetic.
 */
async function nextKotNumber(restaurantId: string): Promise<number> {
  const [row] = await KotModel.aggregate<{ max: number }>([
    { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
    {
      $project: {
        digits: {
          $convert: {
            input: {
              $substrBytes: [
                { $ifNull: ["$kotNumber", ""] },
                KOT_NUMBER_PREFIX.length,
                20,
              ],
            },
            to: "int",
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $group: { _id: null, max: { $max: "$digits" } } },
  ]);
  return (row?.max ?? FIRST_KOT_NUMBER - 1) + 1;
}

function formatKotNumber(value: number): string {
  return `${KOT_NUMBER_PREFIX}${String(value).padStart(KOT_NUMBER_PAD, "0")}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ("code" in error && Number((error as { code?: unknown }).code) === 11000)
  );
}

const idStr = (value: unknown) => String(value);

/**
 * A single printed KOT line (from a stored KOT item). `menuItemId`/`variantId`
 * are absent on legacy KOTs created before item identity was recorded; for
 * those we fall back to name+variant+note matching.
 */
export interface KotPrintedLine {
  menuItemId: string | null;
  variantId: string | null;
  name: string;
  variant: string | null;
  quantity: number;
  note: string | null;
}

/** A delta line the next KOT will carry (new items + increased quantities). */
export interface KotDeltaLine {
  menuItemId: string;
  variantId: string | null;
  name: string;
  variant: string | null;
  quantity: number;
  note: string | null;
}

const idKey = (menuItemId: string, variantId: string | null) =>
  `id:${menuItemId}:${variantId ?? ""}`;
const nameKey = (name: string, variant: string | null) =>
  `name:${name}:${variant ?? ""}`;

/** Per order line: how much is already covered by printed KOTs vs still new. */
export interface LinePrintSplit {
  printedQuantity: number;
  unsentQuantity: number;
}

type DeltaItemInput = {
  menuItemId: unknown;
  variantId?: unknown | null;
  nameSnapshot: string;
  variantNameSnapshot?: string | null;
  quantity: number;
  note?: string | null;
};

/**
 * Splits every order line into its printed (locked) and unsent (new) portions.
 *
 * The printed budget is tracked per ITEM + VARIANT — independent of note — as
 * the total already-quantity across every printed KOT (the accumulated printed
 * ledger, not just the latest one). Each line consumes that budget in order, so
 * a note added to an already-printed line never re-prints the printed
 * quantity: the line is still fully covered by its item/variant budget. Only the
 * portion of a line beyond the budget is "unsent".
 *
 * Printed id-keyed lines (menuItemId present) and legacy name-keyed lines (no
 * ids) both count toward a line's budget; they are distinct printed events, so
 * the quantities are summed. The ledger never decreases, so removing an item and
 * re-adding the same quantity nets to zero and prints nothing.
 */
export function splitKitchenQuantities(
  orderItems: DeltaItemInput[],
  printedLines: KotPrintedLine[]
): LinePrintSplit[] {
  if (orderItems.length === 0) return [];

  const printedById = new Map<string, number>();
  const printedByName = new Map<string, number>();
  for (const line of printedLines) {
    const quantity = Math.max(0, line.quantity);
    if (line.menuItemId) {
      const key = idKey(line.menuItemId, line.variantId);
      printedById.set(key, (printedById.get(key) ?? 0) + quantity);
    } else {
      const key = nameKey(line.name, line.variant);
      printedByName.set(key, (printedByName.get(key) ?? 0) + quantity);
    }
  }

  return orderItems.map((item) => {
    const menuItemId = idStr(item.menuItemId);
    const variantId = item.variantId ? idStr(item.variantId) : null;

    // Item/variant budget from id-keyed AND legacy name-keyed printed lines.
    const idBudget = printedById.get(idKey(menuItemId, variantId)) ?? 0;
    const nameBudget =
      printedByName.get(
        nameKey(item.nameSnapshot, item.variantNameSnapshot ?? null)
      ) ?? 0;

    // Consume id-budget first, then the name budget for the remainder, so
    // duplicate identical lines never double-subtract the same printed amount.
    let consumed = Math.min(idBudget, item.quantity);
    printedById.set(idKey(menuItemId, variantId), idBudget - consumed);
    let remainder = item.quantity - consumed;
    if (remainder > 0 && nameBudget > 0) {
      const used = Math.min(nameBudget, remainder);
      printedByName.set(
        nameKey(item.nameSnapshot, item.variantNameSnapshot ?? null),
        nameBudget - used
      );
      consumed += used;
      remainder -= used;
    }

    return { printedQuantity: consumed, unsentQuantity: remainder };
  });
}

/**
 * Computes the INCREMENTAL kitchen delta for an order — the exact lines the
 * next KOT would carry. This is every line's quantity minus what has ALREADY
 * been printed (see {@link splitKitchenQuantities}): newly-added items and
 * increased quantities print the surplus; unchanged, decreased or removed
 * lines print nothing. Because the budget is per item+variant, changing an
 * item's note never re-prints its already-printed quantity.
 *
 * When `printedLines` is empty (or omitted) nothing has been printed yet, so
 * the full current order is returned (the first KOT is a complete snapshot).
 */
export function computeKitchenDelta(
  orderItems: DeltaItemInput[],
  printedLines: KotPrintedLine[]
): KotDeltaLine[] {
  if (orderItems.length === 0) return [];

  const delta: KotDeltaLine[] = [];
  const splits = splitKitchenQuantities(orderItems, printedLines);
  for (let i = 0; i < orderItems.length; i += 1) {
    const item = orderItems[i];
    const unsent = splits[i].unsentQuantity;
    if (unsent <= 0) continue;
    delta.push({
      menuItemId: idStr(item.menuItemId),
      variantId: item.variantId ? idStr(item.variantId) : null,
      name: item.nameSnapshot,
      variant: item.variantNameSnapshot ?? null,
      quantity: unsent,
      note: item.note ?? null,
    });
  }

  return delta;
}

/**
 * Builds a stable claim key from the pending DELTA plus the accumulated
 * printed-baseline token it was computed against. Two idempotent prints of the
 * SAME pending delta (same baseline) share one key; a delta against a NEW
 * baseline (a later print generation) always yields a different key.
 */
function buildClaimKey(
  orderId: string,
  delta: KotDeltaLine[],
  printedLines: KotPrintedLine[]
): string {
  const baseline = printedLines
    .map((l) => {
      const id = l.menuItemId ?? `name:${l.name}`;
      const variant = l.variantId ?? l.variant ?? "";
      return `${id}:${variant}:${l.quantity}:${l.note ?? ""}`;
    })
    .sort()
    .join("|");
  const body = delta
    .map(
      (item, index) =>
        `${index}:${idStr(item.menuItemId)}:${item.variantId ? idStr(item.variantId) : ""}:${item.quantity}:${item.note ?? ""}`
    )
    .join("|");
  return `${orderId}#${baseline}#${body}`;
}

/** Normalizes a stored KOT item (possibly legacy, missing ids) for deltas. */
export function toKotPrintedLine(item: KotItem): KotPrintedLine {
  return {
    menuItemId: item.menuItemId ? String(item.menuItemId) : null,
    variantId: item.variantId ? String(item.variantId) : null,
    name: item.name,
    variant: item.variant ?? null,
    quantity: item.quantity,
    note: item.note ?? null,
  };
}

/** Maps a delta line to the client-facing KOT item view (no internal ids). */
export function toKotItemView(line: KotDeltaLine): KotView["items"][number] {
  return {
    name: line.name,
    variant: line.variant,
    quantity: line.quantity,
    note: line.note,
    action: "ADDED" as const,
  };
}

export interface PendingPrintResult {
  /** The KOT created, or null when nothing was pending. */
  kot: KotView | null;
  /** False when there were no changes to print (no KOT was created). */
  hasPending: boolean;
}

/**
 * What the NEXT print of this order would carry:
 *  - "ADD": nothing has been printed yet, so the first (complete) KOT is
 *    pending (PRINT KOT).
 *  - "MODIFY": KOTs exist and the pending delta has newly-added items or
 *    increased quantities (PRINT NEW KOT).
 *  - null: nothing pending — no KOT would be created.
 *
 * Pure function over the same data printPendingKot reads, so the POS/Orders UI
 * can label its button and show the pending delta without second-guessing
 * server logic. The baseline is the accumulated printed ledger derived from
 * persisted Order + printed KOT records, so it survives a page reload; no extra
 * flag needs to be stored.
 */
export function pendingKitchenKind(
  order: Record<string, unknown>,
  printedLines?: KotPrintedLine[]
): "ADD" | "MODIFY" | null {
  const items = order.items as unknown as OrderItem[];
  if (items.length === 0) return null;

  const printed = printedLines ?? [];
  if (printed.length === 0) return "ADD";

  return computeKitchenDelta(items, printed).length > 0 ? "MODIFY" : null;
}

/**
 * Prints a KOT carrying only the INCREMENTAL delta for the order: newly-added
 * items and quantity increases since the last printed KOT. The first KOT is a
 * complete snapshot of the order. Each KOT is an immutable snapshot of that
 * delta; removals/decreases are never printed. If there is nothing pending,
 * nothing is created.
 */
export async function printPendingKot(
  restaurantId: string,
  orderId: string,
  userId: string,
  actorRole?: Role,
  attempt = 0
): Promise<PendingPrintResult> {
  await connectDB();
  const order = await OrderModel.findOne({ _id: orderId, restaurantId }).lean();
  if (!order) throw new OrderNotFoundError();
  if (order.status === "CANCELLED") {
    throw new OrderValidationError("Cancelled orders cannot print a KOT.");
  }

  const items = order.items as unknown as OrderItem[];
  const orderNote = (order.orderNote as string) ?? null;

  // Accumulated printed ledger: every active printed KOT's item lines in all
  // history. Cancelled KOTs are excluded — their quantities were removed from
  // the order, so they must never count as a baseline or suppress a reprint.
  const printedKots = await KotModel.find({
    restaurantId,
    orderId,
    printedAt: { $ne: null },
    status: { $ne: "CANCELLED" },
  })
    .select("items")
    .lean();
  const printedLines = (printedKots as unknown as { items: KotItem[] }[]).flatMap(
    (kot) => kot.items.map(toKotPrintedLine)
  );

  // The delta is the pending print. Empty delta → nothing to send to kitchen.
  const delta = computeKitchenDelta(items, printedLines);
  if (delta.length === 0) {
    return { kot: null, hasPending: false };
  }

  const claimKey = buildClaimKey(orderId, delta, printedLines);

  // Is this the first KOT for this order?
  const existingKotDoc = await KotModel.exists({ restaurantId, orderId });
  const hasExistingKot = !!existingKotDoc;

  // KOT status is independent of KOT number: the first KOT is NEW and every
  // later incremental KOT is also NEW (it only carries newly-added items /
  // increased quantities). KOTs are never "Updated" just because a later one
  // exists — that label only ever applied to the removed EDIT workflow.
  const kotType: "NEW" | "MODIFIED" = "NEW";

  let doc: KitchenOrderTicketDocument | null = null;

  try {
    const kotNumber = formatKotNumber(await nextKotNumber(restaurantId));
    doc = (await KotModel.create({
      restaurantId,
      orderId,
      kotNumber,
      type: kotType,
      claimKey,
      orderNumber: order.orderNumber as number,
      orderType: order.orderType as OrderType,
      tableName: (order.tableNameSnapshot as string) ?? null,
      customerName: (order.customerName as string) ?? null,
      items: delta.map((line) => ({
        menuItemId: line.menuItemId,
        variantId: line.variantId ?? null,
        name: line.name,
        variant: line.variant,
        quantity: line.quantity,
        note: line.note,
        action: "ADDED" as const,
      })) as unknown as KotItem[],
      orderNote,
      createdBy: userId,
      printedAt: new Date(),
      printedCount: 1,
      state: "PENDING",
    })) as unknown as KitchenOrderTicketDocument;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await KotModel.findOne({
      restaurantId,
      orderId,
      claimKey,
    }).lean();
    if (existing) {
      doc = existing as unknown as KitchenOrderTicketDocument;
    } else if (attempt < 5) {
      return printPendingKot(restaurantId, orderId, userId, actorRole, attempt + 1);
    } else {
      throw error;
    }
  }

  if (!doc) {
    throw new Error("Failed to create or find KOT document");
  }

  await writeAuditLog({
    restaurantId,
    actorUserId: userId,
    actorRole,
    action: "KOT_CREATED",
    resourceType: "KOT",
    resourceId: String(doc._id),
    after: {
      kotNumber: doc.kotNumber,
      orderNumber: doc.orderNumber,
      type: doc.type,
      itemCount: (doc.items as unknown as unknown[]).length,
    },
    reason: hasExistingKot
      ? "Additional KOT printed with newly-added quantities."
      : "Initial KOT printed.",
    metadata: {
      kotNumber: doc.kotNumber,
      orderNumber: doc.orderNumber,
      orderId,
      kotType: doc.type,
    },
  });

  return { kot: toKotView(doc), hasPending: true };
}

/** Returns the stored KOT snapshots of an order, oldest first (KOT history). */
export async function listOrderKots(
  restaurantId: string,
  orderId: string
): Promise<KotView[]> {
  await connectDB();
  const docs = await KotModel.find({ restaurantId, orderId })
    .sort({ kotNumber: 1 })
    .lean();
  return docs.map((d) => toKotView(d as unknown as KitchenOrderTicketDocument));
}

/** Tenant-wide KOT feed for the Kitchen page, newest printed first. Cancelled
 * KOTs are excluded — they are no longer actionable for the kitchen but remain
 * visible in the order's KOT history. */
export async function listKots(
  restaurantId: string,
  limit = 50
): Promise<KotView[]> {
  await connectDB();
  const safeLimit = Math.min(Math.max(1, limit), 200);
  const docs = await KotModel.find({
    restaurantId,
    status: { $ne: "CANCELLED" },
  })
    .sort({ printedAt: -1, createdAt: -1 })
    .limit(safeLimit)
    .lean();
  return docs.map((d) => toKotView(d as unknown as KitchenOrderTicketDocument));
}

export interface CancelKotResult {
  kot: KotView;
  orderId: string;
  /** True when the order was emptied by this cancellation and itself cancelled. */
  orderCancelled: boolean;
}

/**
 * Cancels a KOT non-destructively: keeps the original snapshot (items,
 * quantities, timestamps) and only records the cancellation. Cancelled KOTs
 * remain visible in the order's KOT history but can no longer be reprinted or
 * cancelled again.
 *
 * The cancelled KOT's quantities are also removed from the order's active
 * items (and the order total recomputed), so a cancelled KOT can never be
 * double-billed. If the order is left with no items it follows the existing
 * cancellation lifecycle: the order is marked CANCELLED and its table is
 * released when no other active order occupies it. Cancelled KOTs no longer
 * count toward the printed ledger, so a later re-added item is reprinted.
 */
export async function cancelKot(
  restaurantId: string,
  kotId: string,
  userId: string,
  opts?: { reason?: string }
): Promise<CancelKotResult> {
  await connectDB();
  const existing = await KotModel.findOne({ _id: kotId, restaurantId }).lean();
  if (!existing) throw new OrderNotFoundError();

  const status = ((existing as unknown as KitchenOrderTicketDocument).status ??
    "ACTIVE") as string;
  if (status === "CANCELLED") {
    throw new OrderValidationError("This KOT is already cancelled.");
  }

  const reason = opts?.reason?.trim() || null;
  if (reason && reason.length > KOT_CANCELLATION_REASON_MAX) {
    throw new OrderValidationError(
      `Cancellation reason must be ${KOT_CANCELLATION_REASON_MAX} characters or fewer.`
    );
  }

  const doc = await KotModel.findOneAndUpdate(
    { _id: kotId, restaurantId, status: { $ne: "CANCELLED" } },
    {
      $set: {
        status: "CANCELLED",
        cancellationReason: reason,
        cancelledAt: new Date(),
        cancelledBy: userId,
      },
    },
    { returnDocument: "after" }
  ).lean();
  if (!doc) {
    throw new OrderValidationError("This KOT is already cancelled.");
  }

  await writeAuditLog({
    restaurantId,
    actorUserId: userId,
    action: "KOT_CANCELLED",
    resourceType: "KOT",
    resourceId: String(doc._id),
    after: {
      kotNumber: doc.kotNumber,
      orderNumber: doc.orderNumber,
      cancelledAt: doc.cancelledAt,
      reason: doc.cancellationReason ?? undefined,
    },
    reason: "KOT cancelled.",
    metadata: {
      kotNumber: doc.kotNumber,
      orderNumber: doc.orderNumber,
      orderId: String(doc.orderId),
      kotType: doc.type,
    },
  });

  const orderId = String(doc.orderId);
  const orderCancelled = await detachCancelledKotFromOrder(
    restaurantId,
    orderId,
    userId,
    doc as unknown as KitchenOrderTicketDocument
  );

  return {
    kot: toKotView(doc as unknown as KitchenOrderTicketDocument),
    orderId,
    orderCancelled,
  };
}

/**
 * Removes a cancelled KOT's quantities from its order and recomputes the
 * order total. When the order would be left empty it is cancelled and its
 * table released (existing lifecycle). Terminal CANCELLED/PAID orders are left
 * untouched: the KOT record is still marked cancelled in history. Returns true
 * when the order itself was cancelled.
 */
async function detachCancelledKotFromOrder(
  restaurantId: string,
  orderId: string,
  userId: string,
  kot: KitchenOrderTicketDocument
): Promise<boolean> {
  const order = await OrderModel.findOne({ _id: orderId, restaurantId }).lean();
  if (!order) return false;
  const status = order.status as OrderStatus;
  if (status === "CANCELLED" || status === "PAID") return false;

  const kotItems = (kot.items as unknown as KotItem[]) ?? [];
  if (kotItems.length === 0) return false;

  const rawItems = (order.items as unknown as OrderItem[]) ?? [];
  const items = rawItems.length > 0 ? detachKotQuantities(rawItems, kotItems) : [];
  const totalPaise = items.reduce(
    (sum, line) => sum + line.unitPricePaise * line.quantity,
    0
  );

  if (items.length === 0) {
    await OrderModel.updateOne(
      { _id: orderId, restaurantId },
      {
        $set: {
          status: "CANCELLED",
          items: [],
          totalPaise: 0,
          cancelledAt: new Date(),
          cancelledBy: userId,
          cancellationReason: `KOT ${kot.kotNumber} cancelled — the order has no remaining items.`.slice(
            0,
            ORDER_CANCEL_REASON_MAX
          ),
        },
      }
    );

    await writeAuditLog({
      restaurantId,
      actorUserId: userId,
      action: "ORDER_CANCELLED",
      resourceType: "ORDER",
      resourceId: orderId,
      before: { status },
      after: { status: "CANCELLED" },
      reason: "Order was emptied by an item-level KOT cancellation.",
      metadata: { orderNumber: order.orderNumber, kotNumber: kot.kotNumber },
    });

    if (order.tableId) {
      await releaseTableIfIdle(restaurantId, String(order.tableId), orderId);
    }
    return true;
  }

  await OrderModel.updateOne(
    { _id: orderId, restaurantId },
    { $set: { items, totalPaise } }
  );
  return false;
}

/**
 * Subtracts the cancelled KOT's quantities from the order's lines. Lines match
 * by the same identity the incremental delta uses (menuItemId + variantId,
 * preferring the exact note captured at print time), with a name + variant
 * fallback for legacy KOTs. Lines that reach zero are dropped.
 */
function detachKotQuantities(
  orderLines: OrderItem[],
  kotLines: KotItem[]
): OrderItem[] {
  const work = orderLines.map((line) => ({
    ...line,
    quantity: line.quantity,
  }));

  for (const kotLine of kotLines) {
    const need0 = kotLine.quantity;
    if (need0 <= 0) continue;
    let need = need0;

    const targets = matchOrderLines(work, kotLine);
    for (const target of targets) {
      if (need <= 0) break;
      const take = Math.min(need, target.quantity);
      target.quantity -= take;
      need -= take;
    }
  }

  return work.filter((line) => line.quantity > 0);
}

function matchOrderLines(
  lines: OrderItem[],
  kotLine: KotItem
): OrderItem[] {
  const sameNote = (l: OrderItem) => (l.note ?? null) === (kotLine.note ?? null);
  let candidates: OrderItem[];
  if (kotLine.menuItemId) {
    candidates = lines.filter(
      (l) =>
        String(l.menuItemId) === String(kotLine.menuItemId) &&
        (l.variantId ? String(l.variantId) : null) ===
          (kotLine.variantId ? String(kotLine.variantId) : null)
    );
    if (candidates.length === 0) return [];
  } else {
    // Legacy KOTs (pre-delta) fall back to the stored name + variant snapshot.
    candidates = lines.filter(
      (l) =>
        l.nameSnapshot === kotLine.name &&
        (l.variantNameSnapshot ?? null) === (kotLine.variant ?? null)
    );
    if (candidates.length === 0) return [];
  }
  // Prefer the exact printed line, then any other line for the same item.
  return [
    ...candidates.filter(sameNote),
    ...candidates.filter((l) => !sameNote(l)),
  ];
}

/** Returns the table to AVAILABLE unless another active order still occupies it. */
async function releaseTableIfIdle(
  restaurantId: string,
  tableId: string,
  excludeOrderId?: string
): Promise<void> {
  const query: Record<string, unknown> = {
    restaurantId,
    tableId,
    status: { $in: ACTIVE_ORDER_STATUSES },
  };
  if (excludeOrderId) query._id = { $ne: excludeOrderId };
  const stillOccupied = await OrderModel.exists(query);
  if (stillOccupied) return;
  await RestaurantTableModel.updateOne(
    { _id: tableId, restaurantId },
    { $set: { status: "AVAILABLE" } }
  );
}

/** Returns a single stored KOT (used for viewing; does not count as a print). */
export async function getKot(
  restaurantId: string,
  kotId: string
): Promise<KotView> {
  await connectDB();
  const doc = await KotModel.findOne({ _id: kotId, restaurantId }).lean();
  if (!doc) throw new OrderNotFoundError();
  return toKotView(doc as unknown as KitchenOrderTicketDocument);
}

/** Marks a KOT as printed again (reprint: counts it, refreshes the time). */
export async function markKotPrinted(
  restaurantId: string,
  kotId: string
): Promise<KotView> {
  await connectDB();
  const existing = await KotModel.findOne({ _id: kotId, restaurantId }).lean();
  if (!existing) throw new OrderNotFoundError();
  const status = ((existing as unknown as KitchenOrderTicketDocument).status ??
    "ACTIVE") as string;
  if (status === "CANCELLED") {
    throw new OrderValidationError(
      "A cancelled KOT cannot be reprinted."
    );
  }
  const doc = await KotModel.findOneAndUpdate(
    { _id: kotId, restaurantId },
    { $set: { printedAt: new Date() }, $inc: { printedCount: 1 } },
    { returnDocument: "after" }
  ).lean();
  if (!doc) throw new OrderNotFoundError();
  return toKotView(doc as unknown as KitchenOrderTicketDocument);
}

/** Marks a KOT as sent to kitchen (state: PENDING -> SENT). */
export async function markKotSent(
  restaurantId: string,
  kotId: string
): Promise<KotView> {
  await connectDB();
  const doc = await KotModel.findOneAndUpdate(
    { _id: kotId, restaurantId },
    { $set: { state: "SENT" } },
    { returnDocument: "after" }
  ).lean();
  if (!doc) throw new OrderNotFoundError();
  return toKotView(doc as unknown as KitchenOrderTicketDocument);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPrintTime(date: Date): string {
  return date
    .toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .replace("am", "AM")
    .replace("pm", "PM");
}

function itemRow(item: {
  quantity: number;
  name: string;
  variant: string | null;
  note: string | null;
}): string {
  const variant = item.variant ? ` (${escapeHtml(item.variant)})` : "";
  const note = item.note
    ? `<div class="note">- ${escapeHtml(item.note)}</div>`
    : "";
  return `<div class="item"><div>${item.quantity} × ${escapeHtml(item.name)}${variant}</div>${note}</div>`;
}

function sectionRows(section: string, items: KotView["items"]): string {
  const rows = items.map(itemRow).join("");
  return `<div class="section-label">${escapeHtml(section)}</div><div class="items">${rows}</div>`;
}

/**
 * Builds the 80mm printable HTML for a KOT. Data comes from the saved KOT
 * record (itself a snapshot of the incremental delta printed at that time).
 * Prices are deliberately excluded — the kitchen does not need them.
 *
 * Each KOT carries only the quantities that were newly printed. All items are
 * shown in a single "ORDER ITEMS" section.
 */
export function buildKotHtml(opts: {
  restaurantName: string;
  kot: KotView;
  printTime?: Date;
}): string {
  const { restaurantName, kot } = opts;
  const printTime = opts.printTime ?? new Date();

  const orderLabel =
    kot.orderType === "DINE_IN"
      ? kot.tableName
        ? `Table ${kot.tableName}`
        : "Dine-in"
      : kot.orderType === "TAKEAWAY"
        ? "Takeaway"
        : "Quick Sale";

  const itemsSection = sectionRows("ORDER ITEMS", kot.items);

  const orderNote = kot.orderNote
    ? `<div class="order-note">NOTE: ${escapeHtml(kot.orderNote)}</div>`
    : "";
  const customer = kot.customerName
    ? `<div class="meta">${escapeHtml(kot.customerName)}</div>`
    : "";

  const mainLabel = "KITCHEN ORDER TICKET";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KOT ${escapeHtml(kot.kotNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 8mm 5mm; width: 80mm; background: #fff; color: #000;
         font-family: 'Courier New', Consolas, monospace; font-size: 12px; }
  .center { text-align: center; }
  .rname { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .sub { font-size: 11px; margin-top: 2px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; font-size: 12px; }
  .kot { font-size: 14px; font-weight: 700; }
  .section-label { margin-top: 6px; font-size: 13px; font-weight: 700;
                   text-transform: uppercase; letter-spacing: 0.5px; }
  .items { margin: 2px 0; }
  .item { padding: 2px 0; }
  .note { margin-left: 8px; font-size: 11px; }
  .order-note { margin-top: 4px; font-size: 11px; border: 1px dashed #000;
                padding: 2px 4px; }
  .meta { font-size: 12px; margin-top: 2px; }
  .foot { margin-top: 8px; font-size: 10px; text-align: center; }
</style>
</head>
<body>
  <div class="center rname">${escapeHtml(restaurantName)}</div>
  <div class="center sub">${escapeHtml(mainLabel)}</div>
  <hr>
  <div class="row"><span>KOT</span><span class="kot">${escapeHtml(kot.kotNumber)}</span></div>
  <div class="row"><span>Order</span><span>#${kot.orderNumber}</span></div>
  <div class="row"><span>Type</span><span>${escapeHtml(orderLabel)}</span></div>
  ${customer}
  <div class="row"><span>Time</span><span>${escapeHtml(formatPrintTime(printTime))}</span></div>
  <hr>
  ${itemsSection}
  ${orderNote}
  <hr>
  <div class="foot">— End of KOT —</div>
</body>
</html>`;
}
