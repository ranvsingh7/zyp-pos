import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { OrderModel } from "@/models/Order";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { APP_TIMEZONE } from "@/lib/orders/date-range";
import type { OrderStatus, OrderType } from "@/lib/orders/constants";
import type { BillPaymentMethod } from "@/lib/billing/constants";
import { DASHBOARD_RECENT_ORDERS, DASHBOARD_TOP_ITEMS, type ReportDateRange } from "./constants";
import { resolveReportRange, toObjectId } from "./shared";
import type { ReportQuery } from "./types";
import type {
  CategorySalesRow,
  DashboardSummary,
  OrderTypeTotal,
  PaymentMethodTotal,
  RecentOrderRow,
  TopItemRow,
  TimeBucket,
} from "./types";

export interface DashboardOptions {
  /** Waiters see operational data only; money fields are masked to zero. */
  includeFinancials?: boolean;
}

const NON_REVENUE = ["CANCELLED", "REFUNDED"];

/**
 * Everything the dashboard renders, computed server-side with MongoDB
 * aggregation. "Sales" recognises revenue when a bill is fully paid
 * (status PAID) and is bucketed by `paidAt` in the restaurant business
 * timezone, matching the Sales report and the Orders summary card. Payments
 * are bucketed by when the money was actually received.
 */
export async function getDashboardSummary(
  restaurantId: string,
  query: {
    date: ReportDateRange;
    from?: string | null;
    to?: string | null;
  },
  options: DashboardOptions = {}
): Promise<DashboardSummary> {
  await connectDB();
  const includeFinancials = options.includeFinancials ?? true;

  const { range, meta } = resolveReportRange(query as ReportQuery);
  const rid = toObjectId(restaurantId);
  const tz = APP_TIMEZONE;
  const salesMatch = {
    restaurantId: rid,
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
  };

  interface SalesAgg {
    bills: number;
    grandTotal: number;
    discount: number;
    tax: number;
    serviceCharge: number;
    roundOff: number;
    taxable: number;
  }

  const [
    salesAgg,
    ordersFacet,
    dueAgg,
    paymentsFacet,
    typeAgg,
    hourlyAgg,
    dailyAgg,
    topAgg,
    categoryAgg,
    recentDocs,
    tableTotal,
    tableOccupied,
  ] = await Promise.all([
    BillModel.aggregate<SalesAgg>([
      { $match: salesMatch },
      {
        $group: {
          _id: null,
          bills: { $sum: 1 },
          grandTotal: { $sum: "$grandTotalPaise" },
          discount: { $sum: "$discountPaise" },
          tax: { $sum: "$totalTaxPaise" },
          serviceCharge: { $sum: "$serviceChargeAmountPaise" },
          roundOff: { $sum: "$roundOffAmountPaise" },
          taxable: { $sum: "$taxableAmountPaise" },
        },
      },
    ]),
    OrderModel.aggregate<{
      total: Array<{ n: number }>;
      cancelled: Array<{ n: number }>;
    }>([
      { $match: { restaurantId: rid, createdAt: { $gte: range.from, $lt: range.to } } },
      {
        $facet: {
          total: [{ $count: "n" }],
          cancelled: [{ $match: { status: "CANCELLED" } }, { $count: "n" }],
        },
      },
    ]),
    BillModel.aggregate<{ amount: number; n: number }>([
      { $match: { restaurantId: rid, status: { $in: ["UNPAID", "PARTIAL"] } } },
      {
        $group: {
          _id: null,
          amount: { $sum: "$dueAmountPaise" },
          n: { $sum: 1 },
        },
      },
    ]),
    PaymentModel.aggregate<{
      total: Array<{ total: number; n: number }>;
      byMethod: Array<{ _id: BillPaymentMethod; amount: number; count: number }>;
    }>([
      { $match: { restaurantId: rid, createdAt: { $gte: range.from, $lt: range.to } } },
      {
        $lookup: {
          from: "bills",
          localField: "billId",
          foreignField: "_id",
          as: "bill",
        },
      },
      { $match: { "bill.status": { $nin: NON_REVENUE } } },
      {
        $facet: {
          total: [
            {
              $group: {
                _id: null,
                total: { $sum: "$amountPaise" },
                n: { $sum: 1 },
              },
            },
          ],
          byMethod: [
            {
              $group: {
                _id: "$method",
                amount: { $sum: "$amountPaise" },
                count: { $sum: 1 },
              },
            },
            { $sort: { amount: -1 } },
          ],
        },
      },
    ]),
    BillModel.aggregate<{ _id: OrderType; sales: number; orders: number }>([
      { $match: salesMatch },
      {
        $group: {
          _id: "$orderType",
          sales: { $sum: "$grandTotalPaise" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { sales: -1 } },
    ]),
    BillModel.aggregate<{ _id: number; sales: number; orders: number }>([
      { $match: salesMatch },
      {
        $group: {
          _id: { $hour: { date: "$paidAt", timezone: tz } },
          sales: { $sum: "$grandTotalPaise" },
          orders: { $sum: 1 },
        },
      },
    ]),
    BillModel.aggregate<{ _id: string; sales: number; orders: number }>([
      { $match: salesMatch },
      {
        $group: {
          _id: {
            $dateToString: { date: "$paidAt", format: "%Y-%m-%d", timezone: tz },
          },
          sales: { $sum: "$grandTotalPaise" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    BillModel.aggregate<{
      _id: { id: mongoose.Types.ObjectId; name: string };
      quantity: number;
      sales: number;
    }>([
      { $match: salesMatch },
      { $unwind: "$items" },
      {
        $group: {
          _id: { id: "$items.menuItemId", name: "$items.nameSnapshot" },
          quantity: { $sum: "$items.quantity" },
          sales: { $sum: "$items.lineTotalPaise" },
        },
      },
      { $sort: { quantity: -1, sales: -1 } },
      { $limit: DASHBOARD_TOP_ITEMS },
    ]),
    BillModel.aggregate<{
      _id: { id: mongoose.Types.ObjectId | null; name: string | null };
      quantity: number;
      sales: number;
    }>([
      { $match: salesMatch },
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
    ]),
    OrderModel.find({ restaurantId })
      .sort({ createdAt: -1 })
      .limit(DASHBOARD_RECENT_ORDERS)
      .select("orderNumber orderType status tableNameSnapshot customerName totalPaise createdAt")
      .lean(),
    RestaurantTableModel.countDocuments({ restaurantId, isActive: true }),
    RestaurantTableModel.countDocuments({
      restaurantId,
      isActive: true,
      status: "OCCUPIED",
    }),
  ]);

  const sales: SalesAgg =
    salesAgg[0] ??
    {
      bills: 0,
      grandTotal: 0,
      discount: 0,
      tax: 0,
      serviceCharge: 0,
      roundOff: 0,
      taxable: 0,
    };
  const ordersInRange = ordersFacet[0]?.total?.[0]?.n ?? 0;
  const cancelledOrders = ordersFacet[0]?.cancelled?.[0]?.n ?? 0;
  const due = dueAgg[0] ?? { amount: 0, n: 0 };
  const paymentTotals = paymentsFacet[0];
  const collectedPaise = paymentTotals?.total?.[0]?.total ?? 0;
  const paymentBreakdown: PaymentMethodTotal[] = (paymentTotals?.byMethod ?? []).map(
    (row) => ({ method: row._id, amountPaise: row.amount, count: row.count })
  );

  const orderTypeBreakdown: OrderTypeTotal[] = typeAgg.map((row) => ({
    orderType: row._id,
    orders: row.orders,
    salesPaise: row.sales,
  }));

  const hourlySales: TimeBucket[] = Array.from({ length: 24 }, (_, hour) => {
    const found = hourlyAgg.find((h) => h._id === hour);
    const key = String(hour).padStart(2, "0");
    return {
      key,
      label: `${key}:00`,
      salesPaise: found?.sales ?? 0,
      orders: found?.orders ?? 0,
    };
  });

  const dailySales: TimeBucket[] = dailyAgg.map((row) => ({
    key: row._id,
    label: row._id,
    salesPaise: row.sales,
    orders: row.orders,
  }));

  const topItems: TopItemRow[] = topAgg.map((row) => ({
    menuItemId: String(row._id.id),
    name: row._id.name,
    quantity: row.quantity,
    salesPaise: row.sales,
  }));

  const categorySales: CategorySalesRow[] = categoryAgg.map((row) => ({
    categoryId: row._id.id ? String(row._id.id) : null,
    categoryName: row._id.name ?? "Uncategorised",
    quantity: row.quantity,
    salesPaise: row.sales,
  }));

  const recentOrders: RecentOrderRow[] = recentDocs.map((doc) => ({
    id: String(doc._id),
    orderNumber: doc.orderNumber,
    orderType: doc.orderType as OrderType,
    status: doc.status as OrderStatus,
    tableNameSnapshot: doc.tableNameSnapshot ?? null,
    customerName: doc.customerName ?? null,
    totalPaise: doc.totalPaise,
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
  }));

  const summary: DashboardSummary = {
    range: meta,
    financialsHidden: !includeFinancials,
    kpis: {
      totalSalesPaise: includeFinancials ? sales.grandTotal : 0,
      ordersCount: ordersInRange,
      paidBills: sales.bills,
      cancelledOrders,
      averageOrderValuePaise:
        includeFinancials && sales.bills > 0
          ? Math.round(sales.grandTotal / sales.bills)
          : 0,
      dueAmountPaise: includeFinancials ? due.amount : 0,
      dueBills: due.n,
    },
    sales: {
      billedSalesPaise: includeFinancials ? sales.grandTotal : 0,
      discountPaise: includeFinancials ? sales.discount : 0,
      taxPaise: includeFinancials ? sales.tax : 0,
      serviceChargePaise: includeFinancials ? sales.serviceCharge : 0,
      roundOffPaise: includeFinancials ? sales.roundOff : 0,
      netSalesPaise: includeFinancials ? sales.taxable : 0,
      collectedPaise: includeFinancials ? collectedPaise : 0,
    },
    paymentBreakdown: includeFinancials ? paymentBreakdown : [],
    orderTypeBreakdown: orderTypeBreakdown.map((row) => ({
      ...row,
      salesPaise: includeFinancials ? row.salesPaise : 0,
    })),
    hourlySales: hourlySales.map((row) => ({
      ...row,
      salesPaise: includeFinancials ? row.salesPaise : 0,
    })),
    dailySales: dailySales.map((row) => ({
      ...row,
      salesPaise: includeFinancials ? row.salesPaise : 0,
    })),
    topItems: topItems.map((row) => ({
      ...row,
      salesPaise: includeFinancials ? row.salesPaise : 0,
    })),
    categorySales: categorySales.map((row) => ({
      ...row,
      salesPaise: includeFinancials ? row.salesPaise : 0,
    })),
    recentOrders,
    tables: { occupied: tableOccupied, total: tableTotal },
  };

  return summary;
}
