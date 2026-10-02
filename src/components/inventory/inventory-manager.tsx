"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  Package,
  Pencil,
  Power,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { InventorySummaryCards } from "@/components/inventory/inventory-summary";
import { InventoryToolbar } from "@/components/inventory/inventory-toolbar";
import { InventoryPagination } from "@/components/inventory/inventory-pagination";
import { StockStatusBadge } from "@/components/inventory/status-badge";
import { ItemForm } from "@/components/inventory/item-form";
import { PurchaseForm } from "@/components/inventory/purchase-form";
import {
  StockModal,
  type StockModalMode,
} from "@/components/inventory/stock-modal";
import { ItemDetailDialog } from "@/components/inventory/item-detail-dialog";
import { ConfirmDialog } from "@/components/menu/confirm-dialog";
import { ToastView, type ToastData } from "@/components/menu/toast";
import { formatPaise } from "@/lib/menu/prices";
import { setInventoryItemActiveAction } from "@/actions/inventory/actions";
import { useFilterParams } from "@/components/inventory/use-filter-params";
import type { NormalizedInventoryQuery } from "@/lib/inventory/query";
import type {
  InventoryCategoryView,
  InventoryItemView,
  InventorySummary,
  Paged,
} from "@/lib/inventory/types";

type StockModalState = {
  mode: StockModalMode;
  item: InventoryItemView | null;
} | null;

export function InventoryManager({
  data,
  summary,
  categories,
  query,
  canManage,
}: {
  data: Paged<InventoryItemView>;
  summary: InventorySummary;
  categories: InventoryCategoryView[];
  query: NormalizedInventoryQuery;
  canManage: boolean;
}) {
  const router = useRouter();
  const { setParams } = useFilterParams();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [toast, setToast] = useState<ToastData | null>(null);
  const [itemForm, setItemForm] = useState<{
    open: boolean;
    initial: InventoryItemView | null;
  }>({ open: false, initial: null });
  const [showPurchase, setShowPurchase] = useState(false);
  const [stockModal, setStockModal] = useState<StockModalState>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<InventoryItemView | null>(null);
  const [toggling, setToggling] = useState(false);

  const showToast = useCallback((next: ToastData) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const handleSaved = useCallback(
    (message: string) => {
      showToast({ kind: "success", message });
      router.refresh();
    },
    [router, showToast]
  );

  async function handleToggleActive() {
    if (!confirmItem) return;
    setToggling(true);
    const res = await setInventoryItemActiveAction({
      id: confirmItem.id,
      isActive: !confirmItem.isActive,
    });
    setToggling(false);
    if (res.success) {
      showToast({ kind: "success", message: res.message ?? "Updated." });
      router.refresh();
    } else {
      showToast({ kind: "error", message: res.message ?? "Update failed." });
    }
    setConfirmItem(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <InventorySummaryCards summary={summary} />

      <div className="rounded-xl border bg-card">
        <div className="border-b p-4">
          <InventoryToolbar
            query={query}
            categories={categories}
            canManage={canManage}
            onAddItem={() => setItemForm({ open: true, initial: null })}
            onAddPurchase={() => setShowPurchase(true)}
            onAdjust={() => setStockModal({ mode: "adjust", item: null })}
            onWastage={() => setStockModal({ mode: "wastage", item: null })}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Current Stock</th>
                <th className="px-4 py-2.5 font-medium">Min Level</th>
                <th className="px-4 py-2.5 font-medium">Cost / Unit</th>
                <th className="px-4 py-2.5 font-medium">Value</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    <Package className="mx-auto mb-2 size-6 opacity-40" />
                    No inventory items match your filters.
                  </td>
                </tr>
              ) : (
                data.rows.map((item) => (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b last:border-0 hover:bg-muted/40",
                      !item.isActive && "opacity-60"
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.categoryName ?? "Uncategorised"}
                        {item.sku ? ` · ${item.sku}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <StockStatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      {item.currentStockLabel}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {item.minimumStockLabel}
                    </td>
                    <td className="px-4 py-2.5">{item.costPerUnitLabel}</td>
                    <td className="px-4 py-2.5">
                      {formatPaise(item.stockValuePaise)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="History"
                          aria-label={`View ${item.name}`}
                          onClick={() => setDetailId(item.id)}
                        >
                          <Eye className="size-3.5" />
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Adjust stock"
                              aria-label={`Adjust ${item.name}`}
                              onClick={() =>
                                setStockModal({ mode: "adjust", item })
                              }
                            >
                              <SlidersHorizontal className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Record wastage"
                              aria-label={`Wastage ${item.name}`}
                              onClick={() =>
                                setStockModal({ mode: "wastage", item })
                              }
                            >
                              <TriangleAlert className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Edit"
                              aria-label={`Edit ${item.name}`}
                              onClick={() =>
                                setItemForm({ open: true, initial: item })
                              }
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={item.isActive ? "Deactivate" : "Reactivate"}
                              aria-label={
                                item.isActive
                                  ? `Deactivate ${item.name}`
                                  : `Reactivate ${item.name}`
                              }
                              onClick={() => setConfirmItem(item)}
                            >
                              <Power
                                className={cn(
                                  "size-3.5",
                                  item.isActive
                                    ? "text-destructive"
                                    : "text-green-600"
                                )}
                              />
                            </Button>
                          </>
                        )}
                      </div>
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
          onPage={(page) => setParams({ page: String(page) })}
        />
      </div>

      {itemForm.open && (
        <ItemForm
          key={itemForm.initial?.id ?? "new"}
          initial={itemForm.initial}
          categories={categories}
          onClose={() => setItemForm({ open: false, initial: null })}
          onSaved={handleSaved}
        />
      )}

      {showPurchase && (
        <PurchaseForm
          onClose={() => setShowPurchase(false)}
          onSaved={handleSaved}
        />
      )}

      {stockModal && (
        <StockModal
          key={`${stockModal.mode}-${stockModal.item?.id ?? "any"}`}
          mode={stockModal.mode}
          item={stockModal.item}
          onClose={() => setStockModal(null)}
          onSaved={handleSaved}
        />
      )}

      {detailId && (
        <ItemDetailDialog
          itemId={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onEdit={(item) => {
            setDetailId(null);
            setItemForm({ open: true, initial: item });
          }}
          onAdjust={(item) => {
            setDetailId(null);
            setStockModal({ mode: "adjust", item });
          }}
          onWastage={(item) => {
            setDetailId(null);
            setStockModal({ mode: "wastage", item });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmItem)}
        title={
          confirmItem?.isActive
            ? `Deactivate ${confirmItem?.name}?`
            : `Reactivate ${confirmItem?.name}?`
        }
        message={
          confirmItem?.isActive
            ? "The item and its history are kept, but it will be hidden from stock operations."
            : "The item will become available again for stock operations."
        }
        confirmLabel={confirmItem?.isActive ? "Deactivate" : "Reactivate"}
        destructive={Boolean(confirmItem?.isActive)}
        pending={toggling}
        onConfirm={handleToggleActive}
        onClose={() => setConfirmItem(null)}
      />

      <ToastView toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
