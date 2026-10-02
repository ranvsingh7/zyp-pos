"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PrintBillButton } from "@/components/billing/print-bill-button";
import {
  ORDER_STATUS_LABELS,
  ORDERS_PAGE_SIZE,
  orderTypeLabel,
} from "@/lib/orders/constants";
import {
  BILL_STATUS_LABELS,
} from "@/lib/billing/constants";
import {
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  ORDER_TYPE_TONE,
} from "@/lib/orders/status-ui";
import { formatDateTime } from "@/lib/orders/format";
import { formatPaise } from "@/lib/menu/prices";
import {
  isOrdersQueryFiltered,
  ordersQueryToSearchParams,
  type NormalizedOrdersQuery,
} from "@/lib/orders/orders-query";
import type { OrderListRow } from "@/lib/orders/types";

interface OrdersTableProps {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageCount: number;
  query: NormalizedOrdersQuery;
  canPrint: boolean;
}

export function OrdersTable({
  rows,
  total,
  page,
  pageCount,
  query,
  canPrint,
}: OrdersTableProps) {
  function pageHref(nextPage: number): string {
    const params = ordersQueryToSearchParams({ ...query, page: nextPage });
    const qs = params.toString();
    return qs ? `/orders?${qs}` : "/orders";
  }

  const from = total === 0 ? 0 : (page - 1) * ORDERS_PAGE_SIZE + 1;
  const to = Math.min(total, page * ORDERS_PAGE_SIZE);
  const isFiltered = isOrdersQueryFiltered(query);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
        <ReceiptText className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {isFiltered ? "No orders match these filters" : "No orders yet"}
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {isFiltered
            ? "Try widening the date range or clearing a filter."
            : "Take an order from the POS screen and it will appear here."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {total === 0 ? "No orders" : `${from}–${to} of ${total} orders`}
        </p>
        {query.q && (
          <p className="truncate">
            Matching “{query.q}”
          </p>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th className="w-24 px-4 py-2.5 font-medium">Order</th>
              <th className="w-36 px-3 py-2.5 font-medium">Created</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Table / Customer</th>
              <th className="w-28 px-3 py-2.5 font-medium">Status</th>
              <th className="w-28 px-3 py-2.5 font-medium">Payment</th>
              <th className="w-28 px-3 py-2.5 text-right font-medium">Amount</th>
              <th className="w-36 px-3 py-2.5 font-medium">Created by</th>
              <th className="w-28 px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link
                    href={`/orders/${row.id}`}
                    className="font-semibold hover:underline"
                  >
                    #{row.orderNumber}
                  </Link>
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                </td>
                <td className="px-3 py-3">
                  <Badge className={ORDER_TYPE_TONE[row.orderType]}>
                    {orderTypeLabel[row.orderType]}
                  </Badge>
                </td>
                <td className="px-3 py-3">
                  <p className="truncate">
                    {row.orderType === "DINE_IN"
                      ? row.tableNameSnapshot
                        ? `Table ${row.tableNameSnapshot}`
                        : "Dine-in"
                      : "—"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.customerName
                      ? `${row.customerName}${row.customerPhone ? ` · ${row.customerPhone}` : ""}`
                      : row.customerPhone ?? ""}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <Badge className={ORDER_STATUS_TONE[row.status]}>
                    {ORDER_STATUS_LABELS[row.status]}
                  </Badge>
                </td>
                <td className="px-3 py-3">
                  {row.paymentStatus ? (
                    <Badge className={PAYMENT_STATUS_TONE[row.paymentStatus]}>
                      {BILL_STATUS_LABELS[row.paymentStatus]}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">No bill</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-semibold">
                  {formatPaise(row.amountPaise)}
                </td>
                <td className="truncate px-3 py-3 text-muted-foreground">
                  {row.createdByName}
                </td>
                <td className="px-4 py-3">
                  <RowActions row={row} canPrint={canPrint} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-xl border bg-card px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/orders/${row.id}`}
                className="font-semibold hover:underline"
              >
                #{row.orderNumber}
              </Link>
              <Badge className={ORDER_STATUS_TONE[row.status]}>
                {ORDER_STATUS_LABELS[row.status]}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {orderTypeLabel[row.orderType]}
              {row.orderType === "DINE_IN" && row.tableNameSnapshot
                ? ` · Table ${row.tableNameSnapshot}`
                : ""}
              {row.customerName ? ` · ${row.customerName}` : ""}
              {row.customerPhone ? ` · ${row.customerPhone}` : ""}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div>
                <p className="font-bold">{formatPaise(row.amountPaise)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {canPrint && row.billId && (
                  <PrintBillButton
                    billId={row.billId}
                    label=""
                    size="icon"
                    variant="ghost"
                  />
                )}
                <Button
                  nativeButton={false}
                  render={<Link href={`/orders/${row.id}`} />}
                  variant="outline"
                  size="sm"
                >
                  View
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <Button
            nativeButton={false}
            render={page > 1 ? <Link href={pageHref(page - 1)} /> : <span />}
            variant="outline"
            size="sm"
            disabled={page <= 1}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            nativeButton={false}
            render={page < pageCount ? <Link href={pageHref(page + 1)} /> : <span />}
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function RowActions({ row, canPrint }: { row: OrderListRow; canPrint: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      {canPrint && row.billId && (
        <PrintBillButton billId={row.billId} label="" size="icon" variant="ghost" />
      )}
      <Button
        nativeButton={false}
        render={<Link href={`/orders/${row.id}`} />}
        variant="outline"
        size="sm"
      >
        View
      </Button>
    </div>
  );
}