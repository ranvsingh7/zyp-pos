"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
  INVENTORY_UNITS,
  type InventoryUnit,
} from "@/lib/inventory/constants";
import { isUnitCompatibleWithBase, unitLabel } from "@/lib/inventory/units";
import { formatPaise } from "@/lib/menu/prices";
import { ItemPicker } from "@/components/inventory/item-picker";
import { createPurchaseAction } from "@/actions/inventory/actions";
import type { InventoryItemView } from "@/lib/inventory/types";

interface LineState {
  key: string;
  item: InventoryItemView | null;
  quantity: string;
  unit: InventoryUnit;
  rate: string;
}

const EMPTY_LINE: LineState = {
  key: "line-0",
  item: null,
  quantity: "",
  unit: "KG",
  rate: "",
};

function todayYmd(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function PurchaseForm({
  onClose,
  onSaved,
}: {
  onClose(): void;
  onSaved(message: string): void;
}) {
  const idempotencyKey = useRef<string | null>(null);
  const lineCounter = useRef(0);

  function getIdempotencyKey(): string {
    if (!idempotencyKey.current) {
      idempotencyKey.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `purchase-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return idempotencyKey.current;
  }

  function addLine() {
    lineCounter.current += 1;
    setLines((prev) => [
      ...prev,
      { ...EMPTY_LINE, key: `line-${lineCounter.current}` },
    ]);
  }

  const [lines, setLines] = useState<LineState[]>([EMPTY_LINE]);
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayYmd());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function handleSelectItem(key: string, item: InventoryItemView | null) {
    updateLine(key, {
      item,
      unit: item?.unit ?? "KG",
      rate:
        item && item.costPerUnitPaise > 0
          ? String(item.costPerUnitPaise / 100)
          : "",
    });
  }

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Number(line.quantity) || 0;
        const rate = Number(line.rate) || 0;
        return sum + qty * rate;
      }, 0),
    [lines]
  );

  const validLines = lines.filter(
    (line) =>
      line.item && (Number(line.quantity) || 0) > 0 && (Number(line.rate) || 0) >= 0
  );

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const payload = {
      supplierName: supplierName.trim() || null,
      invoiceNumber: invoiceNumber.trim() || null,
      purchaseDate: purchaseDate
        ? new Date(`${purchaseDate}T12:00:00`)
        : undefined,
      notes: notes.trim() || null,
      idempotencyKey: getIdempotencyKey(),
      items: validLines.map((line) => ({
        inventoryItemId: line.item?.id,
        quantity: Number(line.quantity),
        unit: line.unit,
        purchaseRateRupees: Number(line.rate) || 0,
      })),
    };
    const res = await createPurchaseAction(payload);
    setSaving(false);
    if (res.success) {
      onSaved(res.message ?? "Purchase recorded.");
      onClose();
    } else {
      setError(res.message ?? "Could not record purchase.");
    }
  }

  const disabled = saving || validLines.length !== lines.length || lines.length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Record Purchase (Add Stock)</DialogTitle>
          <DialogDescription>
            Stock is increased immediately and a purchase entry is saved.
          </DialogDescription>
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
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="purchase-supplier">Supplier</Label>
                <Input
                  id="purchase-supplier"
                  value={supplierName}
                  placeholder="Optional"
                  onChange={(e) => setSupplierName(e.currentTarget.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="purchase-invoice">Invoice number</Label>
                <Input
                  id="purchase-invoice"
                  value={invoiceNumber}
                  placeholder="Optional"
                  onChange={(e) => setInvoiceNumber(e.currentTarget.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="purchase-date">Purchase date</Label>
                <Input
                  id="purchase-date"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.currentTarget.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-sm font-medium">Items</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                >
                  <Plus className="size-3.5" />
                  Add item
                </Button>
              </div>

              <div className="flex flex-col divide-y">
                {lines.map((line) => {
                  const unitOptions = line.item
                    ? INVENTORY_UNITS.filter((u) =>
                        isUnitCompatibleWithBase(line.item!.baseUnit, u)
                      )
                    : INVENTORY_UNITS;
                  const total = (Number(line.quantity) || 0) * (Number(line.rate) || 0);
                  return (
                    <div
                      key={line.key}
                      className="grid items-end gap-2 p-3 sm:grid-cols-[minmax(0,2fr)_5rem_5rem_6rem_auto]"
                    >
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Item
                        </Label>
                        <ItemPicker
                          value={line.item}
                          onSelect={(item) => handleSelectItem(line.key, item)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Qty
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.001"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.key, {
                              quantity: e.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Unit
                        </Label>
                        <Select
                          value={line.unit}
                          onValueChange={(v) =>
                            updateLine(line.key, { unit: v as InventoryUnit })
                          }
                        >
                          <SelectTrigger className="w-full">
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
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Rate (₹/{line.item ? unitLabel(line.unit) : "unit"})
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.rate}
                          onChange={(e) =>
                            updateLine(line.key, { rate: e.currentTarget.value })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-start">
                        <span className="text-sm font-medium sm:pb-1.5">
                          {formatPaise(Math.round(total * 100))}
                        </span>
                        {lines.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Remove line"
                            onClick={() =>
                              setLines((prev) =>
                                prev.filter((l) => l.key !== line.key)
                              )
                            }
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t px-3 py-2">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="font-heading text-lg font-semibold">
                  {formatPaise(Math.round(subtotal * 100))}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="purchase-notes">Notes</Label>
              <Textarea
                id="purchase-notes"
                value={notes}
                placeholder="Optional"
                onChange={(e) => setNotes(e.currentTarget.value)}
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
            {saving ? "Saving…" : "Save Purchase"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
