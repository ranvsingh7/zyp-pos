"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ADJUSTMENT_REASONS,
  CONSUMPTION_REASONS,
  INVENTORY_UNITS,
  WASTAGE_REASONS,
  type InventoryUnit,
} from "@/lib/inventory/constants";
import {
  formatStockQuantity,
  isUnitCompatibleWithBase,
  toBaseQuantity,
} from "@/lib/inventory/units";
import { ItemPicker } from "@/components/inventory/item-picker";
import {
  adjustStockAction,
  recordConsumptionAction,
  recordWastageAction,
} from "@/actions/inventory/actions";
import type { InventoryItemView } from "@/lib/inventory/types";

export type StockModalMode = "adjust" | "wastage" | "consumption";

const TITLES: Record<StockModalMode, string> = {
  adjust: "Stock Adjustment",
  wastage: "Record Wastage",
  consumption: "Record Consumption",
};

const DESCRIPTIONS: Record<StockModalMode, string> = {
  adjust: "Correct the recorded balance after a physical count or opening stock.",
  wastage: "Remove spoiled, damaged or expired stock.",
  consumption: "Remove stock used in the kitchen or by staff.",
};

function reasonsFor(mode: StockModalMode): readonly string[] {
  if (mode === "wastage") return WASTAGE_REASONS;
  if (mode === "consumption") return CONSUMPTION_REASONS;
  return ADJUSTMENT_REASONS;
}

export function StockModal({
  mode,
  item,
  onClose,
  onSaved,
}: {
  mode: StockModalMode;
  item?: InventoryItemView | null;
  onClose(): void;
  onSaved(message: string): void;
}) {
  const [selected, setSelected] = useState<InventoryItemView | null>(
    item ?? null
  );
  const [adjustMode, setAdjustMode] = useState<"ADD" | "REMOVE">("ADD");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<InventoryUnit>(item?.unit ?? "KG");
  const [reason, setReason] = useState(reasonsFor(mode)[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitOptions = selected
    ? INVENTORY_UNITS.filter((u) =>
        isUnitCompatibleWithBase(selected.baseUnit, u)
      )
    : INVENTORY_UNITS;

  function handleSelect(next: InventoryItemView | null) {
    setSelected(next);
    if (next) setUnit(next.unit);
  }

  const numericQuantity = quantity === "" ? 0 : Number(quantity);
  let preview: string | null = null;
  if (selected && numericQuantity > 0) {
    const delta = toBaseQuantity(numericQuantity, unit);
    const removing = mode !== "adjust" || adjustMode === "REMOVE";
    const next = removing
      ? selected.currentStock - delta
      : selected.currentStock + delta;
    preview =
      next < 0
        ? "Not enough stock"
        : `New balance: ${formatStockQuantity(next, unit)}`;
  }

  async function handleSubmit() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const base = {
      itemId: selected.id,
      quantity: numericQuantity,
      unit,
      reason,
      note: note.trim() || null,
    };
    const res =
      mode === "adjust"
        ? await adjustStockAction({ ...base, mode: adjustMode })
        : mode === "wastage"
          ? await recordWastageAction(base)
          : await recordConsumptionAction(base);
    setSaving(false);
    if (res.success) {
      onSaved(res.message ?? "Stock updated.");
      onClose();
    } else {
      setError(res.message ?? "Could not update stock.");
    }
  }

  const disabled =
    saving || !selected || numericQuantity <= 0 || !reason.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>{TITLES[mode]}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[mode]}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error && (
            <div
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="grid gap-4 py-1">
            {!item && (
              <div className="grid gap-2">
                <Label>Item *</Label>
                <ItemPicker
                  value={selected}
                  onSelect={handleSelect}
                  autoFocus
                />
              </div>
            )}

            {mode === "adjust" && (
              <div className="grid gap-2">
                <Label>Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={adjustMode === "ADD" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAdjustMode("ADD")}
                  >
                    Add stock
                  </Button>
                  <Button
                    type="button"
                    variant={adjustMode === "REMOVE" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAdjustMode("REMOVE")}
                  >
                    Remove stock
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="grid gap-2">
                <Label htmlFor="stock-qty">Quantity *</Label>
                <Input
                  id="stock-qty"
                  type="number"
                  min={0}
                  step="0.001"
                  value={quantity}
                  autoFocus={Boolean(item)}
                  placeholder="e.g. 2.5"
                  onChange={(e) => setQuantity(e.currentTarget.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Unit</Label>
                <Select
                  value={unit}
                  onValueChange={(v) => setUnit(v as InventoryUnit)}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selected && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Available: {selected.currentStockLabel}
                {preview ? ` · ${preview}` : ""}
              </p>
            )}

            <div className="grid gap-2">
              <Label>Reason *</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v ?? reasonsFor(mode)[0])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reasonsFor(mode).map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="stock-note">Note</Label>
              <Textarea
                id="stock-note"
                value={note}
                placeholder="Optional details"
                onChange={(e) => setNote(e.currentTarget.value)}
              />
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={disabled} onClick={handleSubmit}>
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
            {saving ? "Saving…" : TITLES[mode]}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
