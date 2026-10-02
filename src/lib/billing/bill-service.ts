import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { BillModel, type BillDocument, type BillItem } from "@/models/Bill";
import { PaymentModel, type PaymentDocument } from "@/models/Payment";
import { OrderModel } from "@/models/Order";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { recordAudit } from "@/lib/tables/audit";
import { calculateBill } from "./tax";
import {
  resolveBillDiscount,
  type BillDiscountInput,
} from "./discount";
import {
  normalizeTaxOverride,
  resolveEffectiveTaxEnabled,
  resolveLineComponentRates,
  resolveTaxConfig,
  type RestaurantTaxDefaults,
} from "./tax-config";
import type { GstScheme } from "./constants";
import {
  BILL_PREFIX_DEFAULT,
  BILL_PREFIX_MAX,
  BILL_NUMBER_PAD,
  BILLABLE_ORDER_STATUSES,
  FIRST_BILL_SEQUENCE,
  PAYABLE_BILL_STATUSES,
  type BillPaymentMethod,
  type BillStatus,
} from "./constants";
import { ACTIVE_ORDER_STATUSES, type OrderStatus } from "@/lib/orders/constants";
import {
  BillAlreadyPaidError,
  BillConflictError,
  BillNotPayableError,
  BillNotFoundError,
  BillValidationError,
  OverpaymentError,
} from "./errors";
import type {
  BillItemView,
  BillListItemView,
  BillView,
  PaymentView,
} from "./types";

const MONGODB_DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: number }).code === MONGODB_DUPLICATE_KEY
  );
}

/** "BILL" -> "BILL-000001", "B" -> "B-000001". */
export function formatBillNumber(sequence: number, prefix: string): string {
  const padded = String(sequence).padStart(BILL_NUMBER_PAD, "0");
  return `${normalizeBillPrefix(prefix)}-${padded}`;
}

export function normalizeBillPrefix(prefix: string | null | undefined): string {
  const cleaned = (prefix ?? "").replace(/[^a-zA-Z0-9]/g, "").trim().toUpperCase();
  return (cleaned || BILL_PREFIX_DEFAULT).slice(0, BILL_PREFIX_MAX);
}

function toPaymentView(doc: PaymentDocument): PaymentView {
  return {
    id: String(doc._id),
    method: doc.method as BillPaymentMethod,
    amountPaise: doc.amountPaise,
    referenceNumber: doc.referenceNumber ?? null,
    note: doc.note ?? null,
    receivedBy: String(doc.receivedBy),
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
  };
}

function billItemToView(item: BillItem): BillItemView {
  return {
    menuItemId: String(item.menuItemId),
    nameSnapshot: item.nameSnapshot,
    variantId: item.variantId ? String(item.variantId) : null,
    variantNameSnapshot: item.variantNameSnapshot ?? null,
    hsnSacCode: item.hsnSacCode ?? null,
    quantity: item.quantity,
    unitPricePaise: item.unitPricePaise,
    taxableValuePaise: item.taxableValuePaise,
    discountAmountPaise: item.discountAmountPaise ?? 0,
    taxRatePercent: item.taxRatePercent ?? 0,
    cgstAmountPaise: item.cgstAmountPaise ?? 0,
    sgstAmountPaise: item.sgstAmountPaise ?? 0,
    igstAmountPaise: item.igstAmountPaise ?? 0,
    lineTotalPaise: item.lineTotalPaise,
  };
}

async function loadPayments(
  restaurantId: string,
  billId: string
): Promise<PaymentView[]> {
  const docs = await PaymentModel.find({ restaurantId, billId })
    .sort({ createdAt: 1 })
    .lean();
  return docs.map((d) => toPaymentView(d as unknown as PaymentDocument));
}

async function loadOrderStatus(
  restaurantId: string,
  orderId: string
): Promise<OrderStatus> {
  const order = await OrderModel.findOne({ _id: orderId, restaurantId })
    .select("status")
    .lean();
  return (order?.status as OrderStatus) ?? "OPEN";
}

export async function toBillView(
  doc: BillDocument,
  orderStatus?: OrderStatus
): Promise<BillView> {
  const status =
    (doc.status as BillStatus) ?? ((doc.paymentStatus as BillStatus) ?? "UNPAID");
  const resolvedOrderStatus =
    orderStatus ?? (await loadOrderStatus(String(doc.restaurantId), String(doc.orderId)));
  const payments = await loadPayments(
    String(doc.restaurantId),
    String(doc._id)
  );
  return {
    id: String(doc._id),
    orderId: String(doc.orderId),
    orderNumber: doc.orderNumber,
    orderType: doc.orderType as BillView["orderType"],
    orderStatus: resolvedOrderStatus,
    billNumber: doc.billNumber,
    status,
    paymentStatus: (doc.status as BillStatus) ?? "UNPAID",
    tableId: doc.tableId ? String(doc.tableId) : null,
    tableNameSnapshot: doc.tableNameSnapshot ?? null,
    customerName: doc.customerName ?? null,
    customerPhone: doc.customerPhone ?? null,
    items: (doc.items as unknown as BillItem[]).map(billItemToView),
    subtotalPaise: doc.subtotalPaise,
    discountPaise: doc.discountPaise ?? 0,
    discountType: (doc.discountType as BillView["discountType"]) ?? null,
    discountValue: doc.discountValue ?? null,
    discountReason: doc.discountReason ?? null,
    taxableAmountPaise: doc.taxableAmountPaise,
    cgstAmountPaise: doc.cgstAmountPaise ?? 0,
    sgstAmountPaise: doc.sgstAmountPaise ?? 0,
    igstAmountPaise: doc.igstAmountPaise ?? 0,
    totalTaxPaise: doc.totalTaxPaise ?? 0,
    taxRatePercent: doc.taxRatePercent ?? 0,
    cgstRatePercent: doc.cgstRatePercent ?? 0,
    sgstRatePercent: doc.sgstRatePercent ?? 0,
    igstRatePercent: doc.igstRatePercent ?? 0,
    taxInclusive: doc.taxInclusive ?? false,
    gstScheme: (doc.gstScheme as BillView["gstScheme"]) ?? "INTRA_STATE",
    gstRegistered: doc.gstRegistered ?? false,
    gstin: doc.gstin ?? null,
    serviceChargeEnabled: doc.serviceChargeEnabled ?? false,
    serviceChargeRatePercent: doc.serviceChargeRatePercent ?? 0,
    serviceChargeAmountPaise: doc.serviceChargeAmountPaise ?? 0,
    roundOffEnabled: doc.roundOffEnabled ?? false,
    roundOffAmountPaise: doc.roundOffAmountPaise ?? 0,
    grandTotalPaise: doc.grandTotalPaise,
    paidAmountPaise: doc.paidAmountPaise ?? 0,
    dueAmountPaise: doc.dueAmountPaise,
    createdBy: String(doc.createdBy),
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
    updatedAt: doc.updatedAt ? String(doc.updatedAt) : "",
    paidAt: doc.paidAt ? String(doc.paidAt) : null,
    cancelledAt: doc.cancelledAt ? String(doc.cancelledAt) : null,
    cancellationReason: doc.cancellationReason ?? null,
    printedCount: doc.printedCount ?? 0,
    payments,
  };
}

function toBillListItem(doc: BillDocument, orderStatus: OrderStatus): BillListItemView {
  return {
    id: String(doc._id),
    orderId: String(doc.orderId),
    orderNumber: doc.orderNumber,
    billNumber: doc.billNumber,
    status: (doc.status as BillStatus) ?? "UNPAID",
    paymentStatus: (doc.status as BillStatus) ?? "UNPAID",
    orderType: doc.orderType as BillListItemView["orderType"],
    orderStatus,
    tableNameSnapshot: doc.tableNameSnapshot ?? null,
    customerName: doc.customerName ?? null,
    grandTotalPaise: doc.grandTotalPaise,
    paidAmountPaise: doc.paidAmountPaise ?? 0,
    dueAmountPaise: doc.dueAmountPaise,
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
    updatedAt: doc.updatedAt ? String(doc.updatedAt) : "",
  };
}

export async function getBill(
  restaurantId: string,
  billId: string
): Promise<BillView | null> {
  await connectDB();
  const doc = await BillModel.findOne({ _id: billId, restaurantId }).lean();
  if (!doc) return null;
  return toBillView(doc as unknown as BillDocument);
}

export async function getBillForOrder(
  restaurantId: string,
  orderId: string
): Promise<BillView | null> {
  await connectDB();
  const doc = await BillModel.findOne({ restaurantId, orderId }).lean();
  if (!doc) return null;
  return toBillView(doc as unknown as BillDocument);
}

export async function listBills(
  restaurantId: string,
  input: { status?: string; search?: string; offset?: number; limit?: number }
): Promise<{ bills: BillListItemView[]; total: number }> {
  await connectDB();
  const status = input.status && input.status !== "" ? input.status : null;
  const search = input.search?.trim();

  const match: Record<string, unknown> = { restaurantId };
  if (status) match.status = status;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match.$or = [
      { billNumber: { $regex: escaped, $options: "i" } },
      { orderNumber: Number.isFinite(Number(search)) ? Number(search) : -1 },
    ];
  }

  const [docs, total] = await Promise.all([
    BillModel.find(match).sort({ createdAt: -1 }).skip(input.offset ?? 0).limit(input.limit ?? 20).lean(),
    BillModel.countDocuments(match),
  ]);

  const orderIds = docs.map((d) => d.orderId);
  const orderDocs = await OrderModel.find({ restaurantId, _id: { $in: orderIds } })
    .select("_id status")
    .lean();
  const statusById = new Map<string, OrderStatus>(
    orderDocs.map((o) => [String(o._id), o.status as OrderStatus])
  );

  const bills = docs.map((d) =>
    toBillListItem(d as unknown as BillDocument, statusById.get(String(d.orderId)) ?? "OPEN")
  );
  return { bills, total };
}

async function nextBillSequence(restaurantId: string): Promise<number> {
  const last = await BillModel.findOne({ restaurantId })
    .sort({ billSequence: -1 })
    .select("billSequence")
    .lean();
  return (last?.billSequence ?? FIRST_BILL_SEQUENCE - 1) + 1;
}

/**
 * Generates a bill for an order from server-side snapshots. Idempotent: an
 * order can only ever have one bill, so a double submit returns the existing
 * bill instead of creating a second one. The order/table status is untouched
 * here (payments later move the order to PAID and release the table).
 *
 * A discount may only be chosen at bill-generation time — it is never stored
 * on the order. When the caller leaves the discount unspecified (legacy
 * callers, or a pre-refactor order), the order's stored discount snapshot is
 * preserved so existing discounted orders still bill exactly as before.
 */
export async function generateBill(
  restaurantId: string,
  orderId: string,
  userId: string,
  discountInput?: BillDiscountInput
): Promise<BillView> {
  await connectDB();

  const order = await OrderModel.findOne({ _id: orderId, restaurantId }).lean();
  if (!order) {
    throw new BillValidationError("Order not found.");
  }
  const orderStatus = order.status as OrderStatus;
  if (orderStatus === "CANCELLED") {
    throw new BillValidationError("Cancelled orders cannot be billed.");
  }
  if (orderStatus === "PAID") {
    throw new BillValidationError("This order is already paid.");
  }
  if (!BILLABLE_ORDER_STATUSES.includes(orderStatus)) {
    throw new BillValidationError(
      "Only open, in-progress, served or held orders can be billed."
    );
  }
  const orderItems = (order.items ?? []) as unknown as Array<{
    menuItemId: unknown;
    nameSnapshot: string;
    variantId: unknown | null;
    variantNameSnapshot: string | null;
    hsnSacCode: string | null;
    quantity: number;
    unitPricePaise: number;
  }>;
  if (orderItems.length === 0) {
    throw new BillValidationError("Add at least one item before generating a bill.");
  }

  const existing = await BillModel.findOne({ restaurantId, orderId }).lean();
  if (existing) {
    return toBillView(existing as unknown as BillDocument, orderStatus);
  }

  const subtotalPaise = orderItems.reduce(
    (sum, item) => sum + item.unitPricePaise * item.quantity,
    0
  );

  // Discounts live on the bill, never the order. Explicit input wins; when the
  // caller leaves it unspecified, fall back to a pre-refactor order snapshot so
  // legacy discounted orders are preserved. The resolver validates (percentage
  // 0–100, fixed ≤ subtotal, no negative total) and computes the amount.
  const legacyOrderDiscount: BillDiscountInput =
    (order.discountPaise ?? 0) > 0 || order.discountType != null
      ? {
          discountType:
            (order.discountType as BillDiscountInput["discountType"]) ?? null,
          discountValue: order.discountValue ?? null,
          discountReason: order.discountReason ?? null,
          discountPaise: (order.discountPaise ?? 0) > 0 ? order.discountPaise : null,
        }
      : {};
  const resolvedDiscount = resolveBillDiscount(
    subtotalPaise,
    discountInput && discountInput.discountType !== undefined
      ? discountInput
      : legacyOrderDiscount
  );

  const [settings, restaurant, itemTaxDocs, variantTaxDocs] = await Promise.all([
    RestaurantSettingsModel.findOne({ restaurantId }).lean(),
    RestaurantModel.findById(restaurantId).lean(),
    MenuItemModel.find({ restaurantId }).select("_id taxOverride").lean(),
    MenuVariantModel.find({ restaurantId }).select("_id taxOverride").lean(),
  ]);

  // Per-restaurant tax configuration. Legacy settings documents predate the
  // taxEnabled/component-rate fields, so every field falls back to the
  // historical behavior (tax always applied at defaultTaxRate, split equally).
  // GST registration is the master control: an unregistered restaurant never
  // charges tax, regardless of stored taxEnabled or per-item overrides.
  const taxEnabled = resolveEffectiveTaxEnabled(
    settings?.taxEnabled ?? true,
    restaurant?.gstRegistered ?? false
  );
  const taxRatePercent = taxEnabled ? (settings?.defaultTaxRate ?? 0) : 0;
  const taxInclusive = settings?.taxInclusive ?? false;
  const gstScheme = (settings?.gstScheme as GstScheme) ?? "INTRA_STATE";

  const restaurantDefaults: RestaurantTaxDefaults = {
    taxRatePercent,
    taxInclusive,
    gstScheme,
  };

  const itemTaxOverrideById = new Map(
    itemTaxDocs.map((d) => [String(d._id), d.taxOverride])
  );
  const variantTaxOverrideById = new Map(
    variantTaxDocs.map((d) => [String(d._id), d.taxOverride])
  );

  // Resolve the effective tax per order line using the priority
  // variant override > item override > restaurant default. The master
  // taxEnabled switch stays authoritative: when it is off no override applies.
  const billedItems = orderItems.map((item) => {
    const base = { unitPricePaise: item.unitPricePaise, quantity: item.quantity };
    if (!taxEnabled) {
      return { ...base, taxRatePercent: 0, taxInclusive, gstScheme };
    }
    const itemOverride = itemTaxOverrideById.get(String(item.menuItemId));
    const variantOverride = item.variantId
      ? variantTaxOverrideById.get(String(item.variantId))
      : null;
    const resolved = resolveTaxConfig(restaurantDefaults, itemOverride, variantOverride);
    const usingOverride =
      normalizeTaxOverride(variantOverride).enabled ||
      normalizeTaxOverride(itemOverride).enabled;
    if (!usingOverride) return base;
    const components = resolveLineComponentRates(resolved, {
      cgstRatePercent: settings?.cgstRatePercent ?? null,
      sgstRatePercent: settings?.sgstRatePercent ?? null,
      igstRatePercent: settings?.igstRatePercent ?? null,
    });
    return {
      ...base,
      taxRatePercent: resolved.taxRatePercent,
      taxInclusive: resolved.taxInclusive,
      gstScheme: resolved.gstScheme,
      cgstRatePercent: components.cgstRatePercent,
      sgstRatePercent: components.sgstRatePercent,
      igstRatePercent: components.igstRatePercent,
    };
  });

  const calculated = calculateBill({
    items: billedItems,
    discountPaise: resolvedDiscount.discountPaise,
    taxRatePercent,
    taxInclusive,
    serviceChargeEnabled: settings?.serviceChargeEnabled ?? false,
    serviceChargeRatePercent: settings?.serviceChargeRate ?? 0,
    roundOffEnabled: settings?.roundOffEnabled ?? false,
    gstScheme,
    gstRegistered: restaurant?.gstRegistered ?? false,
    cgstRatePercent: settings?.cgstRatePercent ?? null,
    sgstRatePercent: settings?.sgstRatePercent ?? null,
    igstRatePercent: settings?.igstRatePercent ?? null,
  });

  const prefix = normalizeBillPrefix(settings?.billPrefix);
  let sequence = await nextBillSequence(restaurantId);

  const baseDoc = {
    restaurantId,
    orderId,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    tableId: order.tableId ?? null,
    tableNameSnapshot: order.tableNameSnapshot ?? null,
    customerName: order.customerName ?? null,
    customerPhone: order.customerPhone ?? null,
    status: "UNPAID",
    paymentStatus: "UNPAID",
    billNumber: formatBillNumber(sequence, prefix),
    billSequence: sequence,
    createdBy: userId,
    items: orderItems.map((item, index) => ({
      menuItemId: item.menuItemId,
      nameSnapshot: item.nameSnapshot,
      variantId: item.variantId ?? null,
      variantNameSnapshot: item.variantNameSnapshot ?? null,
      // Resolved from the ORDER snapshot, never the live menu item: editing an
      // item's code after the fact must leave this bill exactly as generated.
      hsnSacCode: item.hsnSacCode ?? null,
      quantity: calculated.items[index].quantity,
      unitPricePaise: calculated.items[index].unitPricePaise,
      taxableValuePaise: calculated.items[index].taxableValuePaise,
      discountAmountPaise: calculated.items[index].discountAmountPaise,
      taxRatePercent: calculated.items[index].taxRatePercent,
      cgstAmountPaise: calculated.items[index].cgstAmountPaise,
      sgstAmountPaise: calculated.items[index].sgstAmountPaise,
      igstAmountPaise: calculated.items[index].igstAmountPaise,
      lineTotalPaise: calculated.items[index].lineTotalPaise,
    })),
    subtotalPaise: calculated.subtotalPaise,
    discountPaise: resolvedDiscount.discountPaise,
    discountType: resolvedDiscount.discountType as BillDocument["discountType"],
    discountValue: resolvedDiscount.discountValue,
    discountReason: resolvedDiscount.discountReason,
    taxableAmountPaise: calculated.taxableAmountPaise,
    cgstAmountPaise: calculated.cgstAmountPaise,
    sgstAmountPaise: calculated.sgstAmountPaise,
    igstAmountPaise: calculated.igstAmountPaise,
    totalTaxPaise: calculated.totalTaxPaise,
    taxRatePercent: calculated.taxRatePercent,
    cgstRatePercent: calculated.cgstRatePercent,
    sgstRatePercent: calculated.sgstRatePercent,
    igstRatePercent: calculated.igstRatePercent,
    taxInclusive: calculated.taxInclusive,
    gstScheme,
    gstRegistered: restaurant?.gstRegistered ?? false,
    gstin: restaurant?.gstin ?? null,
    serviceChargeEnabled: settings?.serviceChargeEnabled ?? false,
    serviceChargeRatePercent: settings?.serviceChargeRate ?? 0,
    serviceChargeAmountPaise: calculated.serviceChargeAmountPaise,
    roundOffEnabled: settings?.roundOffEnabled ?? false,
    roundOffAmountPaise: calculated.roundOffAmountPaise,
    grandTotalPaise: calculated.grandTotalPaise,
    paidAmountPaise: 0,
    dueAmountPaise: calculated.grandTotalPaise,
    paidAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    printedAt: null,
    printedCount: 0,
  };

  // Colliding bill numbers (concurrent bill generation across terminals) are
  // re-minted and retried. 25 attempts comfortably absorbs a flurry of
  // parallel generates; the uncontended path is exactly one attempt.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const doc = await BillModel.create(baseDoc as never);
      await recordAudit({
        restaurantId,
        userId,
        action: "BILL_GENERATED",
        entityType: "BILL",
        entityId: String(doc._id),
        metadata: {
          billNumber: baseDoc.billNumber,
          orderId,
          grandTotalPaise: baseDoc.grandTotalPaise,
        },
      });
      return toBillView(doc as unknown as BillDocument, orderStatus);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await BillModel.findOne({ restaurantId, orderId }).lean();
      if (raced) {
        return toBillView(raced as unknown as BillDocument, orderStatus);
      }
      sequence = await nextBillSequence(restaurantId);
      baseDoc.billSequence = sequence;
      baseDoc.billNumber = formatBillNumber(sequence, prefix);
    }
  }
  throw new BillConflictError("Could not assign a bill number. Please retry.");
}

interface NewPaymentInput {
  method: BillPaymentMethod;
  amountPaise: number;
  referenceNumber?: string;
  note?: string;
  idempotencyKey?: string;
}

/**
 * Records one payment against a bill and atomically advances its state:
 * PARTIAL when under the grand total, PAID when settled. Overpayments are
 * rejected. A full payment also moves the order to PAID and (for dine-in)
 * releases the table. Double-clicks are deduplicated via the optional
 * idempotency key.
 */
export async function recordPayment(
  restaurantId: string,
  billId: string,
  userId: string,
  input: NewPaymentInput
): Promise<BillView> {
  await connectDB();

  const bill = await BillModel.findOne({ _id: billId, restaurantId }).lean();
  if (!bill) throw new BillNotFoundError();

  const existingBillStatus = (bill.status as BillStatus) ?? "UNPAID";

  // Idempotency: replaying an already-recorded payment returns the bill
  // instead of charging twice.
  const idempotencyKey = input.idempotencyKey?.trim();
  if (idempotencyKey) {
    const prior = await PaymentModel.findOne({
      restaurantId,
      idempotencyKey,
    })
      .select("billId amountPaise")
      .lean();
    if (prior) {
      if (String(prior.billId) !== billId) {
        throw new BillValidationError(
          "This payment was already recorded against another bill."
        );
      }
      return toBillView(bill as unknown as BillDocument, undefined);
    }
  }

  if (existingBillStatus === "PAID") {
    throw new BillAlreadyPaidError();
  }
  if (!PAYABLE_BILL_STATUSES.includes(existingBillStatus)) {
    throw new BillNotPayableError();
  }

  const amountPaise = input.amountPaise;

  // The native driver returns the document directly unless `includeResultMetadata`
  // is set, so tolerate both shapes.
  const updatedRaw = await BillModel.collection.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(billId),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      paymentStatus: { $in: PAYABLE_BILL_STATUSES },
      $expr: {
        $lte: [{ $add: ["$paidAmountPaise", amountPaise] }, "$grandTotalPaise"],
      },
    },
    [
      {
        $set: {
          paidAmountPaise: { $add: ["$paidAmountPaise", amountPaise] },
          dueAmountPaise: {
            $max: [
              {
                $subtract: [
                  "$grandTotalPaise",
                  { $add: ["$paidAmountPaise", amountPaise] },
                ],
              },
              0,
            ],
          },
          paymentStatus: {
            $cond: [
              { $gte: [{ $add: ["$paidAmountPaise", amountPaise] }, "$grandTotalPaise"] },
              "PAID",
              "PARTIAL",
            ],
          },
          status: {
            $cond: [
              { $gte: [{ $add: ["$paidAmountPaise", amountPaise] }, "$grandTotalPaise"] },
              "PAID",
              "PARTIAL",
            ],
          },
          paidAt: {
            $cond: [
              { $gte: [{ $add: ["$paidAmountPaise", amountPaise] }, "$grandTotalPaise"] },
              new Date(),
              "$paidAt",
            ],
          },
        },
      },
    ],
    { returnDocument: "after" }
  );

  const updated =
    updatedRaw && typeof updatedRaw === "object" && "value" in updatedRaw
      ? (updatedRaw as unknown as { value: BillDocument | null }).value
      : (updatedRaw as unknown as BillDocument | null | undefined);
  if (!updated) {
    // The bill may have raced ahead of us. A keyed retry (double-click) whose
    // payment has already landed is the SAME logical payment — return the bill
    // instead of failing. Unkeyed attempts stay strict.
    if (idempotencyKey) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const recorded = await PaymentModel.findOne({
          restaurantId,
          idempotencyKey,
        })
          .select("billId")
          .lean();
        if (recorded && String(recorded.billId) === billId) {
          const current = await BillModel.findOne({
            _id: new mongoose.Types.ObjectId(billId),
            restaurantId: new mongoose.Types.ObjectId(restaurantId),
          }).lean();
          if (current) return toBillView(current as unknown as BillDocument);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new OverpaymentError("Payment exceeds the amount due.");
  }
  const outcomeStatus = updated.paymentStatus as string;
  const paidAt = outcomeStatus === "PAID" ? new Date() : null;

  const orderId = String(updated.orderId);

  try {
    await PaymentModel.create({
      restaurantId,
      billId,
      orderId,
      method: input.method,
      amountPaise,
      referenceNumber: input.referenceNumber?.trim() ? input.referenceNumber.trim() : null,
      note: input.note?.trim() ? input.note.trim() : null,
      receivedBy: userId,
      idempotencyKey: idempotencyKey ?? null,
    });
  } catch (error) {
    // The only realistic collision is a duplicate idempotency key racing in
    // between our pre-check and insert. Treat it as the same logical payment.
    if (isDuplicateKey(error)) {
      const recorded = await PaymentModel.findOne({
        restaurantId,
        idempotencyKey,
      }).lean();
      if (recorded) {
        return toBillView(updated as unknown as BillDocument);
      }
    }
    throw error;
  }

  if (outcomeStatus === "PAID") {
    await OrderModel.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId), restaurantId },
      { $set: { status: "PAID", paidAt: paidAt ?? new Date() } }
    );
    if (updated.tableId) {
      await releaseTableIfIdle(restaurantId, String(updated.tableId), orderId);
    }
    await recordAudit({
      restaurantId,
      userId,
      action: "BILL_PAID",
      entityType: "BILL",
      entityId: billId,
      metadata: {
        billNumber: updated.billNumber,
        method: input.method,
        amountPaise,
        grandTotalPaise: updated.grandTotalPaise,
      },
    });
  } else {
    await recordAudit({
      restaurantId,
      userId,
      action: "BILL_PAYMENT_ADDED",
      entityType: "BILL",
      entityId: billId,
      metadata: {
        billNumber: updated.billNumber,
        method: input.method,
        amountPaise,
        status: outcomeStatus,
      },
    });
  }

  return toBillView(updated as unknown as BillDocument);
}

/**
 * Settles the remaining due amount. Idempotent: settling an already-paid bill
 * simply returns the bill so a double-click never records a duplicate.
 */
export async function completePayment(
  restaurantId: string,
  billId: string,
  userId: string,
  input: Omit<NewPaymentInput, "amountPaise">
): Promise<BillView> {
  await connectDB();
  const bill = await BillModel.findOne({ _id: billId, restaurantId }).lean();
  if (!bill) throw new BillNotFoundError();
  if ((bill.status as BillStatus) === "PAID") {
    return toBillView(bill as unknown as BillDocument);
  }
  const dueAmountPaise = Math.max(0, (bill.dueAmountPaise ?? 0));
  return recordPayment(restaurantId, billId, userId, {
    ...input,
    amountPaise: dueAmountPaise,
  });
}

/** Releases a table back to AVAILABLE when no other active order sits on it. */
async function releaseTableIfIdle(
  restaurantId: string,
  tableId: string,
  excludeOrderId: string
): Promise<void> {
  const stillOccupied = await OrderModel.exists({
    restaurantId,
    tableId,
    status: { $in: ACTIVE_ORDER_STATUSES },
    _id: { $ne: excludeOrderId },
  });
  if (stillOccupied) return;
  await RestaurantTableModel.updateOne(
    { _id: tableId, restaurantId },
    { $set: { status: "AVAILABLE" } }
  );
}

export async function cancelBill(
  restaurantId: string,
  billId: string,
  userId: string,
  reason?: string
): Promise<BillView> {
  await connectDB();
  const bill = await BillModel.findOne({ _id: billId, restaurantId }).lean();
  if (!bill) throw new BillNotFoundError();

  const status = (bill.status as BillStatus) ?? "UNPAID";
  if (status === "CANCELLED") {
    return toBillView(bill as unknown as BillDocument);
  }
  if (status === "PAID" || status === "REFUNDED") {
    throw new BillValidationError(
      "Paid bills cannot be cancelled. A refund/credit-note workflow is required."
    );
  }

  const updated = await BillModel.findByIdAndUpdate(
    billId,
    {
      $set: {
        status: "CANCELLED",
        paymentStatus: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: reason?.trim() ? reason.trim() : null,
      },
    },
    { returnDocument: "after" }
  ).lean();

  if (!updated) throw new BillNotFoundError();

  await recordAudit({
    restaurantId,
    userId,
    action: "BILL_CANCELLED",
    entityType: "BILL",
    entityId: billId,
    metadata: {
      billNumber: updated.billNumber,
      reason: reason?.trim() ?? null,
    },
  });

  return toBillView(updated as unknown as BillDocument);
}

export async function markBillPrinted(
  restaurantId: string,
  billId: string
): Promise<BillView> {
  await connectDB();
  const updated = await BillModel.findOneAndUpdate(
    { _id: billId, restaurantId },
    { $inc: { printedCount: 1 }, $set: { printedAt: new Date() } },
    { returnDocument: "after" }
  ).lean();
  if (!updated) throw new BillNotFoundError();
  return toBillView(updated as unknown as BillDocument);
}