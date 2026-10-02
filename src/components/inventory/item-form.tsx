"use client";

import { useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  baseUnitFor,
  fromBaseQuantity,
  isUnitCompatibleWithBase,
  unitLabel,
} from "@/lib/inventory/units";
import {
  createInventoryCategoryAction,
  createInventoryItemAction,
  updateInventoryItemAction,
} from "@/actions/inventory/actions";
import type { InventoryCategoryView, InventoryItemView } from "@/lib/inventory/types";

export function ItemForm({
  onClose,
  onSaved,
  categories: initialCategories,
  initial,
}: {
  onClose(): void;
  onSaved(message: string): void;
  categories: InventoryCategoryView[];
  initial?: InventoryItemView | null;
}) {
  const editing = Boolean(initial);
  const [categories, setCategories] = useState(initialCategories);
  const [newCategory, setNewCategory] = useState("");
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryPending, setCategoryPending] = useState(false);
  const categoryCreateRef = useRef<Promise<void> | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "none");
  const [unit, setUnit] = useState<InventoryUnit>(initial?.unit ?? "KG");
  const [minimumStock, setMinimumStock] = useState(
    initial ? String(fromBaseQuantity(initial.minimumStock, initial.unit)) : ""
  );
  const [cost, setCost] = useState(
    initial ? String(initial.costPerUnitPaise / 100) : ""
  );
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUnit = initial?.baseUnit ?? baseUnitFor(unit);
  const unitOptions = editing
    ? INVENTORY_UNITS.filter((u) => isUnitCompatibleWithBase(baseUnit, u))
    : INVENTORY_UNITS;

  async function handleCreateCategory() {
    const label = newCategory.trim();
    if (!label) return;
    setCategoryPending(true);
    const run = (async () => {
      const res = await createInventoryCategoryAction({ name: label });
      if (res.success && res.id) {
        setCategories((prev) => [
          ...prev,
          { id: res.id as string, name: label, displayOrder: prev.length, isActive: true, itemCount: 0 },
        ]);
        setCategoryId(res.id);
        setNewCategory("");
        setShowCategoryInput(false);
      } else {
        setError(res.message ?? "Could not create category.");
      }
    })().finally(() => setCategoryPending(false));
    categoryCreateRef.current = run;
    await run;
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    if (categoryCreateRef.current) await categoryCreateRef.current;
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      categoryId: categoryId === "none" ? null : categoryId,
      unit,
      minimumStock: minimumStock === "" ? 0 : Number(minimumStock),
      costPriceRupees: cost === "" ? 0 : Number(cost),
      sku: sku.trim() || null,
      isActive,
    };
    const res = editing
      ? await updateInventoryItemAction({ id: initial?.id, ...payload })
      : await createInventoryItemAction(payload);
    setSaving(false);
    if (res.success) {
      onSaved(res.message ?? "Saved.");
      onClose();
    } else {
      setError(res.message ?? "Save failed.");
    }
  }

  const disabled =
    saving || categoryPending || !name.trim() || minimumStock === "" || cost === "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>{editing ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing
              ? "Update this inventory item."
              : "Create a new inventory item."}
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
            <div className="grid gap-2">
              <Label htmlFor="item-name">Item name *</Label>
              <Input
                id="item-name"
                value={name}
                autoFocus
                placeholder="e.g. Paneer"
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select
                  value={categoryId}
                  onValueChange={(v) => setCategoryId(v ?? "none")}
                  items={[
                    { value: "none", label: "No category" },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No category</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!showCategoryInput ? (
                  <button
                    type="button"
                    className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
                    onClick={() => setShowCategoryInput(true)}
                  >
                    <Plus className="size-3" />
                    New category
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      value={newCategory}
                      placeholder="Category name"
                      className="h-8"
                      onChange={(e) => setNewCategory(e.currentTarget.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleCreateCategory}
                      disabled={!newCategory.trim()}
                    >
                      Add
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <Label>Unit *</Label>
                <Select
                  value={unit}
                  onValueChange={(v) => setUnit(v as InventoryUnit)}
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
                <p className="text-xs text-muted-foreground">
                  Stock is stored in {baseUnit}.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="item-min">
                  Minimum / reorder level ({unitLabel(unit)})
                </Label>
                <Input
                  id="item-min"
                  type="number"
                  min={0}
                  step="0.001"
                  value={minimumStock}
                  placeholder="e.g. 5"
                  onChange={(e) => setMinimumStock(e.currentTarget.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="item-cost">
                  Purchase cost (₹ per {unitLabel(unit)})
                </Label>
                <Input
                  id="item-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  value={cost}
                  placeholder="e.g. 280"
                  onChange={(e) => setCost(e.currentTarget.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="item-sku">SKU / code</Label>
              <Input
                id="item-sku"
                value={sku}
                placeholder="Optional"
                onChange={(e) => setSku(e.currentTarget.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="item-desc">Description</Label>
              <Textarea
                id="item-desc"
                value={description}
                placeholder="Optional notes about this item"
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label className="text-sm">Active</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Inactive items are hidden from stock operations.
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                aria-label="Item active"
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
            {saving ? "Saving…" : editing ? "Save Changes" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
