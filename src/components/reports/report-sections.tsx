import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatShortDate } from "@/lib/orders/format";
import {
  BILL_PAYMENT_METHOD_LABELS,
  BILL_STATUS_LABELS,
  GST_SCHEME_LABELS,
  type BillPaymentMethod,
} from "@/lib/billing/constants";
import {
  ORDER_STATUS_LABELS,
  orderTypeLabel,
  type OrderType,
} from "@/lib/orders/constants";
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from "@/lib/orders/status-ui";
import { formatPaise } from "@/lib/menu/prices";
import {
  getCancellationReport,
  getCategorySalesReport,
  getDiscountReport,
  getGSTReport,
  getItemSalesReport,
  getOrderReport,
  getPaymentReport,
  getSalesReport,
} from "@/lib/reports/report-service";
import { reportQueryToParams } from "@/lib/reports/url";
import type { ReportQuery } from "@/lib/reports/types";
import type {
  CancellationRow,
  DiscountReportRow,
  ItemSalesReportRow,
  OrderReportRow,
  PaymentReportRow,
  SalesReportRow,
} from "@/lib/reports/types";
import { PaginationLinks } from "./pagination";
import { ReportEmpty, ReportTable, Td, TdNum } from "./report-table";
import { StatCard } from "./stat-card";

const PARAMS_PATH = "/reports";

function fmtRupee(v: number): string {
  return formatPaise(v);
}

const METHOD_TONE: Record<BillPaymentMethod, string> = {
  CASH: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  UPI: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  CARD: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  OTHER: "bg-muted text-muted-foreground",
};

const TYPE_TONE: Record<OrderType, string> = {
  DINE_IN: "bg-muted text-muted-foreground",
  TAKEAWAY: "bg-muted text-muted-foreground",
  QUICK_SALE: "bg-muted text-muted-foreground",
};

function StatCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{children}</div>;
}

function MethodChips({ data }: { data: Array<{ method: BillPaymentMethod; amountPaise: number; count: number }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {data.map((m) => (
        <Badge key={m.method} className={cn(METHOD_TONE[m.method])}>
          {BILL_PAYMENT_METHOD_LABELS[m.method]}: {fmtRupee(m.amountPaise)} ({m.count})
        </Badge>
      ))}
      {data.length === 0 && (
        <span className="text-xs text-muted-foreground">No payments in this range.</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

async function SalesSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getSalesReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Gross sales" value={fmtRupee(s.grandTotalPaise)} />
        <StatCard label="Bills" value={String(s.bills)} />
        <StatCard label="Average bill" value={fmtRupee(s.averageBillPaise)} />
        <StatCard label="Discounts" value={`− ${fmtRupee(s.discountPaise)}`} />
        <StatCard label="Tax (GST)" value={fmtRupee(s.totalTaxPaise)} />
        <StatCard label="Service charge" value={fmtRupee(s.serviceChargeAmountPaise)} />
      </StatCardGrid>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Bill" },
              { label: "Paid on" },
              { label: "Order" },
              { label: "Type" },
              { label: "Table" },
              { label: "Customer" },
              { label: "Subtotal", right: true },
              { label: "Discount", right: true },
              { label: "Tax", right: true },
              { label: "Service", right: true },
              { label: "Round-off", right: true },
              { label: "Total", right: true },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No paid bills in this range." />}
            {report.rows.map((r: SalesReportRow) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.billNumber}</Td>
                <Td>{formatShortDate(r.paidAt)}</Td>
                <Td>#{r.orderNumber}</Td>
                <Td><Badge className={cn(TYPE_TONE[r.orderType])}>{orderTypeLabel[r.orderType]}</Badge></Td>
                <Td>{r.tableNameSnapshot ?? "—"}</Td>
                <Td>{r.customerName ?? "—"}</Td>
                <TdNum>{fmtRupee(r.subtotalPaise)}</TdNum>
                <TdNum>−{fmtRupee(r.discountPaise)}</TdNum>
                <TdNum>{fmtRupee(r.totalTaxPaise)}</TdNum>
                <TdNum>{fmtRupee(r.serviceChargeAmountPaise)}</TdNum>
                <TdNum>{fmtRupee(r.roundOffAmountPaise)}</TdNum>
                <TdNum className="font-medium">{fmtRupee(r.grandTotalPaise)}</TdNum>
              </tr>
            ))}
          </ReportTable>
          <PaginationLinks
            pathname={PARAMS_PATH}
            params={reportQueryToParams(query)}
            total={report.total}
            page={report.page}
            pageCount={report.pageCount}
            perPage={report.perPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function PaymentsSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getPaymentReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Collected" value={fmtRupee(s.totalCollectedPaise)} />
        <StatCard label="Payments" value={String(s.paymentsCount)} />
      </StatCardGrid>
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <MethodChips data={s.byMethod} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Received on" },
              { label: "Method" },
              { label: "Amount", right: true },
              { label: "Reference" },
              { label: "Bill" },
              { label: "Order" },
              { label: "Customer" },
              { label: "Received by" },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No payments in this range." />}
            {report.rows.map((r: PaymentReportRow) => (
              <tr key={r.id}>
                <Td>{formatDateTime(r.createdAt)}</Td>
                <Td><Badge className={cn(METHOD_TONE[r.method])}>{BILL_PAYMENT_METHOD_LABELS[r.method]}</Badge></Td>
                <TdNum className="font-medium">{fmtRupee(r.amountPaise)}</TdNum>
                <Td>{r.referenceNumber ?? "—"}</Td>
                <Td>{r.billNumber}</Td>
                <Td>#{r.orderNumber}</Td>
                <Td>{r.customerName ?? "—"}</Td>
                <Td>{r.receivedByName}</Td>
              </tr>
            ))}
          </ReportTable>
          <PaginationLinks
            pathname={PARAMS_PATH}
            params={reportQueryToParams(query)}
            total={report.total}
            page={report.page}
            pageCount={report.pageCount}
            perPage={report.perPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function OrdersSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getOrderReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Orders" value={String(s.orders)} />
        <StatCard label="Cancelled" value={String(s.cancelled)} />
        <StatCard label="Order value" value={fmtRupee(s.totalPaise)} />
      </StatCardGrid>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap gap-2">
            {s.byType.map((t) => (
              <Badge key={t.orderType} className={cn(TYPE_TONE[t.orderType])}>
                {orderTypeLabel[t.orderType]}: {t.orders}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Order" },
              { label: "Created on" },
              { label: "Type" },
              { label: "Status" },
              { label: "Table" },
              { label: "Customer" },
              { label: "Items", right: true },
              { label: "Total", right: true },
              { label: "Billed" },
              { label: "Created by" },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No orders in this range." />}
            {report.rows.map((r: OrderReportRow) => (
              <tr key={r.id}>
                <Td className="font-medium">#{r.orderNumber}</Td>
                <Td>{formatShortDate(r.createdAt)}</Td>
                <Td><Badge className={cn(TYPE_TONE[r.orderType])}>{orderTypeLabel[r.orderType]}</Badge></Td>
                <Td><Badge className={cn(ORDER_STATUS_TONE[r.status])}>{ORDER_STATUS_LABELS[r.status]}</Badge></Td>
                <Td>{r.tableNameSnapshot ?? "—"}</Td>
                <Td>{r.customerName ?? "—"}</Td>
                <TdNum>{r.itemsCount}</TdNum>
                <TdNum className="font-medium">{fmtRupee(r.totalPaise)}</TdNum>
                <Td>
                  {r.billStatus ? (
                    <Badge className={cn(PAYMENT_STATUS_TONE[r.billStatus])}>
                      {BILL_STATUS_LABELS[r.billStatus]}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>{r.createdByName}</Td>
              </tr>
            ))}
          </ReportTable>
          <PaginationLinks
            pathname={PARAMS_PATH}
            params={reportQueryToParams(query)}
            total={report.total}
            page={report.page}
            pageCount={report.pageCount}
            perPage={report.perPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function ItemsSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getItemSalesReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Units sold" value={String(s.quantity)} />
        <StatCard label="Revenue" value={fmtRupee(s.salesPaise)} />
        <StatCard label="Distinct items" value={String(s.distinctItems)} />
      </StatCardGrid>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Item" },
              { label: "Variant" },
              { label: "Category" },
              { label: "Qty", right: true },
              { label: "Sales", right: true },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No item sales in this range." />}
            {report.rows.map((r: ItemSalesReportRow) => (
              <tr key={`${r.menuItemId}-${r.variantName ?? ""}`}>
                <Td className="font-medium">{r.name}</Td>
                <Td>{r.variantName ?? "—"}</Td>
                <Td>{r.categoryName ?? "Uncategorised"}</Td>
                <TdNum>{r.quantity}</TdNum>
                <TdNum className="font-medium">{fmtRupee(r.salesPaise)}</TdNum>
              </tr>
            ))}
          </ReportTable>
          <PaginationLinks
            pathname={PARAMS_PATH}
            params={reportQueryToParams(query)}
            total={report.total}
            page={report.page}
            pageCount={report.pageCount}
            perPage={report.perPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function CategoriesSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getCategorySalesReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Categories" value={String(s.categories)} />
        <StatCard label="Units sold" value={String(s.quantity)} />
        <StatCard label="Revenue" value={fmtRupee(s.salesPaise)} />
      </StatCardGrid>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Category" },
              { label: "Qty", right: true },
              { label: "Sales", right: true },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No category sales in this range." />}
            {report.rows.map((r) => (
              <tr key={r.categoryId ?? r.categoryName}>
                <Td className="font-medium">{r.categoryName}</Td>
                <TdNum>{r.quantity}</TdNum>
                <TdNum className="font-medium">{fmtRupee(r.salesPaise)}</TdNum>
              </tr>
            ))}
          </ReportTable>
        </CardContent>
      </Card>
    </div>
  );
}

async function GstSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getGSTReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Gross sales" value={fmtRupee(s.grossSalesPaise)} />
        <StatCard label="Taxable value" value={fmtRupee(s.taxableAmountPaise)} />
        <StatCard label="CGST" value={fmtRupee(s.cgstAmountPaise)} />
        <StatCard label="SGST" value={fmtRupee(s.sgstAmountPaise)} />
        <StatCard label="IGST" value={fmtRupee(s.igstAmountPaise)} />
        <StatCard label="Total GST" value={fmtRupee(s.totalTaxPaise)} />
      </StatCardGrid>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Rate" },
              { label: "Scheme" },
              { label: "Taxable", right: true },
              { label: "CGST", right: true },
              { label: "SGST", right: true },
              { label: "IGST", right: true },
              { label: "Total tax", right: true },
              { label: "Bills", right: true },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No taxed sales in this range." />}
            {report.rows.map((r) => (
              <tr key={`${r.taxRatePercent}-${r.gstScheme}`}>
                <Td className="font-medium">{r.taxRatePercent}%</Td>
                <Td>{GST_SCHEME_LABELS[r.gstScheme as keyof typeof GST_SCHEME_LABELS] ?? r.gstScheme}</Td>
                <TdNum>{fmtRupee(r.taxableAmountPaise)}</TdNum>
                <TdNum>{fmtRupee(r.cgstAmountPaise)}</TdNum>
                <TdNum>{fmtRupee(r.sgstAmountPaise)}</TdNum>
                <TdNum>{fmtRupee(r.igstAmountPaise)}</TdNum>
                <TdNum className="font-medium">{fmtRupee(r.totalTaxPaise)}</TdNum>
                <TdNum>{r.bills}</TdNum>
              </tr>
            ))}
          </ReportTable>
        </CardContent>
      </Card>
    </div>
  );
}

async function DiscountsSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getDiscountReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Discounted bills" value={String(s.discountedBills)} />
        <StatCard label="Total discount" value={fmtRupee(s.totalDiscountPaise)} />
        <StatCard label="Gross before discount" value={fmtRupee(s.grossBeforeDiscountPaise)} />
        <StatCard label="Discount % of gross" value={`${s.discountPercent.toFixed(1)}%`} />
      </StatCardGrid>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Bill" },
              { label: "Paid on" },
              { label: "Customer" },
              { label: "Subtotal", right: true },
              { label: "Discount", right: true },
              { label: "Total", right: true },
              { label: "Created by" },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No discounts applied in this range." />}
            {report.rows.map((r: DiscountReportRow) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.billNumber}</Td>
                <Td>{formatShortDate(r.paidAt)}</Td>
                <Td>{r.customerName ?? "—"}</Td>
                <TdNum>{fmtRupee(r.subtotalPaise)}</TdNum>
                <TdNum className="font-medium text-destructive">−{fmtRupee(r.discountPaise)}</TdNum>
                <TdNum>{fmtRupee(r.grandTotalPaise)}</TdNum>
                <Td>{r.createdByName}</Td>
              </tr>
            ))}
          </ReportTable>
          <PaginationLinks
            pathname={PARAMS_PATH}
            params={reportQueryToParams(query)}
            total={report.total}
            page={report.page}
            pageCount={report.pageCount}
            perPage={report.perPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

async function CancellationsSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  const report = await getCancellationReport(restaurantId, query);
  const s = report.summary;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid>
        <StatCard label="Cancelled orders" value={String(s.cancelledOrders)} />
        <StatCard label="Cancelled bills" value={String(s.cancelledBills)} />
        <StatCard label="Cancelled value" value={fmtRupee(s.cancelledValuePaise)} />
      </StatCardGrid>

      <Card>
        <CardContent className="p-0">
          <ReportTable
            columns={[
              { label: "Type" },
              { label: "Reference" },
              { label: "Cancelled on" },
              { label: "Order type" },
              { label: "Amount", right: true },
              { label: "Reason" },
              { label: "Cancelled by" },
            ]}
          >
            {report.rows.length === 0 && <ReportEmpty label="No cancellations in this range." />}
            {report.rows.map((r: CancellationRow) => (
              <tr key={`${r.kind}-${r.id}`}>
                <Td>
                  <Badge className={r.kind === "ORDER" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}>
                    {r.kind === "ORDER" ? "Order" : "Bill"}
                  </Badge>
                </Td>
                <Td className="font-medium">{r.reference}</Td>
                <Td>{formatDateTime(r.cancelledAt)}</Td>
                <Td>
                  {r.kind === "ORDER" ? orderTypeLabel[r.orderType] : `order #${r.orderNumber}`}
                </Td>
                <TdNum className="font-medium">{fmtRupee(r.amountPaise)}</TdNum>
                <Td className="max-w-56 truncate">{r.reason ?? "—"}</Td>
                <Td>{r.byName}</Td>
              </tr>
            ))}
          </ReportTable>
          <PaginationLinks
            pathname={PARAMS_PATH}
            params={reportQueryToParams(query)}
            total={report.total}
            page={report.page}
            pageCount={report.pageCount}
            perPage={report.perPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                 */
/* -------------------------------------------------------------------------- */

export async function ReportSection({
  restaurantId,
  query,
}: {
  restaurantId: string;
  query: ReportQuery;
}) {
  switch (query.tab) {
    case "sales":
      return <SalesSection restaurantId={restaurantId} query={query} />;
    case "payments":
      return <PaymentsSection restaurantId={restaurantId} query={query} />;
    case "orders":
      return <OrdersSection restaurantId={restaurantId} query={query} />;
    case "items":
      return <ItemsSection restaurantId={restaurantId} query={query} />;
    case "categories":
      return <CategoriesSection restaurantId={restaurantId} query={query} />;
    case "gst":
      return <GstSection restaurantId={restaurantId} query={query} />;
    case "discounts":
      return <DiscountsSection restaurantId={restaurantId} query={query} />;
    case "cancellations":
      return <CancellationsSection restaurantId={restaurantId} query={query} />;
    default:
      return <SalesSection restaurantId={restaurantId} query={query} />;
  }
}