import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { OrderModel, type OrderDocument } from "@/models/Order";
import { BillModel, type BillDocument } from "@/models/Bill";
import { UserModel } from "@/models/User";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { getOrder } from "./order-service";
import { listOrderKots } from "./kot-service";
import { getBillForOrder } from "@/lib/billing/bill-service";
import {
  ORDERS_PAGE_SIZE,
  type OrderStatus,
  type OrderType,
} from "./constants";
import { isValidObjectId } from "@/lib/menu/utils";
import { resolveDateRange } from "./date-range";
import { parseOrdersSearchParams, type OrdersSearchParamValue } from "./orders-query";
import type { BillStatus } from "@/lib/billing/constants";
import type { BillView } from "@/lib/billing/types";
import type { Role } from "@/lib/auth/roles";
import type {
  OrderDetailsView,
  OrderListResult,
  OrderListRow,
  OrdersSummary,
  StaffMap,
} from "./types";
import type { OrderView, KotView } from "./types";

const TERMINAL_BILL_STATUSES: BillStatus[] = ["CANCELLED", "REFUNDED"];

function toObjectId(id: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

/**
 * Builds a paginated, filtered and sorted list of this restaurant's orders
 * with bill + creator info joined. The payment filter first resolves bill
 * order ids (so it can use the indexed Bill status field) and then constrains
 * the orders themselves — all within the same restaurant's tenant boundary.
 */
export async function listOrders(
  restaurantId: string,
  searchParams: Record<string, OrdersSearchParamValue> = {}
): Promise<OrderListResult> {
  await connectDB();
  const query = parseOrdersSearchParams(searchParams);
  const perPage = ORDERS_PAGE_SIZE;

  const filter: Record<string, unknown> = { restaurantId };

  if (query.type) filter.orderType = query.type;
  if (query.status) filter.status = query.status;
  if (query.table) filter.tableId = toObjectId(query.table);
  if (query.staff) filter.createdBy = toObjectId(query.staff);

  const range = resolveDateRange(query.date, {
    from: query.from ?? undefined,
    to: query.to ?? undefined,
  });
  filter.createdAt = { $gte: range.from, $lt: range.to };

  const search = query.q.trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const or: Array<Record<string, unknown>> = [
      { customerName: { $regex: escaped, $options: "i" } },
      { customerPhone: { $regex: escaped, $options: "i" } },
      { tableNameSnapshot: { $regex: escaped, $options: "i" } },
    ];
    // A numeric query is most likely an exact order number, but phone numbers
    // are numeric too — so match the number OR the textual fields.
    if (/^\d+$/.test(search)) or.unshift({ orderNumber: Number(search) });
    filter.$or = or;
  }

  if (query.payment) {
    const orderIds: mongoose.Types.ObjectId[] = await BillModel.find({
      restaurantId,
      status: query.payment,
    }).distinct("orderId");
    if (orderIds.length === 0) {
      return { rows: [], total: 0, page: 1, perPage, pageCount: 1 };
    }
    filter._id = { $in: orderIds };
  }

  const sort: Record<string, 1 | -1> = {};
  switch (query.sort) {
    case "oldest":
      sort.createdAt = 1;
      sort._id = 1;
      break;
    case "amount_desc":
      sort.totalPaise = -1;
      sort._id = -1;
      break;
    case "amount_asc":
      sort.totalPaise = 1;
      sort._id = 1;
      break;
    case "number":
      sort.orderNumber = -1;
      break;
    default:
      sort.createdAt = -1;
      sort._id = -1;
  }

  const total = await OrderModel.countDocuments(filter);
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, query.page), pageCount);

  const docs = await OrderModel.find(filter)
    .sort(sort)
    .skip((page - 1) * perPage)
    .limit(perPage)
    .lean();

  const rows = await hydrateRows(restaurantId, docs);
  return { rows, total, page, perPage, pageCount };
}

async function hydrateRows(
  restaurantId: string,
  docs: Array<Record<string, unknown>>
): Promise<OrderListRow[]> {
  if (docs.length === 0) return [];
  const orderIds = docs.map((d) => d._id as mongoose.Types.ObjectId);

  const [billDocs, staff] = await Promise.all([
    BillModel.find({
      restaurantId,
      orderId: { $in: orderIds },
      status: { $nin: TERMINAL_BILL_STATUSES },
    }).lean(),
    loadStaffMap(
      restaurantId,
      docs
        .map((d) => d.createdBy)
        .filter((id): id is mongoose.Types.ObjectId => Boolean(id))
        .map((id) => String(id))
    ),
  ]);

  const billByOrder = new Map<string, BillDocument>(
    billDocs.map((b) => [String((b as BillDocument).orderId), b as unknown as BillDocument])
  );

  return docs.map((d) => {
    const doc = d as unknown as OrderDocument;
    const orderId = String(doc._id);
    const bill = billByOrder.get(orderId) ?? null;
    const billStatus = bill ? ((bill.status as BillStatus) ?? null) : null;
    const items = (doc.items ?? []) as Array<{ quantity: number }>;
    const creator = staff[String(doc.createdBy)];

    let amountPaise = doc.totalPaise;
    let paymentStatus: BillStatus | null = null;
    let billId: string | null = null;
    let billNumber: string | null = null;
    let billGrandTotalPaise: number | null = null;
    let paidAt: string | null = doc.paidAt ? String(doc.paidAt) : null;
    if (bill) {
      amountPaise = bill.grandTotalPaise;
      paymentStatus = billStatus;
      billId = String(bill._id);
      billNumber = bill.billNumber;
      billGrandTotalPaise = bill.grandTotalPaise;
      if (String(bill.paidAt)) paidAt = String(bill.paidAt);
    }

    return {
      id: orderId,
      orderNumber: doc.orderNumber,
      orderType: doc.orderType as OrderType,
      status: doc.status as OrderStatus,
      tableId: doc.tableId ? String(doc.tableId) : null,
      tableNameSnapshot: doc.tableNameSnapshot ?? null,
      customerName: doc.customerName ?? null,
      customerPhone: doc.customerPhone ?? null,
      itemsCount: items.reduce((sum, i) => sum + (i.quantity ?? 1), 0),
      amountPaise,
      createdAt: doc.createdAt ? String(doc.createdAt) : "",
      paidAt,
      createdByName: creator?.fullName ?? "Unknown staff",
      paymentStatus,
      billId,
      billNumber,
      billGrandTotalPaise,
    };
  });
}

/**
 * KPI cards: Today's Orders (created today, local day), Today's Sales (paid
 * bills settled today), Unpaid / Paid bill counts, and all-time cancelled
 * orders. Both aggregations are tenant-scoped and index-friendly.
 */
export async function getOrdersSummary(restaurantId: string): Promise<OrdersSummary> {
  await connectDB();
  const range = resolveDateRange("today");
  const rid = toObjectId(restaurantId);

  interface OrdersFacet {
    todayOrders: Array<{ n: number }>;
    cancelledOrders: Array<{ n: number }>;
  }
  interface BillsFacet {
    unpaid: Array<{ n: number }>;
    paid: Array<{ n: number }>;
    todaySalesPaise: Array<{ total: number }>;
  }

  const [ordersFacet, billsFacet] = await Promise.all([
    OrderModel.aggregate<OrdersFacet>([
      { $match: { restaurantId: rid } },
      {
        $facet: {
          todayOrders: [
            { $match: { createdAt: { $gte: range.from, $lt: range.to } } },
            { $count: "n" },
          ],
          cancelledOrders: [
            { $match: { status: "CANCELLED" } },
            { $count: "n" },
          ],
        },
      },
    ]),
    BillModel.aggregate<BillsFacet>([
      { $match: { restaurantId: rid } },
      {
        $facet: {
          unpaid: [
            { $match: { status: { $in: ["UNPAID", "PARTIAL"] } } },
            { $count: "n" },
          ],
          paid: [
            { $match: { status: "PAID" } },
            { $count: "n" },
          ],
          todaySalesPaise: [
            { $match: { status: "PAID", paidAt: { $gte: range.from, $lt: range.to } } },
            { $group: { _id: null, total: { $sum: "$grandTotalPaise" } } },
          ],
        },
      },
    ]),
  ]);

  const ordersDoc = ordersFacet[0];
  const billsDoc = billsFacet[0];

  return {
    todayOrders: ordersDoc?.todayOrders?.[0]?.n ?? 0,
    cancelledOrders: ordersDoc?.cancelledOrders?.[0]?.n ?? 0,
    unpaidBills: billsDoc?.unpaid?.[0]?.n ?? 0,
    paidBills: billsDoc?.paid?.[0]?.n ?? 0,
    todaySalesPaise: billsDoc?.todaySalesPaise?.[0]?.total ?? 0,
  };
}

/** Tenant-scoped single-order fetch. Invalid ids resolve to null. */
export async function getOrderById(
  restaurantId: string,
  orderId: string
): Promise<OrderView | null> {
  if (!isValidObjectId(orderId)) return null;
  const order = await getOrder(restaurantId, orderId);
  return order ? (order as OrderView) : null;
}

async function getOrderDocument(
  restaurantId: string,
  orderId: string
): Promise<OrderDocument | null> {
  await connectDB();
  const doc = await OrderModel.findOne({ _id: orderId, restaurantId }).lean();
  return doc ? (doc as unknown as OrderDocument) : null;
}

/** The order's own KOTs, oldest first, validated against the tenant. */
export async function getOrderKots(
  restaurantId: string,
  orderId: string
): Promise<KotView[]> {
  if (!isValidObjectId(orderId)) return [];
  const order = await getOrderDocument(restaurantId, orderId);
  if (!order) return [];
  return listOrderKots(restaurantId, orderId);
}

/** The order's bill (or null). Uses the billing module's tenant-safe fetch. */
export async function getOrderBill(
  restaurantId: string,
  orderId: string
): Promise<BillView | null> {
  if (!isValidObjectId(orderId)) return null;
  return getBillForOrder(restaurantId, orderId);
}

/** Everything the order details page renders, or null when not found/hidden. */
export async function getOrderDetails(
  restaurantId: string,
  orderId: string
): Promise<OrderDetailsView | null> {
  if (!isValidObjectId(orderId)) return null;
  const orderView = await getOrderById(restaurantId, orderId);
  if (!orderView) return null;

  const [kots, bill] = await Promise.all([
    getOrderKots(restaurantId, orderId),
    getOrderBill(restaurantId, orderId),
  ]);

  const staffIds = new Set<string>([orderView.createdBy]);
  if (orderView.cancelledBy) staffIds.add(orderView.cancelledBy);
  for (const kot of kots) staffIds.add(kot.createdBy);
  if (bill) {
    staffIds.add(bill.createdBy);
    for (const payment of bill.payments) staffIds.add(payment.receivedBy);
  }

  const staff = await loadStaffMap(restaurantId, [...staffIds]);
  return { order: orderView, kots, bill, staff };
}

/** Active tables (for the table filter dropdown). */
export async function listOrderTables(
  restaurantId: string
): Promise<Array<{ id: string; name: string }>> {
  await connectDB();
  const docs = await RestaurantTableModel.find({ restaurantId, isActive: true })
    .sort({ name: 1 })
    .lean();
  return docs.map((d) => ({ id: String(d._id), name: (d as { name: string }).name }));
}

/** Active staff (for the "created by" filter dropdown). */
export async function listOrderStaff(
  restaurantId: string
): Promise<Array<{ id: string; fullName: string; role: Role }>> {
  await connectDB();
  const docs = await UserModel.find({ restaurantId, isActive: true })
    .sort({ fullName: 1 })
    .select("fullName role")
    .lean();
  return docs.map((d) => ({
    id: String(d._id),
    fullName: d.fullName,
    role: d.role as Role,
  }));
}

async function loadStaffMap(
  restaurantId: string,
  ids: string[]
): Promise<StaffMap> {
  if (ids.length === 0) return {};
  const uniqueIds = [...new Set(ids)]
    .filter(isValidObjectId)
    .map(toObjectId);
  if (uniqueIds.length === 0) return {};
  const docs = await UserModel.find({
    restaurantId,
    _id: { $in: uniqueIds },
  })
    .select("fullName role")
    .lean();
  const map: StaffMap = {};
  for (const doc of docs) {
    map[String(doc._id)] = { fullName: doc.fullName, role: doc.role as Role };
  }
  return map;
}