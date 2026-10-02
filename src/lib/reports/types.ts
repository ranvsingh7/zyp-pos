import type { OrderStatus, OrderType } from "@/lib/orders/constants";
import type { BillPaymentMethod, BillStatus } from "@/lib/billing/constants";
import type { ReportDateRange, ReportTab } from "./constants";

/** Range metadata shared by every report so the UI can label the window. */
export interface ReportRangeMeta {
  filter: ReportDateRange;
  label: string;
  /** ISO instant, inclusive. */
  from: string;
  /** ISO instant, exclusive. */
  to: string;
}

export interface ReportQuery {
  tab: ReportTab;
  date: ReportDateRange;
  from: string | null;
  to: string | null;
  page: number;
  q: string;
  /** Optional order-type filter (orders/sales/payments). */
  orderType: OrderType | "";
  /** Optional order-status filter (orders report). */
  status: OrderStatus | "";
  /** Optional payment-method filter (payments report). */
  method: BillPaymentMethod | "";
}

export interface ReportPage<T> {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  range: ReportRangeMeta;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export interface DashboardKpis {
  totalSalesPaise: number;
  ordersCount: number;
  paidBills: number;
  cancelledOrders: number;
  averageOrderValuePaise: number;
  dueAmountPaise: number;
  dueBills: number;
}

export interface DashboardSalesSummary {
  billedSalesPaise: number;
  discountPaise: number;
  taxPaise: number;
  serviceChargePaise: number;
  roundOffPaise: number;
  netSalesPaise: number;
  collectedPaise: number;
}

export interface PaymentMethodTotal {
  method: BillPaymentMethod;
  amountPaise: number;
  count: number;
}

export interface OrderTypeTotal {
  orderType: OrderType;
  orders: number;
  salesPaise: number;
}

export interface TimeBucket {
  /** Local YYYY-MM-DD (daily) or two-digit hour "00".."23" (hourly). */
  key: string;
  label: string;
  salesPaise: number;
  orders: number;
}

export interface TopItemRow {
  menuItemId: string;
  name: string;
  quantity: number;
  salesPaise: number;
}

export interface CategorySalesRow {
  categoryId: string | null;
  categoryName: string;
  quantity: number;
  salesPaise: number;
}

export interface RecentOrderRow {
  id: string;
  orderNumber: number;
  orderType: OrderType;
  status: OrderStatus;
  tableNameSnapshot: string | null;
  customerName: string | null;
  totalPaise: number;
  createdAt: string;
}

export interface OccupiedTablesSummary {
  occupied: number;
  total: number;
}

export interface DashboardSummary {
  range: ReportRangeMeta;
  financialsHidden: boolean;
  kpis: DashboardKpis;
  sales: DashboardSalesSummary;
  paymentBreakdown: PaymentMethodTotal[];
  orderTypeBreakdown: OrderTypeTotal[];
  hourlySales: TimeBucket[];
  dailySales: TimeBucket[];
  topItems: TopItemRow[];
  categorySales: CategorySalesRow[];
  recentOrders: RecentOrderRow[];
  tables: OccupiedTablesSummary;
}

/* -------------------------------------------------------------------------- */
/* Sales report                                                               */
/* -------------------------------------------------------------------------- */

export interface SalesReportRow {
  id: string;
  billNumber: string;
  orderNumber: number;
  orderType: OrderType;
  paidAt: string;
  tableNameSnapshot: string | null;
  customerName: string | null;
  subtotalPaise: number;
  discountPaise: number;
  taxableAmountPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  totalTaxPaise: number;
  serviceChargeAmountPaise: number;
  roundOffAmountPaise: number;
  grandTotalPaise: number;
  createdByName: string;
}

export interface SalesReportSummary {
  bills: number;
  subtotalPaise: number;
  discountPaise: number;
  taxableAmountPaise: number;
  totalTaxPaise: number;
  serviceChargeAmountPaise: number;
  roundOffAmountPaise: number;
  grandTotalPaise: number;
  averageBillPaise: number;
}

export interface SalesReport extends ReportPage<SalesReportRow> {
  summary: SalesReportSummary;
}

/* -------------------------------------------------------------------------- */
/* Payments report                                                            */
/* -------------------------------------------------------------------------- */

export interface PaymentReportRow {
  id: string;
  createdAt: string;
  method: BillPaymentMethod;
  amountPaise: number;
  referenceNumber: string | null;
  billNumber: string;
  orderNumber: number;
  orderType: OrderType;
  customerName: string | null;
  receivedByName: string;
}

export interface PaymentReportSummary {
  totalCollectedPaise: number;
  paymentsCount: number;
  byMethod: PaymentMethodTotal[];
}

export interface PaymentReport extends ReportPage<PaymentReportRow> {
  summary: PaymentReportSummary;
}

/* -------------------------------------------------------------------------- */
/* Orders report                                                              */
/* -------------------------------------------------------------------------- */

export interface OrderReportRow {
  id: string;
  orderNumber: number;
  createdAt: string;
  orderType: OrderType;
  status: OrderStatus;
  tableNameSnapshot: string | null;
  customerName: string | null;
  itemsCount: number;
  totalPaise: number;
  billStatus: BillStatus | null;
  createdByName: string;
}

export interface OrderReportSummary {
  orders: number;
  cancelled: number;
  totalPaise: number;
  byType: Array<{ orderType: OrderType; orders: number; totalPaise: number }>;
  byStatus: Array<{ status: OrderStatus; orders: number }>;
}

export interface OrderReport extends ReportPage<OrderReportRow> {
  summary: OrderReportSummary;
}

/* -------------------------------------------------------------------------- */
/* Item / category reports                                                    */
/* -------------------------------------------------------------------------- */

export interface ItemSalesReportRow {
  menuItemId: string;
  name: string;
  variantName: string | null;
  categoryName: string | null;
  quantity: number;
  salesPaise: number;
}

export interface ItemSalesReportSummary {
  quantity: number;
  salesPaise: number;
  distinctItems: number;
}

export interface ItemSalesReport {
  rows: ItemSalesReportRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  range: ReportRangeMeta;
  summary: ItemSalesReportSummary;
}

export interface CategorySalesReport {
  rows: CategorySalesRow[];
  range: ReportRangeMeta;
  summary: { quantity: number; salesPaise: number; categories: number };
}

/* -------------------------------------------------------------------------- */
/* GST report                                                                 */
/* -------------------------------------------------------------------------- */

export interface GstRateRow {
  taxRatePercent: number;
  gstScheme: string;
  taxableAmountPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  totalTaxPaise: number;
  bills: number;
}

export interface GstReport {
  rows: GstRateRow[];
  range: ReportRangeMeta;
  summary: {
    taxableAmountPaise: number;
    cgstAmountPaise: number;
    sgstAmountPaise: number;
    igstAmountPaise: number;
    totalTaxPaise: number;
    grossSalesPaise: number;
    bills: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Discount report                                                            */
/* -------------------------------------------------------------------------- */

export interface DiscountReportRow {
  id: string;
  billNumber: string;
  orderNumber: number;
  paidAt: string;
  customerName: string | null;
  subtotalPaise: number;
  discountPaise: number;
  grandTotalPaise: number;
  createdByName: string;
}

export interface DiscountReport {
  rows: DiscountReportRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  range: ReportRangeMeta;
  summary: {
    discountedBills: number;
    totalDiscountPaise: number;
    grossBeforeDiscountPaise: number;
    discountPercent: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Cancellation report                                                        */
/* -------------------------------------------------------------------------- */

export interface CancelledOrderRow {
  kind: "ORDER";
  id: string;
  reference: string;
  orderType: OrderType;
  cancelledAt: string;
  amountPaise: number;
  reason: string | null;
  byName: string;
}

export interface CancelledBillRow {
  kind: "BILL";
  id: string;
  reference: string;
  orderNumber: number;
  cancelledAt: string;
  amountPaise: number;
  reason: string | null;
  byName: string;
}

export type CancellationRow = CancelledOrderRow | CancelledBillRow;

export interface CancellationReport {
  rows: CancellationRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  range: ReportRangeMeta;
  summary: {
    cancelledOrders: number;
    cancelledBills: number;
    cancelledValuePaise: number;
  };
}
