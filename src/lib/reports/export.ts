import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { BillModel } from "@/models/Bill";
import { OrderModel } from "@/models/Order";
import { PaymentModel } from "@/models/Payment";
import { UserModel } from "@/models/User";
import { formatDateTime, formatShortDate } from "@/lib/orders/format";
import {
  BILL_PAYMENT_METHOD_LABELS,
  BILL_STATUS_LABELS,
  GST_SCHEME_LABELS as GST_SCHEME_LABELS_MAP,
} from "@/lib/billing/constants";
import { ORDER_STATUS_LABELS, orderTypeLabel } from "@/lib/orders/constants";
import { escapeRegExp } from "@/lib/menu/utils";
import type { ReportQuery } from "./types";
import {
  billSearchClause,
  getCategorySalesReport,
  getGSTReport,
  numericSearch,
} from "./report-service";
import { resolveReportRange, toObjectId } from "./shared";
import { csvLine, paiseToCsvRupees, type CsvCell } from "./csv";

export interface ExportResult {
  filename: string;
  contentType: string;
  /** CSV body streamed straight from the database cursor — the browser never
   * receives an already-materialized collection. */
  stream: ReadableStream<Uint8Array>;
}

/**
 * Hard cap on exported rows. Streaming keeps memory flat regardless of the
 * collection size, but this stops a single runaway report from producing an
 * absurd file. Rows beyond the cap are dropped (a courtesy guard, not a path
 * the UI should rely on).
 */
const EXPORT_MAX_ROWS = 100_000;

const NON_REVENUE = ["CANCELLED", "REFUNDED"];
const CANCELLATION_CAP = 1000;

const encoder = new TextEncoder();

function r(v: number): string {
  return paiseToCsvRupees(v);
}

function cell(value: Date | null | undefined): string {
  return value ? String(value) : "";
}

/** Turns a lazily-produced row iterator into a fetch-and-forget response body. */
function toStream(
  headers: string[],
  rows: AsyncIterable<CsvCell[]>
): ReadableStream<Uint8Array> {
  const transform = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transform.writable.getWriter();
  (async () => {
    let count = 0;
    try {
      await writer.write(encoder.encode(`${csvLine(headers)}\r\n`));
      for await (const row of rows) {
        if (count >= EXPORT_MAX_ROWS) break;
        count += 1;
        await writer.write(encoder.encode(`${csvLine(row)}\r\n`));
      }
    } catch (err) {
      try {
        await writer.abort(err);
      } catch {
        // client already closed the connection — nothing to abort
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // already closed/aborted
      }
    }
  })();
  return transform.readable;
}

async function* iterate<T>(cursor: AsyncIterable<T> | Iterable<T>): AsyncGenerator<T> {
  yield* cursor;
}

/** Tiny tenant staff table (dozens of rows max) resolved once per export. */
async function loadTenantStaffMap(
  restaurantId: string
): Promise<Record<string, string>> {
  const docs = await UserModel.find({ restaurantId })
    .select("_id fullName")
    .lean();
  const map: Record<string, string> = {};
  for (const doc of docs) {
    map[String(doc._id)] = doc.fullName ?? "";
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Streamed tabs — data proportional to business activity.                    */
/* Each row is pulled one at a time from a MongoDB cursor and written to the  */
/* response, so memory usage never scales with the collection size.           */
/* -------------------------------------------------------------------------- */

interface SalesDoc {
  billNumber?: string | null;
  orderNumber?: number | null;
  orderType?: string | null;
  paidAt?: Date | null;
  tableNameSnapshot?: string | null;
  customerName?: string | null;
  subtotalPaise?: number;
  discountPaise?: number;
  taxableAmountPaise?: number;
  totalTaxPaise?: number;
  serviceChargeAmountPaise?: number;
  roundOffAmountPaise?: number;
  grandTotalPaise?: number;
  createdBy?: string | null;
}

async function streamSales(
  restaurantId: string,
  query: ReportQuery
): Promise<{ headers: string[]; rows: AsyncIterable<CsvCell[]> }> {
  const { range } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const match: Record<string, unknown> = {
    restaurantId: rid,
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
  };
  if (query.orderType) match.orderType = query.orderType;
  if (query.q) match.$or = billSearchClause(query.q);

  const staff = await loadTenantStaffMap(restaurantId);
  const cursor = BillModel.find(match)
    .sort({ paidAt: -1, _id: -1 })
    .select(
      "billNumber orderNumber orderType paidAt tableNameSnapshot customerName subtotalPaise discountPaise taxableAmountPaise totalTaxPaise serviceChargeAmountPaise roundOffAmountPaise grandTotalPaise createdBy"
    )
    .lean()
    .cursor();

  async function* rows(): AsyncGenerator<CsvCell[]> {
    for await (const d of iterate(cursor as unknown as AsyncIterable<SalesDoc>)) {
      yield [
        d.billNumber ?? "",
        formatShortDate(cell(d.paidAt)),
        d.orderNumber ?? "",
        orderTypeLabel[d.orderType as keyof typeof orderTypeLabel] ?? d.orderType ?? "",
        d.tableNameSnapshot ?? "",
        d.customerName ?? "",
        r(d.subtotalPaise ?? 0),
        r(d.discountPaise ?? 0),
        r(d.totalTaxPaise ?? 0),
        r(d.serviceChargeAmountPaise ?? 0),
        r(d.roundOffAmountPaise ?? 0),
        r(d.grandTotalPaise ?? 0),
        staff[String(d.createdBy ?? "")] ?? "Unknown staff",
      ];
    }
  }

  return {
    headers: [
      "Bill", "Paid on", "Order", "Type", "Table", "Customer",
      "Subtotal (INR)", "Discount (INR)", "Tax (INR)", "Service charge (INR)",
      "Round-off (INR)", "Total (INR)", "Created by",
    ],
    rows: rows(),
  };
}

interface PaymentRow {
  method?: string | null;
  amountPaise?: number;
  referenceNumber?: string | null;
  createdAt?: Date | null;
  receivedBy?: string | null;
  billNumber?: string | null;
  orderNumber?: number | null;
  orderType?: string | null;
  customerName?: string | null;
}

async function streamPayments(
  restaurantId: string,
  query: ReportQuery
): Promise<{ headers: string[]; rows: AsyncIterable<CsvCell[]> }> {
  const { range } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const base: Record<string, unknown> = {
    restaurantId: rid,
    createdAt: { $gte: range.from, $lt: range.to },
  };
  if (query.method) base.method = query.method;
  if (query.q) {
    const rx = { $regex: escapeRegExp(query.q), $options: "i" };
    const n = numericSearch(query.q);
    const or: Array<Record<string, unknown>> = [
      { billNumber: rx },
      { customerName: rx },
    ];
    if (n !== null) or.unshift({ orderNumber: n });
    const billIds = await BillModel.find({
      restaurantId: rid,
      $or: or,
    }).distinct("_id");
    if (billIds.length === 0) {
      return {
        headers: [
          "Received on", "Method", "Amount (INR)", "Reference",
          "Bill", "Order", "Customer", "Received by",
        ],
        rows: iterate<CsvCell[]>([] as CsvCell[][]),
      };
    }
    base.billId = { $in: billIds };
  }

  const staff = await loadTenantStaffMap(restaurantId);
  const cursor = PaymentModel.aggregate<PaymentRow>([
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
    { $sort: { createdAt: -1, _id: -1 } },
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
  ]).cursor();

  async function* rows(): AsyncGenerator<CsvCell[]> {
    for await (const d of iterate(cursor as unknown as AsyncIterable<PaymentRow>)) {
      yield [
        formatDateTime(cell(d.createdAt)),
        BILL_PAYMENT_METHOD_LABELS[
          d.method as keyof typeof BILL_PAYMENT_METHOD_LABELS
        ] ?? d.method ?? "",
        r(d.amountPaise ?? 0),
        d.referenceNumber ?? "",
        d.billNumber ?? "—",
        d.orderNumber ?? "",
        d.customerName ?? "",
        staff[String(d.receivedBy ?? "")] ?? "Unknown staff",
      ];
    }
  }

  return {
    headers: [
      "Received on", "Method", "Amount (INR)", "Reference",
      "Bill", "Order", "Customer", "Received by",
    ],
    rows: rows(),
  };
}

interface OrderRow {
  orderNumber?: number | null;
  createdAt?: Date | null;
  orderType?: string | null;
  status?: string | null;
  tableNameSnapshot?: string | null;
  customerName?: string | null;
  items?: Array<{ quantity?: number }> | null;
  totalPaise?: number;
  createdBy?: string | null;
  billStatus?: string | null;
  billTotal?: number | null;
}

async function streamOrders(
  restaurantId: string,
  query: ReportQuery
): Promise<{ headers: string[]; rows: AsyncIterable<CsvCell[]> }> {
  const { range } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
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

  const staff = await loadTenantStaffMap(restaurantId);
  const cursor = OrderModel.aggregate<OrderRow>([
    { $match: match },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $lookup: {
        from: "bills",
        localField: "_id",
        foreignField: "orderId",
        as: "bill",
      },
    },
    {
      $project: {
        orderNumber: 1,
        createdAt: 1,
        orderType: 1,
        status: 1,
        tableNameSnapshot: 1,
        customerName: 1,
        items: 1,
        totalPaise: 1,
        createdBy: 1,
        billStatus: { $arrayElemAt: ["$bill.status", 0] },
        billTotal: { $arrayElemAt: ["$bill.grandTotalPaise", 0] },
      },
    },
  ]).cursor();

  async function* rows(): AsyncGenerator<CsvCell[]> {
    for await (const d of iterate(cursor as unknown as AsyncIterable<OrderRow>)) {
      const items = d.items ?? [];
      const itemsCount = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);
      yield [
        d.orderNumber ?? "",
        formatShortDate(cell(d.createdAt)),
        orderTypeLabel[d.orderType as keyof typeof orderTypeLabel] ?? d.orderType ?? "",
        ORDER_STATUS_LABELS[d.status as keyof typeof ORDER_STATUS_LABELS] ?? d.status ?? "",
        d.tableNameSnapshot ?? "",
        d.customerName ?? "",
        itemsCount,
        r(d.billTotal ?? d.totalPaise ?? 0),
        d.billStatus
          ? (BILL_STATUS_LABELS[d.billStatus as keyof typeof BILL_STATUS_LABELS] ?? "")
          : "",
        staff[String(d.createdBy ?? "")] ?? "Unknown staff",
      ];
    }
  }

  return {
    headers: [
      "Order", "Created on", "Type", "Status", "Table", "Customer",
      "Items", "Total (INR)", "Billed", "Created by",
    ],
    rows: rows(),
  };
}

interface DiscountDoc {
  billNumber?: string | null;
  orderNumber?: number | null;
  paidAt?: Date | null;
  customerName?: string | null;
  subtotalPaise?: number;
  discountPaise?: number;
  grandTotalPaise?: number;
  createdBy?: string | null;
}

async function streamDiscounts(
  restaurantId: string,
  query: ReportQuery
): Promise<{ headers: string[]; rows: AsyncIterable<CsvCell[]> }> {
  const { range } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const match: Record<string, unknown> = {
    restaurantId: rid,
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
    discountPaise: { $gt: 0 },
  };
  if (query.q) match.$or = billSearchClause(query.q);

  const staff = await loadTenantStaffMap(restaurantId);
  const cursor = BillModel.find(match)
    .sort({ paidAt: -1, _id: -1 })
    .select(
      "billNumber orderNumber paidAt customerName subtotalPaise discountPaise grandTotalPaise createdBy"
    )
    .lean()
    .cursor();

  async function* rows(): AsyncGenerator<CsvCell[]> {
    for await (const d of iterate(cursor as unknown as AsyncIterable<DiscountDoc>)) {
      yield [
        d.billNumber ?? "",
        formatShortDate(cell(d.paidAt)),
        d.customerName ?? "",
        r(d.subtotalPaise ?? 0),
        r(d.discountPaise ?? 0),
        r(d.grandTotalPaise ?? 0),
        staff[String(d.createdBy ?? "")] ?? "Unknown staff",
      ];
    }
  }

  return {
    headers: [
      "Bill", "Paid on", "Customer", "Subtotal (INR)", "Discount (INR)",
      "Total (INR)", "Created by",
    ],
    rows: rows(),
  };
}

/* -------------------------------------------------------------------------- */
/* Bounded tabs — output is proportional to catalog/tax-rate size, or is      */
/* hard-capped, so buffering them is safe.                                  */
/* -------------------------------------------------------------------------- */

function fromBuffer(headers: string[], rows: CsvCell[][]): { headers: string[]; rows: AsyncIterable<CsvCell[]> } {
  async function* g(): AsyncGenerator<CsvCell[]> {
    for (const row of rows) yield row;
  }
  return { headers, rows: g() };
}

async function bufferItems(
  restaurantId: string,
  query: ReportQuery
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const { range } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const start: Record<string, unknown> = {
    restaurantId: rid,
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
  };
  interface ItemRow {
    _id: { menuItemId?: unknown; name?: string; variantName?: string | null; hsnSacCode?: string | null };
    quantity: number;
    sales: number;
    categoryName?: string | null;
  }
  const grouped: mongoose.PipelineStage[] = [
    { $match: start },
    { $unwind: "$items" },
    ...(query.q
      ? [
          {
            $match: {
              "items.nameSnapshot": {
                $regex: escapeRegExp(query.q),
                $options: "i",
              },
            },
          },
        ]
      : []),
    {
      $group: {
        _id: {
          menuItemId: "$items.menuItemId",
          name: "$items.nameSnapshot",
          variantName: "$items.variantNameSnapshot",
          // Grouped by the BILL's snapshot code, so a menu edit splits history
          // into separate rows rather than relabelling past sales.
          hsnSacCode: "$items.hsnSacCode",
        },
        quantity: { $sum: "$items.quantity" },
        sales: { $sum: "$items.lineTotalPaise" },
      },
    },
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
    { $project: { quantity: 1, sales: 1, categoryName: "$cat.name" } },
  ];
  const docs = await BillModel.aggregate<ItemRow>(grouped);
  const rows: CsvCell[][] = docs.map((d) => [
    d._id.name ?? "",
    d._id.variantName ?? "",
    d.categoryName ?? "",
    // Blank (not a placeholder) when the sold line had no code.
    d._id.hsnSacCode ?? "",
    d.quantity,
    r(d.sales),
  ]);
  return {
    headers: ["Item", "Variant", "Category", "HSN/SAC", "Qty", "Sales (INR)"],
    rows,
  };
}

async function bufferCancellations(
  restaurantId: string,
  query: ReportQuery
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const { range } = resolveReportRange(query);
  const rid = toObjectId(restaurantId);
  const timeMatch = { $gte: range.from, $lt: range.to };

  const [orderDocs, billDocs] = await Promise.all([
    OrderModel.find({ restaurantId: rid, status: "CANCELLED", cancelledAt: timeMatch })
      .sort({ cancelledAt: -1 })
      .limit(CANCELLATION_CAP)
      .select("_id orderNumber orderType cancelledAt totalPaise cancellationReason cancelledBy")
      .lean(),
    BillModel.find({ restaurantId: rid, status: "CANCELLED", cancelledAt: timeMatch })
      .sort({ cancelledAt: -1 })
      .limit(CANCELLATION_CAP)
      .select("_id billNumber orderNumber cancelledAt grandTotalPaise cancellationReason cancelledBy")
      .lean(),
  ]);

  interface Cancellation {
    kind: "ORDER" | "BILL";
    reference: string;
    cancelledAt: string;
    orderType?: string;
    orderNumber?: number;
    amountPaise: number;
    reason?: string | null;
    by: string;
  }

  const staff = await loadTenantStaffMap(restaurantId);
  const merged: Cancellation[] = [
    ...orderDocs.map<Cancellation>((d) => ({
      kind: "ORDER" as const,
      reference: `#${d.orderNumber}`,
      cancelledAt: d.cancelledAt ? String(d.cancelledAt) : "",
      orderType: d.orderType as string,
      amountPaise: d.totalPaise,
      reason: d.cancellationReason ?? null,
      by: staff[String(d.cancelledBy ?? "")] ?? "Unknown staff",
    })),
    ...billDocs.map<Cancellation>((d) => ({
      kind: "BILL" as const,
      reference: d.billNumber,
      orderNumber: d.orderNumber as number,
      cancelledAt: d.cancelledAt ? String(d.cancelledAt) : "",
      amountPaise: d.grandTotalPaise,
      reason: d.cancellationReason ?? null,
      by: staff[String(d.cancelledBy ?? "")] ?? "Unknown staff",
    })),
  ].sort((a, b) => (a.cancelledAt < b.cancelledAt ? 1 : -1));

  const rows: CsvCell[][] = merged.map((row) => [
    row.kind === "ORDER" ? "Order" : "Bill",
    row.reference,
    formatDateTime(row.cancelledAt),
    row.kind === "ORDER"
      ? (orderTypeLabel[row.orderType as keyof typeof orderTypeLabel] ?? "")
      : `order #${row.orderNumber}`,
    r(row.amountPaise),
    row.reason ?? "",
    row.by,
  ]);
  return {
    headers: [
      "Type", "Reference", "Cancelled on", "Order type",
      "Amount (INR)", "Reason", "Cancelled by",
    ],
    rows,
  };
}

/** Builds a streamed CSV response for a report and its date window. */
export async function buildReportExport(
  restaurantId: string,
  query: ReportQuery
): Promise<ExportResult> {
  await connectDB();

  let part:
    | { headers: string[]; rows: AsyncIterable<CsvCell[]> }
    | { headers: string[]; rows: CsvCell[][] };

  switch (query.tab) {
    case "sales":
      part = await streamSales(restaurantId, query);
      break;
    case "payments":
      part = await streamPayments(restaurantId, query);
      break;
    case "orders":
      part = await streamOrders(restaurantId, query);
      break;
    case "discounts":
      part = await streamDiscounts(restaurantId, query);
      break;
    case "items": {
      const buffered = await bufferItems(restaurantId, query);
      part = fromBuffer(buffered.headers, buffered.rows);
      break;
    }
    case "categories": {
      const report = await getCategorySalesReport(restaurantId, query);
      part = fromBuffer(
        ["Category", "Qty", "Sales (INR)"],
        report.rows.map((row) => [
          row.categoryName,
          row.quantity,
          r(row.salesPaise),
        ])
      );
      break;
    }
    case "gst": {
      const report = await getGSTReport(restaurantId, query);
      part = fromBuffer(
        [
          "Rate (%)", "Scheme", "Taxable (INR)", "CGST (INR)", "SGST (INR)",
          "IGST (INR)", "Total tax (INR)", "Bills",
        ],
        report.rows.map((row) => [
          row.taxRatePercent,
          GST_SCHEME_LABELS_MAP[
            row.gstScheme as keyof typeof GST_SCHEME_LABELS_MAP
          ] ?? row.gstScheme,
          r(row.taxableAmountPaise),
          r(row.cgstAmountPaise),
          r(row.sgstAmountPaise),
          r(row.igstAmountPaise),
          r(row.totalTaxPaise),
          row.bills,
        ])
      );
      break;
    }
    case "cancellations": {
      const buffered = await bufferCancellations(restaurantId, query);
      part = fromBuffer(buffered.headers, buffered.rows);
      break;
    }
  }

  return {
    filename: `zyp-pos-${query.tab}-report.csv`,
    contentType: "text/csv; charset=utf-8",
    stream: toStream(part.headers, part.rows as AsyncIterable<CsvCell[]>),
  };
}