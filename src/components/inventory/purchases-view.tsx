"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { InventoryPagination } from "@/components/inventory/inventory-pagination";
import { PurchaseForm } from "@/components/inventory/purchase-form";
import { ToastView, type ToastData } from "@/components/menu/toast";
import { useFilterParams } from "@/components/inventory/use-filter-params";
import { formatPaise } from "@/lib/menu/prices";
import { getPurchaseDetailAction } from "@/actions/inventory/actions";
import type { NormalizedPurchaseQuery } from "@/lib/inventory/query";
import type {
  Paged,
  PurchaseDetailView,
  PurchaseRowView,
} from "@/lib/inventory/types";
import { formatDate } from "@/lib/format/date";

function PurchaseDetailDialog({
  purchaseId,
  onClose,
}: {
  purchaseId: string;
  onClose(): void;
}) {
  const [loading, setLoading] = useState(true);
  const [purchase, setPurchase] = useState<PurchaseDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPurchaseDetailAction({ id: purchaseId }).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setPurchase(res.data);
      else setError(res.message ?? "Could not load purchase.");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [purchaseId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {purchase?.purchaseNumber ?? "Purchase"}
          </DialogTitle>
          <DialogDescription>
            {purchase?.supplierName ?? "Purchase details"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error || !purchase ? (
            <p className="py-6 text-center text-sm text-destructive">
              {error ?? "Purchase not found."}
            </p>
          ) : (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {formatDate(purchase.purchaseDate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Invoice</p>
                  <p className="font-medium">
                    {purchase.invoiceNumber ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Recorded by</p>
                  <p className="font-medium">
                    {purchase.createdByName ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant="secondary">{purchase.status}</Badge>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Rate</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Stock after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchase.items.map((line, index) => (
                      <tr key={index} className="border-b last:border-0">
                        <td className="px-3 py-2">{line.itemName}</td>
                        <td className="px-3 py-2">{line.quantityLabel}</td>
                        <td className="px-3 py-2">
                          {formatPaise(line.purchaseRatePaise)}
                        </td>
                        <td className="px-3 py-2">
                          {formatPaise(line.totalAmountPaise)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {line.afterStockLabel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {purchase.items.length} item(s)
                </span>
                <span className="font-heading text-lg font-semibold">
                  {formatPaise(purchase.subtotalPaise)}
                </span>
              </div>

              {purchase.notes && (
                <p className="text-sm text-muted-foreground">
                  {purchase.notes}
                </p>
              )}
            </div>
          )}
        </DialogBody>
      </DialogPopup>
    </Dialog>
  );
}

export function PurchasesView({
  data,
  query,
  canManage,
}: {
  data: Paged<PurchaseRowView>;
  query: NormalizedPurchaseQuery;
  canManage: boolean;
}) {
  const router = useRouter();
  const { setParams } = useFilterParams();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const showToast = useCallback((next: ToastData) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full lg:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                defaultValue={query.q}
                key={query.q}
                className="pl-8"
                placeholder="Search purchase, invoice, supplier…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setParams({ q: e.currentTarget.value.trim() || null });
                  }
                }}
              />
            </div>
            <Input
              type="date"
              aria-label="From date"
              className="w-40"
              value={query.from ?? ""}
              onChange={(e) => setParams({ from: e.currentTarget.value || null })}
            />
            <Input
              type="date"
              aria-label="To date"
              className="w-40"
              value={query.to ?? ""}
              onChange={(e) => setParams({ to: e.currentTarget.value || null })}
            />
          </div>

          {canManage && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="size-3.5" />
              Record Purchase
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Purchase #</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Invoice</th>
                <th className="px-4 py-2.5 font-medium">Items</th>
                <th className="px-4 py-2.5 font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Recorded by</th>
                <th className="px-4 py-2.5 text-right font-medium">View</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No purchases recorded yet.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      {row.purchaseNumber}
                    </td>
                    <td className="px-4 py-2.5">
                      {formatDate(row.purchaseDate)}
                    </td>
                    <td className="px-4 py-2.5">{row.supplierName ?? "—"}</td>
                    <td className="px-4 py-2.5">{row.invoiceNumber ?? "—"}</td>
                    <td className="px-4 py-2.5">{row.itemCount}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {formatPaise(row.subtotalPaise)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.createdByName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`View ${row.purchaseNumber}`}
                        onClick={() => setDetailId(row.id)}
                      >
                        <Eye className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <InventoryPagination
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          label="purchases"
          onPage={(page) => setParams({ page: String(page) })}
        />
      </div>

      {showForm && (
        <PurchaseForm
          onClose={() => setShowForm(false)}
          onSaved={(message) => {
            showToast({ kind: "success", message });
            router.refresh();
          }}
        />
      )}

      {detailId && (
        <PurchaseDetailDialog
          purchaseId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      <ToastView toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
