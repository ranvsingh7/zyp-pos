"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { StockStatusBadge } from "@/components/inventory/status-badge";
import { formatPaise } from "@/lib/menu/prices";
import { getInventoryItemDetailAction } from "@/actions/inventory/actions";
import type {
  InventoryItemView,
  StockMovementView,
} from "@/lib/inventory/types";
import { formatDateTime } from "@/lib/format/date";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function ItemDetailDialog({
  itemId,
  canManage,
  onClose,
  onEdit,
  onAdjust,
  onWastage,
}: {
  itemId: string;
  canManage: boolean;
  onClose(): void;
  onEdit(item: InventoryItemView): void;
  onAdjust(item: InventoryItemView): void;
  onWastage(item: InventoryItemView): void;
}) {
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState<InventoryItemView | null>(null);
  const [movements, setMovements] = useState<StockMovementView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await getInventoryItemDetailAction({ id: itemId });
      if (cancelled) return;
      if (res.success && res.data) {
        setItem(res.data.item);
        setMovements(res.data.movements);
      } else {
        setError(res.message ?? "Could not load item.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>{item?.name ?? "Item"}</DialogTitle>
          <DialogDescription>
            {item?.categoryName ?? "Inventory item details"}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error || !item ? (
            <p className="py-6 text-center text-sm text-destructive">
              {error ?? "Item not found."}
            </p>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-1">
                <InfoRow
                  label="Status"
                  value={<StockStatusBadge status={item.status} />}
                />
                <InfoRow label="Current stock" value={item.currentStockLabel} />
                <InfoRow
                  label="Minimum level"
                  value={item.minimumStockLabel}
                />
                <InfoRow
                  label={`Cost per ${item.unit}`}
                  value={item.costPerUnitLabel}
                />
                <InfoRow
                  label="Estimated value"
                  value={formatPaise(item.stockValuePaise)}
                />
                {item.sku && <InfoRow label="SKU" value={item.sku} />}
                {item.description && (
                  <InfoRow label="Description" value={item.description} />
                )}
                {!item.isActive && (
                  <InfoRow
                    label="State"
                    value={<span className="text-amber-600">Inactive</span>}
                  />
                )}
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-sm font-medium">Recent movements</p>
                {movements.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No stock movements yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {movements.map((movement) => (
                      <li
                        key={movement.id}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {movement.quantityLabel} · {movement.type.replace(/_/g, " ")}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatDateTime(movement.createdAt)}
                            {movement.reason ? ` · ${movement.reason}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {movement.beforeStockLabel} → {movement.afterStockLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogBody>

        {item && canManage && (
          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAdjust(item)}
              >
                <SlidersHorizontal className="size-3.5" />
                Adjust
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onWastage(item)}
              >
                <TriangleAlert className="size-3.5" />
                Wastage
              </Button>
            </div>
            <Button variant="secondary" size="sm" onClick={() => onEdit(item)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          </DialogFooter>
        )}
      </DialogPopup>
    </Dialog>
  );
}
