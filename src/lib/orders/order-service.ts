import "server-only";

import { connectDB } from "@/lib/db";
import { OrderModel, type OrderDocument, type OrderItem } from "@/models/Order";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import {
  OrderNotFoundError,
  OrderValidationError,
} from "@/lib/orders/errors";
import {
  ACTIVE_ORDER_STATUSES,
  EDITABLE_ORDER_STATUSES,
  FIRST_ORDER_NUMBER,
  type DiscountType,
  type OrderStatus,
  type OrderType,
} from "@/lib/orders/constants";
import type { OrderItemLineInput } from "@/lib/orders/validation";
import type { OrderView } from "@/lib/orders/types";
import {
  pendingKitchenKind,
  splitKitchenQuantities,
  toKotItemView,
  toKotPrintedLine,
  type KotPrintedLine,
} from "@/lib/orders/kot-service";
import { KotModel, type KotItem } from "@/models/KitchenOrderTicket";
import { writeAuditLog } from "@/lib/audit/audit-service";

export interface CreateOrderInput {
  orderType: OrderType;
  tableId?: string;
  customerName?: string;
  customerPhone?: string;
  orderNote?: string;
  items: OrderItemLineInput[];
}

interface BuiltOrderItem {
  menuItemId: unknown;
  nameSnapshot: string;
  variantId: unknown | null;
  variantNameSnapshot: string | null;
  hsnSacCode: string | null;
  quantity: number;
  unitPricePaise: number;
  note: string | null;
}

async function toOrderView(
  doc: OrderDocument,
  printedLinesOverride?: KotPrintedLine[]
): Promise<OrderView> {
  const items = doc.items as unknown as OrderItem[];
  const orderNote = doc.orderNote ?? null;

  // Accumulated printed ledger: every printed KOT item line of this order.
  // This is the incremental-delta baseline — NOT just the latest KOT. Cancelled
  // KOTs are excluded: their quantities were removed from the order, so they
  // must never count as a baseline (otherwise re-added items would be treated
  // as already printed and never re-sent).
  const printedLines = printedLinesOverride ??
    (
      (await KotModel.find({
        restaurantId: doc.restaurantId as unknown as string,
        orderId: doc._id as unknown as string,
        printedAt: { $ne: null },
        status: { $ne: "CANCELLED" },
      })
        .select("items")
        .lean()) as unknown as { items: KotItem[] }[]
    ).flatMap((kot) => kot.items.map(toKotPrintedLine));

  const pendingKitchenPrint = pendingKitchenKind(
    { items, orderNote } as Record<string, unknown>,
    printedLines
  );
  // Per-line printed/new split — the incremental delta is the sum of the
  // unsent portions, so the cart can lock printed lines and keep only new
  // quantities editable.
  const splits = splitKitchenQuantities(
    items as unknown as typeof items,
    printedLines
  );
  const pendingKitchenItems = items.flatMap((item, index) => {
    const unsent = splits[index]?.unsentQuantity ?? item.quantity;
    if (unsent <= 0) return [];
    return [
      toKotItemView({
        menuItemId: String(item.menuItemId),
        variantId: item.variantId ? String(item.variantId) : null,
        name: item.nameSnapshot,
        variant: item.variantNameSnapshot ?? null,
        quantity: unsent,
        note: item.note ?? null,
      }),
    ];
  });

  return {
    id: String(doc._id),
    orderNumber: doc.orderNumber,
    orderType: doc.orderType as OrderType,
    status: doc.status as OrderStatus,
    tableId: doc.tableId ? String(doc.tableId) : null,
    tableNameSnapshot: doc.tableNameSnapshot ?? null,
    customerName: doc.customerName ?? null,
    customerPhone: doc.customerPhone ?? null,
    items: items.map((item, index) => ({
      menuItemId: String(item.menuItemId),
      nameSnapshot: item.nameSnapshot,
      variantId: item.variantId ? String(item.variantId) : null,
      variantNameSnapshot: item.variantNameSnapshot ?? null,
      hsnSacCode: item.hsnSacCode ?? null,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      note: item.note ?? null,
      lineTotalPaise: item.quantity * item.unitPricePaise,
      printedQuantity: splits[index]?.printedQuantity ?? 0,
      unsentQuantity: splits[index]?.unsentQuantity ?? item.quantity,
    })),
    totalPaise: doc.totalPaise,
    discountPaise: doc.discountPaise ?? 0,
    discountType: (doc.discountType as DiscountType | null) ?? null,
    discountValue: doc.discountValue ?? null,
    discountReason: doc.discountReason ?? null,
    pendingKitchenPrint,
    pendingKitchenItems,
    orderNote,
    createdBy: String(doc.createdBy),
    cancelledBy: doc.cancelledBy ? String(doc.cancelledBy) : null,
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
    updatedAt: doc.updatedAt ? String(doc.updatedAt) : "",
    heldAt: doc.heldAt ? String(doc.heldAt) : null,
    resumedAt: doc.resumedAt ? String(doc.resumedAt) : null,
    sentToKitchenAt: doc.sentToKitchenAt ? String(doc.sentToKitchenAt) : null,
    cancelledAt: doc.cancelledAt ? String(doc.cancelledAt) : null,
    cancellationReason: doc.cancellationReason ?? null,
    paidAt: doc.paidAt ? String(doc.paidAt) : null,
  };
}

async function nextOrderNumber(restaurantId: string): Promise<number> {
  const last = await OrderModel.findOne({ restaurantId })
    .sort({ orderNumber: -1 })
    .select("orderNumber")
    .lean();
  return (last?.orderNumber ?? FIRST_ORDER_NUMBER - 1) + 1;
}

const MONGODB_DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: number }).code === MONGODB_DUPLICATE_KEY
  );
}

/**
 * Inserts an order document, re-minting the sequential order number if a
 * concurrent create already used the number we read. The unique
 * {restaurantId, orderNumber} index guarantees a single winner; losers re-mint
 * and retry rather than writing a duplicate public order number.
 */
async function insertOrderWithNumberRetry(
  restaurantId: string,
  base: Record<string, unknown>
): Promise<OrderDocument> {
  // The ceiling is high so even a flurry of parallel creates (several staff /
  // tabs) can each find a fresh number; the uncontended path is exactly one
  // attempt.
  for (let attempt = 0; attempt < 25; attempt++) {
    const orderNumber = await nextOrderNumber(restaurantId);
    try {
      const doc = await OrderModel.create({
        ...base,
        orderNumber,
      });
      return doc as unknown as OrderDocument;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new OrderValidationError("Could not assign an order number. Please retry.");
}

/**
 * Validates a menu item belongs to the restaurant and is sellable.
 * Returns a stripped, server-trusted summary for POS display.
 */
export async function validateMenuItemForOrder(
  restaurantId: string,
  menuItemId: string
): Promise<{ id: string; name: string; hasVariants: boolean; basePrice: number | null } | null> {
  await connectDB();
  const item = await MenuItemModel.findOne({ _id: menuItemId, restaurantId })
    .select("name hasVariants basePrice isAvailable isActive")
    .lean();
  if (!item || !item.isActive || !item.isAvailable) return null;
  return {
    id: String(item._id),
    name: item.name,
    hasVariants: item.hasVariants,
    basePrice: item.basePrice ?? null,
  };
}

/**
 * Validates a variant belongs to the restaurant + item and is active.
 * Returns its server-side price in paise.
 */
export async function validateVariantForOrder(
  restaurantId: string,
  menuItemId: string,
  variantId: string
): Promise<{ id: string; displayName: string; pricePaise: number } | null> {
  await connectDB();
  const variant = await MenuVariantModel.findOne({
    _id: variantId,
    restaurantId,
    menuItemId,
  })
    .select("displayName price isActive")
    .lean();
  if (!variant || !variant.isActive) return null;
  return {
    id: String(variant._id),
    displayName: variant.displayName,
    pricePaise: variant.price,
  };
}

/**
 * Validates a table belongs to the restaurant and is active.
 * Does NOT check availability — callers decide (new order occupy vs reopen).
 */
export async function validateTableForOrder(
  restaurantId: string,
  tableId: string
): Promise<{ id: string; name: string; status: string } | null> {
  await connectDB();
  const table = await RestaurantTableModel.findOne({ _id: tableId, restaurantId })
    .select("name status isActive")
    .lean();
  if (!table || !table.isActive) return null;
  return { id: String(table._id), name: table.name, status: table.status };
}

/**
 * Resolves an order's item lines against the Menu, capturing server-side
 * snapshot data (name, variant label, price in paise). Prices are never taken
 * from the browser. Throws OrderValidationError on the first invalid line.
 */
async function buildOrderItems(
  restaurantId: string,
  lines: OrderItemLineInput[]
): Promise<BuiltOrderItem[]> {
  const menuItemIds = [...new Set(lines.map((l) => l.menuItemId))];
  const variantIds = [
    ...new Set(
      lines.map((l) => l.variantId).filter((v): v is string => Boolean(v))
    ),
  ];

  const [itemDocs, variantDocs] = await Promise.all([
    MenuItemModel.find({ restaurantId, _id: { $in: menuItemIds } }).lean(),
    MenuVariantModel.find({ restaurantId, _id: { $in: variantIds } }).lean(),
  ]);

  const itemById = new Map(itemDocs.map((d) => [String(d._id), d]));
  const variantById = new Map(variantDocs.map((d) => [String(d._id), d]));

  const built: BuiltOrderItem[] = [];
  for (const line of lines) {
    const item = itemById.get(line.menuItemId);
    if (!item) {
      throw new OrderValidationError("One of the items was not found. Refresh the menu and try again.");
    }
    if (!item.isActive) {
      throw new OrderValidationError(`"${item.name}" is no longer on the menu.`);
    }
    if (!item.isAvailable) {
      throw new OrderValidationError(`"${item.name}" is unavailable right now.`);
    }

    let variantId: unknown = null;
    let variantNameSnapshot: string | null = null;
    let unitPricePaise: number;

    if (item.hasVariants) {
      if (!line.variantId) {
        throw new OrderValidationError(`Choose a variant for "${item.name}".`);
      }
      const variant = variantById.get(line.variantId);
      if (!variant || String(variant.menuItemId) !== String(item._id)) {
        throw new OrderValidationError(`The selected variant for "${item.name}" is not valid.`);
      }
      if (!variant.isActive) {
        throw new OrderValidationError(`The selected variant for "${item.name}" is unavailable.`);
      }
      variantId = variant._id;
      variantNameSnapshot = variant.displayName;
      unitPricePaise = variant.price;
    } else {
      if (line.variantId) {
        throw new OrderValidationError(`"${item.name}" does not have variants.`);
      }
      if (typeof item.basePrice !== "number" || !Number.isFinite(item.basePrice)) {
        throw new OrderValidationError(`"${item.name}" has no price set.`);
      }
      unitPricePaise = item.basePrice;
    }

    if (!Number.isFinite(unitPricePaise) || unitPricePaise < 0) {
      throw new OrderValidationError(`"${item.name}" has an invalid price.`);
    }

    built.push({
      menuItemId: item._id,
      nameSnapshot: item.name,
      variantId,
      variantNameSnapshot,
      // Variants have no code of their own — they inherit the parent item's,
      // so this is a per-line snapshot independent of any later menu edit.
      hsnSacCode: item.hsnSacCode?.trim() ? item.hsnSacCode.trim() : null,
      quantity: line.quantity,
      unitPricePaise,
      note: line.note?.trim() ? line.note.trim() : null,
    });
  }
  return built;
}

function computeTotalPaise(items: BuiltOrderItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPricePaise * item.quantity, 0);
}

function cleanText(value: string | undefined | null): string | null {
  return value?.trim() ? value.trim() : null;
}

async function claimTableIfAvailable(
  restaurantId: string,
  tableId: string
): Promise<{ id: string; name: string } | null> {
  const doc = await RestaurantTableModel.findOneAndUpdate(
    { _id: tableId, restaurantId, isActive: true, status: "AVAILABLE" },
    { $set: { status: "OCCUPIED" } },
    { returnDocument: "after" }
  ).lean();
  if (!doc) return null;
  return { id: String(doc._id), name: doc.name };
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

/**
 * Returns the single live (non-held, non-cancelled) order currently seated at
 * a table, or null. Enforces "one active order per table".
 */
export async function getActiveOrderForTable(
  restaurantId: string,
  tableId: string
): Promise<OrderView | null> {
  await connectDB();
  const doc = await OrderModel.findOne({
    restaurantId,
    tableId,
    status: { $in: ACTIVE_ORDER_STATUSES },
  })
    .sort({ createdAt: 1 })
    .lean();
  return doc ? await toOrderView(doc as unknown as OrderDocument) : null;
}

export async function getActiveOrders(restaurantId: string): Promise<OrderView[]> {
  await connectDB();
  const docs = await OrderModel.find({
    restaurantId,
    status: { $in: ACTIVE_ORDER_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();
  return loadOrderViews(restaurantId, docs);
}

export async function getHeldOrders(restaurantId: string): Promise<OrderView[]> {
  await connectDB();
  const docs = await OrderModel.find({ restaurantId, status: "HELD" })
    .sort({ createdAt: -1 })
    .lean();
  return loadOrderViews(restaurantId, docs);
}

export async function getPosOrders(
  restaurantId: string
): Promise<{ activeOrders: OrderView[]; heldOrders: OrderView[] }> {
  await connectDB();
  const docs = await OrderModel.find({
    restaurantId,
    status: { $in: [...ACTIVE_ORDER_STATUSES, "HELD"] },
  })
    .sort({ createdAt: -1 })
    .lean();
  const views = await loadOrderViews(restaurantId, docs);

  return {
    activeOrders: views.filter((order) => order.status !== "HELD"),
    heldOrders: views.filter((order) => order.status === "HELD"),
  };
}

async function loadOrderViews(
  restaurantId: string,
  docs: unknown[]
): Promise<OrderView[]> {
  if (docs.length === 0) return [];

  const orderIds = docs.map((doc) => String((doc as { _id: unknown })._id));
  const kotQuery: Record<string, unknown> = {
    restaurantId,
    orderId: { $in: orderIds },
    printedAt: { $ne: null },
    status: { $ne: "CANCELLED" },
  };
  const kots = (await KotModel.find(kotQuery)
    .select("orderId items")
    .lean()) as unknown as { orderId: unknown; items: KotItem[] }[];

  const printedLinesByOrder = new Map<string, KotItem[]>();
  for (const kot of kots) {
    const key = String(kot.orderId);
    const lines = printedLinesByOrder.get(key) ?? [];
    lines.push(...kot.items);
    printedLinesByOrder.set(key, lines);
  }

  return Promise.all(
    docs.map((doc) => {
      const order = doc as OrderDocument;
      const printedLines =
        printedLinesByOrder.get(String(order._id))?.flatMap((item) => [
          toKotPrintedLine(item),
        ]) ?? [];
      return toOrderView(order, printedLines);
    })
  );
}

export async function getOrder(
  restaurantId: string,
  orderId: string
): Promise<OrderView | null> {
  await connectDB();
  const doc = await OrderModel.findOne({ _id: orderId, restaurantId }).lean();
  return doc ? await toOrderView(doc as unknown as OrderDocument) : null;
}

/**
 * Creates a new order. For DINE_IN the table is claimed atomically
 * (AVAILABLE -> OCCUPIED) so a double-submit can never produce two active
 * orders for the same table. Snapshot data comes from the database.
 */
export async function createOrder(
  restaurantId: string,
  userId: string,
  input: CreateOrderInput
): Promise<OrderView> {
  await connectDB();
  const items = await buildOrderItems(restaurantId, input.items);
  const totalPaise = computeTotalPaise(items);

  if (input.orderType === "DINE_IN") {
    if (!input.tableId) {
      throw new OrderValidationError("Select a table for a dine-in order.");
    }
    const existing = await getActiveOrderForTable(restaurantId, input.tableId);
    if (existing) {
      throw new OrderValidationError(
        `Table already has an active order #${existing.orderNumber}. Reopen it instead.`
      );
    }
    const table = await claimTableIfAvailable(restaurantId, input.tableId);
    if (!table) {
      throw new OrderValidationError(
        "This table is not available for a new order. Refresh the table list and try again."
      );
    }
    try {
      const doc = await insertOrderWithNumberRetry(restaurantId, {
        restaurantId,
        orderType: "DINE_IN",
        status: "OPEN",
        tableId: input.tableId,
        tableNameSnapshot: table.name,
        customerName: cleanText(input.customerName),
        customerPhone: cleanText(input.customerPhone),
        items: items as unknown as OrderItem[],
        totalPaise,
        orderNote: cleanText(input.orderNote),
        createdBy: userId,
      });
      await logOrderCreated(restaurantId, userId, doc);
      return await toOrderView(doc);
    } catch (error) {
      await releaseTableIfIdle(restaurantId, input.tableId);
      throw error;
    }
  }

  const doc = await insertOrderWithNumberRetry(restaurantId, {
    restaurantId,
    orderType: input.orderType,
    status: "OPEN",
    tableId: null,
    tableNameSnapshot: null,
    customerName: cleanText(input.customerName),
    customerPhone: cleanText(input.customerPhone),
    items: items as unknown as OrderItem[],
    totalPaise,
    orderNote: cleanText(input.orderNote),
    createdBy: userId,
  });
  await logOrderCreated(restaurantId, userId, doc);
  return await toOrderView(doc);
}

/** Internal follow-up log for a freshly created order (fail-soft). */
async function logOrderCreated(
  restaurantId: string,
  userId: string | null | undefined,
  doc: OrderDocument
): Promise<void> {
  await writeAuditLog({
    restaurantId,
    actorUserId: userId ?? undefined,
    action: "ORDER_CREATED",
    resourceType: "ORDER",
    resourceId: String(doc._id),
    after: {
      orderNumber: doc.orderNumber,
      status: "OPEN",
      orderType: doc.orderType,
      totalPaise: doc.totalPaise,
      itemCount: ((doc.items as unknown[]) ?? []).length,
    },
    metadata: { orderNumber: doc.orderNumber, orderType: doc.orderType },
  });
}

/**
 * Replaces the items (and order-level fields) of an OPEN order. Re-validates
 * every line against the Menu and re-captures snapshots. No silent edits after
 * the order has left OPEN (e.g. after KOT_SENT).
 */
export async function updateOrder(
  restaurantId: string,
  orderId: string,
  input: {
    items: OrderItemLineInput[];
    customerName?: string;
    customerPhone?: string;
    orderNote?: string;
  },
  userId?: string | null
): Promise<OrderView> {
  await connectDB();
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw new OrderNotFoundError();
  if (!EDITABLE_ORDER_STATUSES.includes(order.status as OrderStatus)) {
    throw new OrderValidationError(
      "This order can no longer be edited. Only open orders can be changed."
    );
  }

  const beforeStatus = order.status;

  const items = await buildOrderItems(restaurantId, input.items);
  const totalPaise = computeTotalPaise(items);

  order.items = items as unknown as typeof order.items;
  order.totalPaise = totalPaise;
  order.orderNote = cleanText(input.orderNote);
  order.customerName = cleanText(input.customerName);
  order.customerPhone = cleanText(input.customerPhone);
  await order.save();

  await writeAuditLog({
    restaurantId,
    actorUserId: userId ?? undefined,
    action: "ORDER_UPDATED",
    resourceType: "ORDER",
    resourceId: orderId,
    before: { status: beforeStatus, totalPaise },
    after: {
      status: order.status,
      totalPaise,
      itemCount: items.length,
    },
    metadata: { orderNumber: order.orderNumber, itemCount: items.length },
  });

  return await toOrderView(order as unknown as OrderDocument);
}

export async function holdOrder(
  restaurantId: string,
  orderId: string
): Promise<OrderView> {
  await connectDB();
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw new OrderNotFoundError();
  if (order.status !== "OPEN") {
    throw new OrderValidationError("Only open orders can be held.");
  }
  order.status = "HELD";
  order.heldAt = new Date();
  await order.save();

  if (order.tableId) {
    await releaseTableIfIdle(restaurantId, String(order.tableId), orderId);
  }
  return await toOrderView(order as unknown as OrderDocument);
}

export async function resumeOrder(
  restaurantId: string,
  orderId: string
): Promise<OrderView> {
  await connectDB();
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw new OrderNotFoundError();
  if (order.status !== "HELD") {
    throw new OrderValidationError("Only held orders can be resumed.");
  }

  if (order.tableId) {
    const tableId = String(order.tableId);
    const other = await getActiveOrderForTable(restaurantId, tableId);
    if (other && other.id !== orderId) {
      throw new OrderValidationError(
        `Table ${order.tableNameSnapshot ?? ""} is now occupied by another order (#${other.orderNumber}). Choose a different table or cancel that order first.`.trim()
      );
    }
    const table = await claimTableIfAvailable(restaurantId, tableId);
    if (!table) {
      throw new OrderValidationError(
        `Table ${order.tableNameSnapshot ?? ""} is not available. Pick a different table to resume this order.`.trim()
      );
    }
    order.tableNameSnapshot = table.name;
  }

  order.status = "OPEN";
  order.resumedAt = new Date();
  await order.save();
  return await toOrderView(order as unknown as OrderDocument);
}

export async function cancelOrder(
  restaurantId: string,
  orderId: string,
  userId: string,
  reason?: string
): Promise<OrderView> {
  await connectDB();
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw new OrderNotFoundError();
  if (order.status !== "OPEN" && order.status !== "HELD") {
    throw new OrderValidationError("Only open or held orders can be cancelled.");
  }
  const beforeStatus = order.status;

  order.status = "CANCELLED";
  order.cancelledAt = new Date();
  order.cancelledBy = userId as unknown as typeof order.cancelledBy;
  order.cancellationReason = cleanText(reason);
  await order.save();

  await writeAuditLog({
    restaurantId,
    actorUserId: userId,
    action: "ORDER_CANCELLED",
    resourceType: "ORDER",
    resourceId: orderId,
    before: { status: beforeStatus },
    after: { status: "CANCELLED" },
    reason: cleanText(reason),
    metadata: { orderNumber: order.orderNumber },
  });

  if (order.tableId) {
    await releaseTableIfIdle(restaurantId, String(order.tableId), orderId);
  }
  return await toOrderView(order as unknown as OrderDocument);
}

/**
 * SEND TO KITCHEN is intentionally a tray-only placeholder in this module:
 * the KOT document, printing and status workflow ship with the KOT module.
 * For now it transitions OPEN -> KOT_SENT and stamps a timestamp.
 */
export async function sendOrderToKitchen(
  restaurantId: string,
  orderId: string
): Promise<OrderView> {
  await connectDB();
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw new OrderNotFoundError();
  if (order.status !== "OPEN") {
    throw new OrderValidationError("Only open orders can be sent to the kitchen.");
  }
  if (!order.items || (order.items as unknown as OrderItem[]).length === 0) {
    throw new OrderValidationError("Add at least one item before sending to the kitchen.");
  }
  order.status = "KOT_SENT";
  order.sentToKitchenAt = new Date();
  await order.save();
  return await toOrderView(order as unknown as OrderDocument);
}

export async function moveOrderToTable(
  restaurantId: string,
  orderId: string,
  destinationTableId: string
): Promise<OrderView> {
  await connectDB();
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw new OrderNotFoundError();
  if (order.orderType !== "DINE_IN" || !order.tableId) {
    throw new OrderValidationError("Only dine-in orders seated at a table can be moved.");
  }
  if (!ACTIVE_ORDER_STATUSES.includes(order.status as OrderStatus)) {
    throw new OrderValidationError(
      `This order cannot be moved from ${ACTIVE_ORDER_STATUSES.join("/")} status.`
    );
  }
  const sourceTableId = String(order.tableId);
  if (sourceTableId === destinationTableId) {
    throw new OrderValidationError("Choose a different table to move the order to.");
  }

  const other = await getActiveOrderForTable(restaurantId, destinationTableId);
  if (other && other.id !== orderId) {
    throw new OrderValidationError(
      `Destination table already has an active order (#${other.orderNumber}).`
    );
  }

  const claimed = await claimTableIfAvailable(restaurantId, destinationTableId);
  if (!claimed) {
    throw new OrderValidationError(
      "The destination table is not available. Pick a different table."
    );
  }

  // Destination is claimed first so a failure never strands the order.
  await releaseTableIfIdle(restaurantId, sourceTableId, orderId);
  order.tableId = destinationTableId as unknown as typeof order.tableId;
  order.tableNameSnapshot = claimed.name;
  await order.save();
  return await toOrderView(order as unknown as OrderDocument);
}