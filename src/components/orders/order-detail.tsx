"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Clock,
  History,
  Printer,
  ReceiptText,
  Eye,
  MoreHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KotStatusBadge } from "@/components/pos/kot-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingPanel } from "@/components/billing/billing-panel";
import { CancelOrderDialog } from "@/components/pos/cancel-order-dialog";
import { ToastView, type ToastData } from "@/components/menu/toast";
import { openPrintWindow, writePrintWindow } from "@/components/orders/orders-print";
import { cancelOrderAction } from "@/actions/orders/actions";
import {
  printKotAction,
  reprintKotAction,
  viewKotAction,
} from "@/actions/orders/actions";
import {
  ORDER_STATUS_LABELS,
  orderTypeLabel,
} from "@/lib/orders/constants";
import { BILL_PAYMENT_METHOD_LABELS } from "@/lib/billing/constants";
import {
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_TONE,
} from "@/lib/orders/status-ui";
import { formatDateTime } from "@/lib/orders/format";
import { formatPaise } from "@/lib/menu/prices";
import type { OrderDetailsView, KotView } from "@/lib/orders/types";

interface OrderDetailProps {
  details: OrderDetailsView;
  canManage: boolean;
  canCancelBill: boolean;
  canCancelOrder: boolean;
}

interface TimelineEvent {
  label: string;
  at: string;
  detail?: string | null;
}

export function OrderDetail({
  details,
  canManage,
  canCancelBill,
  canCancelOrder,
}: OrderDetailProps) {
  const { order, kots, bill, staff } = details;
  const router = useRouter();
  const [toast, setToast] = useState<ToastData | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [busyKotId, setBusyKotId] = useState<string | null>(null);
  const [printingPending, setPrintingPending] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  function staffName(id: string | null | undefined): string {
    if (!id) return "—";
    return staff[id]?.fullName ?? "Unknown staff";
  }

  function showToast(kind: ToastData["kind"], message: string) {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 3500);
  }

  const timeline: TimelineEvent[] = [];
  timeline.push({
    label: "Order created",
    at: order.createdAt,
    detail: staffName(order.createdBy),
  });
  if (order.sentToKitchenAt) {
    timeline.push({ label: "Sent to kitchen", at: order.sentToKitchenAt });
  }
  if (order.heldAt) timeline.push({ label: "Order held", at: order.heldAt });
  if (order.resumedAt) timeline.push({ label: "Order resumed", at: order.resumedAt });
  for (const kot of kots) {
    timeline.push({
      label: `KOT ${kot.kotNumber} printed`,
      at: kot.createdAt,
      detail: staffName(kot.createdBy),
    });
    if (kot.status === "CANCELLED" && kot.cancelledAt) {
      const cancelledDetail = [
        kot.cancelledBy ? staffName(kot.cancelledBy) : null,
        kot.cancellationReason,
      ]
        .filter(Boolean)
        .join(" · ");
      timeline.push({
        label: `KOT ${kot.kotNumber} cancelled`,
        at: kot.cancelledAt,
        detail: cancelledDetail || null,
      });
    }
  }
  if (bill) {
    timeline.push({
      label: `Bill ${bill.billNumber} generated`,
      at: bill.createdAt,
      detail: staffName(bill.createdBy),
    });
    for (const payment of bill.payments) {
      timeline.push({
        label: `Payment ${formatPaise(payment.amountPaise)} · ${BILL_PAYMENT_METHOD_LABELS[payment.method]}`,
        at: payment.createdAt,
        detail: staffName(payment.receivedBy),
      });
    }
    if (bill.paidAt) {
      timeline.push({ label: "Bill settled", at: bill.paidAt });
    }
    if (bill.cancelledAt) {
      timeline.push({
        label: "Bill cancelled",
        at: bill.cancelledAt,
        detail: bill.cancellationReason,
      });
    }
  }
  if (order.paidAt && !bill?.paidAt) {
    timeline.push({ label: "Order paid", at: order.paidAt });
  }
  if (order.cancelledAt) {
    timeline.push({
      label: "Order cancelled",
      at: order.cancelledAt,
      detail: order.cancellationReason || staffName(order.cancelledBy),
    });
  }
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const canCancelThisOrder =
    canCancelOrder && order.status !== "CANCELLED" && order.status !== "PAID";

  async function handleConfirmCancel(reason: string) {
    setCancelBusy(true);
    const result = await cancelOrderAction({ orderId: order.id, reason });
    setCancelBusy(false);
    setCancelOpen(false);
    if (!result.success) {
      showToast("error", result.message ?? "Could not cancel the order.");
      return;
    }
    showToast("success", `Order #${order.orderNumber} cancelled.`);
    router.refresh();
  }

  async function runKot(action: "view" | "reprint", kot: KotView) {
    const win = openPrintWindow();
    if (!win) {
      showToast("error", "Printing could not be started.");
      return;
    }
    setBusyKotId(kot.id);
    try {
      const result =
        action === "view"
          ? await viewKotAction({ kotId: kot.id })
          : await reprintKotAction({ kotId: kot.id });
      if (!result.success || !result.html) {
        win.close();
        showToast("error", result.message ?? "Could not open the KOT.");
        return;
      }
      writePrintWindow(win, result.html);
      if (action === "reprint") {
        showToast("success", `KOT ${kot.kotNumber} sent to printer.`);
        router.refresh();
      }
    } catch (error) {
      try {
        win.close();
      } catch {
        // ignore
      }
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not open the KOT."
      );
    } finally {
      setBusyKotId(null);
    }
  }

  /**
   * Prints the pending (incremental) KOT: the server snapshots the pending
   * delta — newly-added items and increased quantities since the last printed
   * KOT — into a new KOT record (only now is a record created). Printed KOT
   * history is left untouched and the pending entry disappears afterwards.
   */
  async function handlePrintUpdatedKot() {
    const win = openPrintWindow();
    if (!win) {
      showToast("error", "Printing could not be started.");
      return;
    }
    setPrintingPending(true);
    try {
      const result = await printKotAction({ orderId: order.id });
      if (!result.success || result.hasPending === false || !result.html) {
        win.close();
        showToast("error", result.message ?? "Could not print the updated KOT.");
        return;
      }
      writePrintWindow(win, result.html);
      showToast("success", `KOT ${result.kotNumber} printed.`);
      router.refresh();
    } catch (error) {
      try {
        win.close();
      } catch {
        // ignore
      }
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not print the updated KOT."
      );
    } finally {
      setPrintingPending(false);
    }
  }

  const grandTotal = bill ? bill.grandTotalPaise : order.totalPaise;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">
            Order #{order.orderNumber}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={ORDER_STATUS_TONE[order.status]}>
              {ORDER_STATUS_LABELS[order.status]}
            </Badge>
            {bill && (
              <Badge className={PAYMENT_STATUS_TONE[bill.paymentStatus]}>
                {bill.billNumber} · {bill.paymentStatus}
              </Badge>
            )}
            {canCancelThisOrder && (
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <MoreHorizontal className="size-4" />
                  More actions
                </Button>
                {moreOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMoreOpen(false)}
                    />
                    <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border bg-card p-1 shadow-lg">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          setMoreOpen(false);
                          setCancelOpen(true);
                        }}
                      >
                        <Ban className="size-4" />
                        Cancel order
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Field label="Type" value={orderTypeLabel[order.orderType]} />
            <Field
              label="Table"
              value={
                order.orderType === "DINE_IN"
                  ? order.tableNameSnapshot ?? "—"
                  : "—"
              }
            />
            <Field label="Customer" value={order.customerName ?? "—"} />
            <Field label="Phone" value={order.customerPhone ?? "—"} />
            <Field label="Created" value={formatDateTime(order.createdAt)} />
            <Field label="Created by" value={staffName(order.createdBy)} />
            {order.sentToKitchenAt && (
              <Field
                label="Kitchen"
                value={formatDateTime(order.sentToKitchenAt)}
              />
            )}
            {order.cancelledAt && (
              <Field
                label="Cancelled"
                value={formatDateTime(order.cancelledAt)}
              />
            )}
          </div>

          {order.orderNote && (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">Note: </span>
              {order.orderNote}
            </p>
          )}

          <div className="flex flex-col divide-y divide-border/60 rounded-lg bg-muted/30">
            {order.items.map((item, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.nameSnapshot}</p>
                  {item.variantNameSnapshot && (
                    <p className="text-xs text-muted-foreground">
                      {item.variantNameSnapshot}
                    </p>
                  )}
                  {/* HSN/SAC appears only for lines that actually have one. */}
                  {item.hsnSacCode && (
                    <p className="text-xs text-muted-foreground">
                      HSN/SAC: {item.hsnSacCode}
                    </p>
                  )}
                  {item.note && (
                    <p className="text-xs text-muted-foreground">
                      {item.note}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {item.quantity} × {formatPaise(item.unitPricePaise)}
                </span>
                <span className="shrink-0 font-semibold">
                  {formatPaise(item.lineTotalPaise)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1 px-4 pb-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {bill ? "Bill total" : "Item total"}
              </span>
              <span className="text-base font-bold">
                {formatPaise(grandTotal)}
              </span>
            </div>
            {bill && bill.dueAmountPaise > 0 && (
              <div className="flex items-center justify-between text-sm text-amber-600 dark:text-amber-400">
                <span>Balance due</span>
                <span>{formatPaise(bill.dueAmountPaise)}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-5" />
              KOT history
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {kots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No KOTs printed yet.
              </p>
            ) : (
              kots.map((kot) => (
                <div
                  key={kot.id}
                  className="rounded-lg border bg-card px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {kot.kotNumber}
                        <KotStatusBadge kot={kot} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDateTime(kot.createdAt)}
                        {kot.printedAt
                          ? ` · Printed ${formatDateTime(kot.printedAt)}`
                          : ""}
                        {kot.printedCount > 1
                          ? ` · reprinted ${kot.printedCount}×`
                          : ""}
                        {kot.status === "CANCELLED"
                          ? ` · Cancelled ${formatDateTime(kot.cancelledAt ?? "")} by ${staffName(kot.cancelledBy)}`
                          : ` · by ${staffName(kot.createdBy)}`}
                        {kot.status === "CANCELLED" &&
                        kot.cancellationReason
                          ? ` · ${kot.cancellationReason}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busyKotId === kot.id}
                        onClick={() => runKot("view", kot)}
                        aria-label={`View KOT ${kot.kotNumber}`}
                      >
                        <Eye className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={busyKotId === kot.id}
                        onClick={() => runKot("reprint", kot)}
                        aria-label={`Reprint KOT ${kot.kotNumber}`}
                      >
                        <Printer className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {kot.items.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-border/60 pt-1.5">
                      {kot.items.map((item, index) => (
                        <li
                          key={index}
                          className="text-xs text-muted-foreground"
                        >
                          <span className="font-medium text-foreground">
                            {item.quantity} × {item.name}
                          </span>
                          {item.variant ? ` · ${item.variant}` : ""}
                          {item.note ? ` — “${item.note}”` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}

            {order.pendingKitchenPrint !== null &&
              order.status !== "CANCELLED" && (
                <div className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                        {order.pendingKitchenPrint === "ADD"
                          ? "First KOT — Pending Print"
                          : "Pending KOT — New quantities"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {order.pendingKitchenItems.length > 0
                          ? `${order.pendingKitchenItems.reduce(
                              (sum, item) => sum + item.quantity,
                              0
                            )} quantities pending · edit the order in the POS before printing`
                          : "Pending order changes"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      disabled={printingPending || busyKotId !== null}
                      onClick={handlePrintUpdatedKot}
                    >
                      <Printer className="size-4" />
                      PRINT KOT
                    </Button>
                  </div>
                  {order.pendingKitchenItems.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-amber-500/20 pt-1.5">
                      {order.pendingKitchenItems.map((item, index) => (
                        <li
                          key={index}
                          className="text-xs text-amber-800 dark:text-amber-200"
                        >
                          <span className="font-semibold">
                            {item.quantity} × {item.name}
                          </span>
                          {item.variant ? ` · ${item.variant}` : ""}
                          {item.note ? ` — “${item.note}”` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-5" />
              Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {timeline.map((event, index) => (
                <li key={index} className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{event.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.at)}
                      {event.detail ? ` · ${event.detail}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 px-1 text-muted-foreground">
        <ReceiptText className="size-4" />
        <span className="text-sm font-medium">Bill & payments</span>
      </div>
      <BillingPanel
        orderId={order.id}
        initialBill={bill}
        canManage={canManage}
        canCancel={canCancelBill}
        subtotalPaise={order.totalPaise}
      />

      {cancelOpen && (
        <CancelOrderDialog
          order={order}
          pending={cancelBusy}
          onConfirm={handleConfirmCancel}
          onClose={() => setCancelOpen(false)}
        />
      )}

      <ToastView toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}