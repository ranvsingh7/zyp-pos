import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { OrderModel } from "@/models/Order";
import { escapeRegExp } from "@/lib/menu/utils";
import type { OrderStatus, OrderType } from "@/lib/orders/constants";
import type { BillPaymentMethod, BillStatus } from "@/lib/billing/constants";
import { REPORT_PAGE_SIZE } from "./constants";
import { loadStaffMap, paginate, resolveReportRange, toObjectId } from "./shared";
import type {
  CancellationReport,
  CancellationRow,
  CategorySalesReport,
  CategorySalesRow,
  DiscountReport,
  DiscountReportRow,
  GstRateRow,
  GstReport,
  ItemSalesReport,
  ItemSalesReportRow,
  OrderReport,
  OrderReportRow,
  PaymentReport,
  PaymentReportRow,
  PaymentMethodTotal,
  ReportQuery,
  SalesReport,
  SalesReportRow,
} from "./types";

const NON_REVENUE = ["CANCELLED", "REFUNDED"];
const CANCELLATION_CAP = 1000;

export function numericSearch(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

export function billSearchClause(q: string): Array<Record<string, unknown>> {
  const rx = { $regex: escapeRegExp(q), $options: "i" };
  const n = numericSearch(q);
  const or: Array<Record<string, unknown>> = [
    { billNumber: rx },
    { customerName: rx },
    { tableNameSnapshot: rx },
  ];
  if (n !== null) or.unshift({ orderNumber: n });
  return or;
}

/* -------------------------------------------------------------------------- */
/* Sales report                                                               */
/* -------------------------------------------------------------------------- */

/** Revenue recognised on fully-paid bills (`paidAt` within the range). */
export async function getSalesReport(
  restaurantId: string,
  query: ReportQuery
): Promise<SalesReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const perPage = REPORT_PAGE_SIZE;

  const match: Record<string, unknown> = {
    restaurantId: rid,
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
  };
  if (query.orderType) match.orderType = query.orderType;
  if (query.q) match.$or = billSearchClause(query.q);

  interface Agg {
    bills: number;
    subtotal: number;
    discount: number;
    taxable: number;
    tax: number;
    serviceCharge: number;
    roundOff: number;
    grandTotal: number;
  }

  const [total, summaryAgg] = await Promise.all([
    BillModel.countDocuments(match),
    BillModel.aggregate<Agg>([
      { $match: match },
      {
        $group: {
          _id: null,
          bills: { $sum: 1 },
          subtotal: { $sum: "$subtotalPaise" },
          discount: { $sum: "$discountPaise" },
          taxable: { $sum: "$taxableAmountPaise" },
          tax: { $sum: "$totalTaxPaise" },
          serviceCharge: { $sum: "$serviceChargeAmountPaise" },
          roundOff: { $sum: "$roundOffAmountPaise" },
          grandTotal: { $sum: "$grandTotalPaise" },
        },
      },
    ]),
  ]);
  const agg = summaryAgg[0];
  const { page, pageCount } = paginate(total, query.page, perPage);

  const docs = await BillModel.find(match)
    .sort({ paidAt: -1, _id: -1 })
    .skip((page - 1) * perPage)
    .limit(perPage)
    .select(
      "_id billNumber orderNumber orderType paidAt tableNameSnapshot customerName subtotalPaise discountPaise taxableAmountPaise cgstAmountPaise sgstAmountPaise igstAmountPaise totalTaxPaise serviceChargeAmountPaise roundOffAmountPaise grandTotalPaise createdBy"
    )
    .lean();
  const staff = await loadStaffMap(
    restaurantId,
    docs.map((d) => String(d.createdBy))
  );

  const rows: SalesReportRow[] = docs.map((d) => ({
    id: String(d._id),
    billNumber: d.billNumber,
    orderNumber: d.orderNumber,
    orderType: d.orderType as OrderType,
    paidAt: d.paidAt ? String(d.paidAt) : "",
    tableNameSnapshot: d.tableNameSnapshot ?? null,
    customerName: d.customerName ?? null,
    subtotalPaise: d.subtotalPaise,
    discountPaise: d.discountPaise ?? 0,
    taxableAmountPaise: d.taxableAmountPaise,
    cgstAmountPaise: d.cgstAmountPaise ?? 0,
    sgstAmountPaise: d.sgstAmountPaise ?? 0,
    igstAmountPaise: d.igstAmountPaise ?? 0,
    totalTaxPaise: d.totalTaxPaise ?? 0,
    serviceChargeAmountPaise: d.serviceChargeAmountPaise ?? 0,
    roundOffAmountPaise: d.roundOffAmountPaise ?? 0,
    grandTotalPaise: d.grandTotalPaise,
    createdByName: staff[String(d.createdBy)]?.fullName ?? "Unknown staff",
  }));

  const summary = {
    bills: agg?.bills ?? 0,
    subtotalPaise: agg?.subtotal ?? 0,
    discountPaise: agg?.discount ?? 0,
    taxableAmountPaise: agg?.taxable ?? 0,
    totalTaxPaise: agg?.tax ?? 0,
    serviceChargeAmountPaise: agg?.serviceCharge ?? 0,
    roundOffAmountPaise: agg?.roundOff ?? 0,
    grandTotalPaise: agg?.grandTotal ?? 0,
    averageBillPaise:
      agg && agg.bills > 0 ? Math.round(agg.grandTotal / agg.bills) : 0,
  };

  return { rows, total, page, perPage, pageCount, range: meta, summary };
}

/* -------------------------------------------------------------------------- */
/* Payments report                                                            */
/* -------------------------------------------------------------------------- */

/** Payments actually collected in the range, counted once per method. */
export async function getPaymentReport(
  restaurantId: string,
  query: ReportQuery
): Promise<PaymentReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const perPage = REPORT_PAGE_SIZE;

  const base: Record<string, unknown> = {
    restaurantId: rid,
    createdAt: { $gte: range.from, $lt: range.to },
  };
  if (query.method) base.method = query.method;
  if (query.q) {
    const billIds = await BillModel.find({
      restaurantId: rid,
      $or: billSearchClause(query.q),
    }).distinct("_id");
    if (billIds.length === 0) {
      return {
        rows: [],
        total: 0,
        page: 1,
        perPage,
        pageCount: 1,
        range: meta,
        summary: { totalCollectedPaise: 0, paymentsCount: 0, byMethod: [] },
      };
    }
    base.billId = { $in: billIds };
  }

  const prefix = [
    { $match: base },
    {
      $lookup: {
        from: "bills",
        localField: "billId",
        foreignField: "_id",
        as: "bill",
      },
    },
    { $match: { "bill.status": { $nin: NON_REVENUE } } },
  ];

  interface SummaryAgg {
    total: number;
    n: number;
  }

  const [countAgg, summaryAgg, methodAgg] = await Promise.all([
    PaymentModel.aggregate<{ n: number }>([...prefix, { $count: "n" }]),
    PaymentModel.aggregate<SummaryAgg>([
      ...prefix,
      { $group: { _id: null, total: { $sum: "$amountPaise" }, n: { $sum: 1 } } },
    ]),
    PaymentModel.aggregate<{ _id: BillPaymentMethod; amount: number; count: number }>([
      ...prefix,
      {
        $group: {
          _id: "$method",
          amount: { $sum: "$amountPaise" },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]),
  ]);

  const total = countAgg[0]?.n ?? 0;
  const { page, pageCount } = paginate(total, query.page, perPage);

  const docs = await PaymentModel.aggregate<{
    _id: mongoose.Types.ObjectId;
    method: BillPaymentMethod;
    amountPaise: number;
    referenceNumber: string | null;
    createdAt: Date;
    receivedBy: mongoose.Types.ObjectId;
    billNumber: string;
    orderNumber: number;
    orderType: OrderType;
    customerName: string | null;
  }>([
    ...prefix,
    { $sort: { createdAt: -1, _id: -1 } },
    { $skip: (page - 1) * perPage },
    { $limit: perPage },
    {
      $project: {
        method: 1,
        amountPaise: 1,
        referenceNumber: 1,
        createdAt: 1,
        receivedBy: 1,
        billNumber: { $arrayElemAt: ["$bill.billNumber", 0] },
        orderNumber: { $arrayElemAt: ["$bill.orderNumber", 0] },
        orderType: { $arrayElemAt: ["$bill.orderType", 0] },
        customerName: { $arrayElemAt: ["$bill.customerName", 0] },
      },
    },
  ]);

  const staff = await loadStaffMap(
    restaurantId,
    docs.map((d) => String(d.receivedBy))
  );

  const rows: PaymentReportRow[] = docs.map((d) => ({
    id: String(d._id),
    createdAt: String(d.createdAt),
    method: d.method,
    amountPaise: d.amountPaise,
    referenceNumber: d.referenceNumber ?? null,
    billNumber: d.billNumber ?? "—",
    orderNumber: d.orderNumber ?? 0,
    orderType: (d.orderType as OrderType) ?? "QUICK_SALE",
    customerName: d.customerName ?? null,
    receivedByName: staff[String(d.receivedBy)]?.fullName ?? "Unknown staff",
  }));

  const byMethod: PaymentMethodTotal[] = methodAgg.map((m) => ({
    method: m._id,
    amountPaise: m.amount,
    count: m.count,
  }));

  return {
    rows,
    total,
    page,
    perPage,
    pageCount,
    range: meta,
    summary: {
      totalCollectedPaise: summaryAgg[0]?.total ?? 0,
      paymentsCount: summaryAgg[0]?.n ?? 0,
      byMethod,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Orders report                                                              */
/* -------------------------------------------------------------------------- */

/** All orders created in the range (any status), with bill/payment status. */
export async function getOrderReport(
  restaurantId: string,
  query: ReportQuery
): Promise<OrderReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const perPage = REPORT_PAGE_SIZE;

  const match: Record<string, unknown> = {
    restaurantId: rid,
    createdAt: { $gte: range.from, $lt: range.to },
  };
  if (query.orderType) match.orderType = query.orderType;
  if (query.status) match.status = query.status;
  if (query.q) {
    const rx = { $regex: escapeRegExp(query.q), $options: "i" };
    const n = numericSearch(query.q);
    const or: Array<Record<string, unknown>> = [
      { customerName: rx },
      { customerPhone: rx },
      { tableNameSnapshot: rx },
    ];
    if (n !== null) or.unshift({ orderNumber: n });
    match.$or = or;
  }

  const [total, byTypeAgg, byStatusAgg] = await Promise.all([
    OrderModel.countDocuments(match),
    OrderModel.aggregate<{ _id: OrderType; orders: number; total: number }>([
      { $match: match },
      {
        $group: {
          _id: "$orderType",
          orders: { $sum: 1 },
          total: { $sum: "$totalPaise" },
        },
      },
      { $sort: { orders: -1 } },
    ]),
    OrderModel.aggregate<{ _id: OrderStatus; orders: number }>([
      { $match: match },
      { $group: { _id: "$status", orders: { $sum: 1 } } },
      { $sort: { orders: -1 } },
    ]),
  ]);

  const { page, pageCount } = paginate(total, query.page, perPage);
  const docs = await OrderModel.find(match)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * perPage)
    .limit(perPage)
    .select(
      "_id orderNumber createdAt orderType status tableNameSnapshot customerName items totalPaise createdBy"
    )
    .lean();

  const orderIds = docs.map((d) => d._id);
  const [bills, staff] = await Promise.all([
    BillModel.find({ restaurantId: rid, orderId: { $in: orderIds } })
      .select("orderId status grandTotalPaise")
      .lean(),
    loadStaffMap(
      restaurantId,
      docs.map((d) => String(d.createdBy))
    ),
  ]);
  const billByOrder = new Map(bills.map((b) => [String(b.orderId), b]));

  const rows: OrderReportRow[] = docs.map((d) => {
    const items = (d.items ?? []) as Array<{ quantity: number }>;
    const bill = billByOrder.get(String(d._id));
    return {
      id: String(d._id),
      orderNumber: d.orderNumber,
      createdAt: d.createdAt ? String(d.createdAt) : "",
      orderType: d.orderType as OrderType,
      status: d.status as OrderStatus,
      tableNameSnapshot: d.tableNameSnapshot ?? null,
      customerName: d.customerName ?? null,
      itemsCount: items.reduce((sum, i) => sum + (i.quantity ?? 1), 0),
      totalPaise: (bill?.grandTotalPaise as number | undefined) ?? d.totalPaise,
      billStatus: bill ? ((bill.status as BillStatus) ?? null) : null,
      createdByName: staff[String(d.createdBy)]?.fullName ?? "Unknown staff",
    };
  });

  const totalValue = byTypeAgg.reduce((sum, t) => sum + t.total, 0);
  const cancelled = byStatusAgg.find((s) => s._id === "CANCELLED")?.orders ?? 0;

  return {
    rows,
    total,
    page,
    perPage,
    pageCount,
    range: meta,
    summary: {
      orders: total,
      cancelled,
      totalPaise: totalValue,
      byType: byTypeAgg.map((t) => ({
        orderType: t._id,
        orders: t.orders,
        totalPaise: t.total,
      })),
      byStatus: byStatusAgg.map((s) => ({ status: s._id, orders: s.orders })),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Item sales report                                                          */
/* -------------------------------------------------------------------------- */

export async function getItemSalesReport(
  restaurantId: string,
  query: ReportQuery
): Promise<ItemSalesReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const perPage = REPORT_PAGE_SIZE;

  const start: mongoose.PipelineStage[] = [
    {
      $match: {
        restaurantId: rid,
        status: "PAID",
        paidAt: { $gte: range.from, $lt: range.to },
      },
    },
    { $unwind: "$items" },
  ];
  if (query.q) {
    start.push({
      $match: {
        "items.nameSnapshot": { $regex: escapeRegExp(query.q), $options: "i" },
      },
    });
  }

  interface RowAgg {
    _id: {
      menuItemId: mongoose.Types.ObjectId;
      name: string;
      variantName: string | null;
    };
    quantity: number;
    sales: number;
    categoryName: string | null;
  }

  const grouped: mongoose.PipelineStage[] = [
    ...start,
    {
      $group: {
        _id: {
          menuItemId: "$items.menuItemId",
          name: "$items.nameSnapshot",
          variantName: "$items.variantNameSnapshot",
        },
        quantity: { $sum: "$items.quantity" },
        sales: { $sum: "$items.lineTotalPaise" },
      },
    },
  ];

  const [countAgg, summaryAgg] = await Promise.all([
    BillModel.aggregate<{ n: number }>([...grouped, { $count: "n" }]),
    BillModel.aggregate<{ quantity: number; sales: number; distinctItems: number }>([
      ...grouped,
      {
        $group: {
          _id: null,
          quantity: { $sum: "$quantity" },
          sales: { $sum: "$sales" },
          distinctItems: { $sum: 1 },
        },
      },
    ]),
  ]);

  const total = countAgg[0]?.n ?? 0;
  const { page, pageCount } = paginate(total, query.page, perPage);

  const rowDocs = await BillModel.aggregate<RowAgg>([
    ...grouped,
    {
      $lookup: {
        from: "menuitems",
        localField: "_id.menuItemId",
        foreignField: "_id",
        as: "mi",
      },
    },
    { $unwind: { path: "$mi", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "menucategories",
        localField: "mi.categoryId",
        foreignField: "_id",
        as: "cat",
      },
    },
    { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
    { $sort: { quantity: -1, sales: -1 } },
    { $skip: (page - 1) * perPage },
    { $limit: perPage },
    { $project: { _id: 1, quantity: 1, sales: 1, categoryName: "$cat.name" } },
  ]);

  const rows: ItemSalesReportRow[] = rowDocs.map((r) => ({
    menuItemId: String(r._id.menuItemId),
    name: r._id.name,
    variantName: r._id.variantName ?? null,
    categoryName: r.categoryName ?? null,
    quantity: r.quantity,
    salesPaise: r.sales,
  }));

  return {
    rows,
    total,
    page,
    perPage,
    pageCount,
    range: meta,
    summary: {
      quantity: summaryAgg[0]?.quantity ?? 0,
      salesPaise: summaryAgg[0]?.sales ?? 0,
      distinctItems: summaryAgg[0]?.distinctItems ?? 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Category sales report                                                      */
/* -------------------------------------------------------------------------- */

export async function getCategorySalesReport(
  restaurantId: string,
  query: ReportQuery
): Promise<CategorySalesReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);

  interface CatAgg {
    _id: { id: mongoose.Types.ObjectId | null; name: string | null };
    quantity: number;
    sales: number;
  }

  const agg = await BillModel.aggregate<CatAgg>([
    {
      $match: {
        restaurantId: rid,
        status: "PAID",
        paidAt: { $gte: range.from, $lt: range.to },
      },
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.menuItemId",
        quantity: { $sum: "$items.quantity" },
        sales: { $sum: "$items.lineTotalPaise" },
      },
    },
    {
      $lookup: {
        from: "menuitems",
        localField: "_id",
        foreignField: "_id",
        as: "mi",
      },
    },
    { $unwind: { path: "$mi", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "menucategories",
        localField: "mi.categoryId",
        foreignField: "_id",
        as: "cat",
      },
    },
    { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { id: "$mi.categoryId", name: "$cat.name" },
        quantity: { $sum: "$quantity" },
        sales: { $sum: "$sales" },
      },
    },
    { $sort: { sales: -1 } },
  ]);

  const rows: CategorySalesRow[] = agg.map((r) => ({
    categoryId: r._id.id ? String(r._id.id) : null,
    categoryName: r._id.name ?? "Uncategorised",
    quantity: r.quantity,
    salesPaise: r.sales,
  }));

  return {
    rows,
    range: meta,
    summary: {
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      salesPaise: rows.reduce((s, r) => s + r.salesPaise, 0),
      categories: rows.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* GST report                                                                 */
/* -------------------------------------------------------------------------- */

/** Tax breakup per rate/scheme from the bill snapshots in the range. */
export async function getGSTReport(
  restaurantId: string,
  query: ReportQuery
): Promise<GstReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const match = {
    restaurantId: rid,
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
  };

  interface GstAgg {
    _id: { rate: number; scheme: string };
    taxableAmountPaise: number;
    cgstAmountPaise: number;
    sgstAmountPaise: number;
    igstAmountPaise: number;
    totalTaxPaise: number;
    bills: number;
  }

  const [agg, summaryAgg] = await Promise.all([
    BillModel.aggregate<GstAgg>([
      { $match: match },
      {
        $group: {
          _id: { rate: "$taxRatePercent", scheme: "$gstScheme" },
          taxableAmountPaise: { $sum: "$taxableAmountPaise" },
          cgstAmountPaise: { $sum: "$cgstAmountPaise" },
          sgstAmountPaise: { $sum: "$sgstAmountPaise" },
          igstAmountPaise: { $sum: "$igstAmountPaise" },
          totalTaxPaise: { $sum: "$totalTaxPaise" },
          bills: { $sum: 1 },
        },
      },
      { $sort: { "_id.rate": 1 } },
    ]),
    BillModel.aggregate<{
      taxable: number;
      cgst: number;
      sgst: number;
      igst: number;
      tax: number;
      gross: number;
      bills: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          taxable: { $sum: "$taxableAmountPaise" },
          cgst: { $sum: "$cgstAmountPaise" },
          sgst: { $sum: "$sgstAmountPaise" },
          igst: { $sum: "$igstAmountPaise" },
          tax: { $sum: "$totalTaxPaise" },
          gross: { $sum: "$grandTotalPaise" },
          bills: { $sum: 1 },
        },
      },
    ]),
  ]);

  const rows: GstRateRow[] = agg.map((r) => ({
    taxRatePercent: r._id.rate ?? 0,
    gstScheme: r._id.scheme ?? "INTRA_STATE",
    taxableAmountPaise: r.taxableAmountPaise,
    cgstAmountPaise: r.cgstAmountPaise,
    sgstAmountPaise: r.sgstAmountPaise,
    igstAmountPaise: r.igstAmountPaise,
    totalTaxPaise: r.totalTaxPaise,
    bills: r.bills,
  }));

  const s = summaryAgg[0];
  return {
    rows,
    range: meta,
    summary: {
      taxableAmountPaise: s?.taxable ?? 0,
      cgstAmountPaise: s?.cgst ?? 0,
      sgstAmountPaise: s?.sgst ?? 0,
      igstAmountPaise: s?.igst ?? 0,
      totalTaxPaise: s?.tax ?? 0,
      grossSalesPaise: s?.gross ?? 0,
      bills: s?.bills ?? 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Discount report                                                            */
/* -------------------------------------------------------------------------- */

export async function getDiscountReport(
  restaurantId: string,
  query: ReportQuery
): Promise<DiscountReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const perPage = REPORT_PAGE_SIZE;

  const match: Record<string, unknown> = {
    restaurantId: rid,
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
    discountPaise: { $gt: 0 },
  };
  if (query.q) match.$or = billSearchClause(query.q);

  const [total, summaryAgg] = await Promise.all([
    BillModel.countDocuments(match),
    BillModel.aggregate<{
      bills: number;
      discount: number;
      gross: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          bills: { $sum: 1 },
          discount: { $sum: "$discountPaise" },
          gross: { $sum: "$subtotalPaise" },
        },
      },
    ]),
  ]);
  const { page, pageCount } = paginate(total, query.page, perPage);
  const docs = await BillModel.find(match)
    .sort({ paidAt: -1, _id: -1 })
    .skip((page - 1) * perPage)
    .limit(perPage)
    .select(
      "_id billNumber orderNumber paidAt customerName subtotalPaise discountPaise grandTotalPaise createdBy"
    )
    .lean();
  const staff = await loadStaffMap(
    restaurantId,
    docs.map((d) => String(d.createdBy))
  );

  const rows: DiscountReportRow[] = docs.map((d) => ({
    id: String(d._id),
    billNumber: d.billNumber,
    orderNumber: d.orderNumber,
    paidAt: d.paidAt ? String(d.paidAt) : "",
    customerName: d.customerName ?? null,
    subtotalPaise: d.subtotalPaise,
    discountPaise: d.discountPaise ?? 0,
    grandTotalPaise: d.grandTotalPaise,
    createdByName: staff[String(d.createdBy)]?.fullName ?? "Unknown staff",
  }));

  const gross = summaryAgg[0]?.gross ?? 0;
  const discount = summaryAgg[0]?.discount ?? 0;
  return {
    rows,
    total,
    page,
    perPage,
    pageCount,
    range: meta,
    summary: {
      discountedBills: summaryAgg[0]?.bills ?? 0,
      totalDiscountPaise: discount,
      grossBeforeDiscountPaise: gross,
      discountPercent: gross > 0 ? (discount / gross) * 100 : 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cancellation report                                                        */
/* -------------------------------------------------------------------------- */

/** Cancelled orders and cancelled bills in the range, newest first. */
export async function getCancellationReport(
  restaurantId: string,
  query: ReportQuery
): Promise<CancellationReport> {
  await connectDB();
  const { range, meta } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const perPage = REPORT_PAGE_SIZE;
  const timeMatch = { $gte: range.from, $lt: range.to };

  const [orderDocs, billDocs, orderCount, billCount, orderSum, billSum] =
    await Promise.all([
      OrderModel.find({
        restaurantId: rid,
        status: "CANCELLED",
        cancelledAt: timeMatch,
      })
        .sort({ cancelledAt: -1 })
        .limit(CANCELLATION_CAP)
        .select(
          "_id orderNumber orderType cancelledAt totalPaise cancellationReason cancelledBy"
        )
        .lean(),
      BillModel.find({
        restaurantId: rid,
        status: "CANCELLED",
        cancelledAt: timeMatch,
      })
        .sort({ cancelledAt: -1 })
        .limit(CANCELLATION_CAP)
        .select(
          "_id billNumber orderNumber cancelledAt grandTotalPaise cancellationReason cancelledBy"
        )
        .lean(),
      OrderModel.countDocuments({
        restaurantId: rid,
        status: "CANCELLED",
        cancelledAt: timeMatch,
      }),
      BillModel.countDocuments({
        restaurantId: rid,
        status: "CANCELLED",
        cancelledAt: timeMatch,
      }),
      OrderModel.aggregate<{ total: number }>([
        { $match: { restaurantId: rid, status: "CANCELLED", cancelledAt: timeMatch } },
        { $group: { _id: null, total: { $sum: "$totalPaise" } } },
      ]),
      BillModel.aggregate<{ total: number }>([
        { $match: { restaurantId: rid, status: "CANCELLED", cancelledAt: timeMatch } },
        { $group: { _id: null, total: { $sum: "$grandTotalPaise" } } },
      ]),
    ]);

  const staff = await loadStaffMap(restaurantId, [
    ...orderDocs.map((d) => String(d.cancelledBy ?? "")),
    ...billDocs.map((d) => String(d.cancelledBy ?? "")),
  ]);

  const rows: CancellationRow[] = [
    ...orderDocs.map<CancellationRow>((d) => ({
      kind: "ORDER",
      id: String(d._id),
      reference: `#${d.orderNumber}`,
      orderType: d.orderType as OrderType,
      cancelledAt: d.cancelledAt ? String(d.cancelledAt) : "",
      amountPaise: d.totalPaise,
      reason: d.cancellationReason ?? null,
      byName: staff[String(d.cancelledBy ?? "")]?.fullName ?? "Unknown staff",
    })),
    ...billDocs.map<CancellationRow>((d) => ({
      kind: "BILL",
      id: String(d._id),
      reference: d.billNumber,
      orderNumber: d.orderNumber,
      cancelledAt: d.cancelledAt ? String(d.cancelledAt) : "",
      amountPaise: d.grandTotalPaise,
      reason: d.cancellationReason ?? null,
      byName: staff[String(d.cancelledBy ?? "")]?.fullName ?? "Unknown staff",
    })),
  ].sort((a, b) => (a.cancelledAt < b.cancelledAt ? 1 : -1));

  const total = orderCount + billCount;
  const { page, pageCount } = paginate(total, query.page, perPage);
  const pageRows = rows.slice((page - 1) * perPage, page * perPage);

  return {
    rows: pageRows,
    total,
    page,
    perPage,
    pageCount,
    range: meta,
    summary: {
      cancelledOrders: orderCount,
      cancelledBills: billCount,
      cancelledValuePaise: (orderSum[0]?.total ?? 0) + (billSum[0]?.total ?? 0),
    },
  };
}
