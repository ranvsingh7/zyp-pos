"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { VegMark } from "@/components/menu/veg-mark";
import {
  type MenuCategoryView,
  type MenuItemView,
} from "@/lib/menu/types";
import { paiseToRupees } from "@/lib/menu/prices";
import { GST_RATE_PRESETS } from "@/lib/billing/constants";
import {
  resolveTaxOverridePayload,
  resolveHsnSacPayload,
} from "@/lib/menu/tax-visibility";
import { HSN_SAC_CODE_MAX } from "@/lib/menu/constants";
import {
  createMenuItemAction,
  updateMenuItemAction,
} from "@/actions/menu/items";

interface VariantRow {
  id?: string;
  displayName: string;
  priceRupees: string;
  sizeValue: string;
  sizeUnit: string;
  active: boolean;
  displayOrder: number;
  taxOverrideEnabled: boolean;
  taxRatePercent: string;
  taxMode: string;
  taxType: string;
}

interface ItemFormState {
  name: string;
  description: string;
  categoryId: string;
  itemType: string;
  vegType: string;
  hasVariants: boolean;
  hsnSacCode: string;
  basePriceRupees: string;
  isAvailable: boolean;
  isActive: boolean;
  variants: VariantRow[];
  taxOverrideEnabled: boolean;
  taxRatePercent: string;
  taxMode: string;
  taxType: string;
}

function emptyVariantRow(order: number): VariantRow {
  return {
    displayName: "",
    priceRupees: "",
    sizeValue: "",
    sizeUnit: "",
    active: true,
    displayOrder: order,
    taxOverrideEnabled: false,
    taxRatePercent: "",
    taxMode: "",
    taxType: "",
  };
}

function defaults(firstCategoryId: string): ItemFormState {
  return {
    name: "",
    description: "",
    categoryId: firstCategoryId,
    itemType: "FOOD",
    vegType: "VEG",
    hasVariants: false,
    hsnSacCode: "",
    basePriceRupees: "",
    isAvailable: true,
    isActive: true,
    variants: [],
    taxOverrideEnabled: false,
    taxRatePercent: "",
    taxMode: "",
    taxType: "",
  };
}

function taxOverrideFields(
  override: MenuItemView["taxOverride"]
): Pick<
  ItemFormState,
  "taxOverrideEnabled" | "taxRatePercent" | "taxMode" | "taxType"
> {
  return {
    taxOverrideEnabled: override.enabled,
    taxRatePercent: override.taxRatePercent != null ? String(override.taxRatePercent) : "",
    taxMode: override.taxMode ?? "",
    taxType: override.taxType ?? "",
  };
}

function toVariantRows(item: MenuItemView): VariantRow[] {
  return item.variants.map((v) => ({
    id: v.id,
    displayName: v.displayName,
    priceRupees: String(Math.round(paiseToRupees(v.pricePaise) * 100) / 100),
    sizeValue: v.sizeValue != null ? String(v.sizeValue) : "",
    sizeUnit: v.sizeUnit ?? "",
    active: v.isActive,
    displayOrder: v.displayOrder,
    taxOverrideEnabled: v.taxOverride.enabled,
    taxRatePercent: v.taxOverride.taxRatePercent != null ? String(v.taxOverride.taxRatePercent) : "",
    taxMode: v.taxOverride.taxMode ?? "",
    taxType: v.taxOverride.taxType ?? "",
  }));
}

const SIZE_UNITS = ["", "ML", "L", "GM", "KG", "PCS"];
const ITEM_TYPES = ["FOOD", "BEVERAGE", "OTHER"];
const VEG_TYPES = ["VEG", "NON_VEG", "EGG", "NA"];

const VEG_LABEL: Record<string, string> = {
  VEG: "Veg",
  NON_VEG: "Non-veg",
  EGG: "Egg",
  NA: "Not specified",
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  FOOD: "Food",
  BEVERAGE: "Beverage",
  OTHER: "Other",
};

function gstRatePresetValue(rate: string): string {
  if (rate === "") return "custom";
  const n = Number(rate);
  if (Number.isFinite(n) && (GST_RATE_PRESETS as readonly number[]).includes(n)) return String(n);
  return "custom";
}

export function ItemForm({
  open,
  onClose,
  categories,
  initial,
  onSaved,
  gstEnabled,
}: {
  open: boolean;
  onClose: () => void;
  categories: MenuCategoryView[];
  initial: MenuItemView | null;
  onSaved: () => void;
  /** GST registration is the master control: when false the tax/GST
   *  override controls are hidden for items and variants. */
  gstEnabled: boolean;
}) {
  const [form, setForm] = useState<ItemFormState>(() => {
    if (initial) {
      return {
        name: initial.name,
        description: initial.description ?? "",
        categoryId: initial.categoryId,
        itemType: initial.itemType,
        vegType: initial.vegType,
        hasVariants: initial.hasVariants,
        hsnSacCode: initial.hsnSacCode ?? "",
        basePriceRupees: initial.basePrice != null
          ? String(Math.round(paiseToRupees(initial.basePrice) * 100) / 100)
          : "",
        isAvailable: initial.isAvailable,
        isActive: initial.isActive,
        variants: toVariantRows(initial),
        ...taxOverrideFields(initial.taxOverride),
      };
    }
    return defaults(categories[0]?.id ?? "");
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback(
    <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    []
  );

  function addVariant() {
    setForm((prev) => ({
      ...prev,
      variants: [
        ...prev.variants,
        emptyVariantRow(prev.variants.length),
      ],
    }));
  }

  function removeVariant(idx: number) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((r, i) =>
        i === idx ? { ...r, active: false } : r
      ),
    }));
  }

  function updateVariant(idx: number, field: keyof VariantRow, value: string | boolean) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((r, i) =>
        i === idx ? { ...r, [field]: value } : r
      ),
    }));
  }

  function moveVariant(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= form.variants.length) return;
    setForm((prev) => {
      const rows = [...prev.variants];
      [rows[idx], rows[target]] = [rows[target], rows[idx]];
      return { ...prev, variants: rows };
    });
  }

  function toggleItemTaxOverride(enabled: boolean) {
    setForm((prev) => ({
      ...prev,
      taxOverrideEnabled: enabled,
      taxRatePercent: enabled && prev.taxRatePercent === "" ? "5" : prev.taxRatePercent,
    }));
  }

  function setItemTaxRateFromPreset(value: string) {
    if (value === "custom") {
      setForm((prev) => ({ ...prev, taxRatePercent: "" }));
      return;
    }
    setForm((prev) => ({ ...prev, taxRatePercent: String(Number(value)) }));
  }

  function toggleVariantTaxOverride(idx: number, enabled: boolean) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((r, i) =>
        i === idx
          ? {
              ...r,
              taxOverrideEnabled: enabled,
              taxRatePercent: enabled && r.taxRatePercent === "" ? "5" : r.taxRatePercent,
            }
          : r
      ),
    }));
  }

  function setVariantTaxRateFromPreset(idx: number, value: string) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((r, i) =>
        i === idx
          ? {
              ...r,
              taxRatePercent:
                value === "custom" ? "" : String(Number(value)),
            }
          : r
      ),
    }));
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Item name is required.";
    if (!form.categoryId) return "Select a category.";
    if (!form.hasVariants && !form.basePriceRupees) return "Base price is required.";
    if (gstEnabled && form.hsnSacCode.trim().length > HSN_SAC_CODE_MAX) {
      return `HSN/SAC code must be ${HSN_SAC_CODE_MAX} characters or fewer.`;
    }

    const validateOverride = (part: {
      taxOverrideEnabled: boolean;
      taxRatePercent: string;
      taxMode: string;
      taxType: string;
      label: string;
    }): string | null => {
      if (!part.taxOverrideEnabled) return null;
      const rate = Number(part.taxRatePercent);
      if (
        part.taxRatePercent === "" ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        rate > 100
      ) {
        return `${part.label}: enter a valid GST rate (0–100%).`;
      }
      if (!part.taxMode) return `${part.label}: select a tax mode (Inclusive/Exclusive).`;
      if (!part.taxType) return `${part.label}: select a tax type (CGST+SGST/IGST).`;
      return null;
    };

    const itemTaxError = gstEnabled
      ? validateOverride({
          taxOverrideEnabled: form.taxOverrideEnabled,
          taxRatePercent: form.taxRatePercent,
          taxMode: form.taxMode,
          taxType: form.taxType,
          label: form.name.trim() || "This item",
        })
      : null;
    if (itemTaxError) return itemTaxError;

    if (form.hasVariants) {
      const active = form.variants.filter((r) => r.active);
      if (active.length === 0) return "Add at least one active variant.";
      for (const r of active) {
        if (!r.displayName.trim()) return "Each variant needs a name.";
        if (!r.priceRupees) return `Price is required for "${r.displayName || "unnamed variant"}".`;
        if (r.sizeUnit && (!r.sizeValue || Number(r.sizeValue) <= 0)) {
          return `Size value is required and must be positive for "${r.displayName}".`;
        }
        if (!r.sizeUnit && r.sizeValue && Number(r.sizeValue) > 0) {
          return `Size unit is required for "${r.displayName}".`;
        }
      }
      // duplicate displayName (case-insensitive)
      const names = new Set<string>();
      for (const r of active) {
        const k = r.displayName.trim().toLowerCase();
        if (names.has(k)) return `Duplicate variant name "${r.displayName}".`;
        names.add(k);
      }
      if (gstEnabled) {
        for (const r of active) {
          const variantTaxError = validateOverride({
            taxOverrideEnabled: r.taxOverrideEnabled,
            taxRatePercent: r.taxRatePercent,
            taxMode: r.taxMode,
            taxType: r.taxType,
            label: `Variant "${r.displayName || "unnamed"}"`,
          });
          if (variantTaxError) return variantTaxError;
        }
      }
    }
    return null;
  }

  async function handleSubmit() {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      categoryId: form.categoryId,
      itemType: form.itemType,
      vegType: form.vegType,
      hasVariants: form.hasVariants,
      hsnSacCode: resolveHsnSacPayload(gstEnabled, initial?.hsnSacCode, form.hsnSacCode),
      basePriceRupees: form.hasVariants ? null : Number(form.basePriceRupees),
      isAvailable: form.isAvailable,
      isActive: form.isActive,
      displayOrder: initial?.displayOrder ?? 0,
      variants: form.hasVariants
        ? form.variants
            .filter((r) => r.active)
            .map((r, i) => ({
              id: r.id,
              displayName: r.displayName.trim(),
              priceRupees: Number(r.priceRupees),
              sizeValue: r.sizeValue ? Number(r.sizeValue) : null,
              sizeUnit: r.sizeUnit || null,
              isActive: true,
              displayOrder: i,
              taxOverride: resolveTaxOverridePayload(
                gstEnabled,
                initial?.variants.find((v) => v.id === r.id)?.taxOverride,
                r
              ),
            }))
        : [],
      taxOverride: resolveTaxOverridePayload(gstEnabled, initial?.taxOverride, form),
    };

    const res = initial
      ? await updateMenuItemAction({ id: initial.id, ...payload })
      : await createMenuItemAction(payload);

    setSaving(false);
    if (res.success) {
      onSaved();
      onClose();
    } else {
      setError(res.message ?? "Save failed.");
    }
  }

  const activeVariants = form.variants.filter((r) => r.active);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {initial ? "Edit Menu Item" : "Add Menu Item"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {initial ? "Edit existing menu item details." : "Add a new menu item to your restaurant."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error && (
            <div role="alert" className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-4">
            {/* Name */}
            <div className="grid gap-1.5">
              <Label htmlFor="item-name">Item Name</Label>
              <Input
                id="item-name"
                value={form.name}
                onChange={(e) => updateField("name", e.currentTarget.value)}
                placeholder="e.g. Paneer Butter Masala"
              />
            </div>

            {/* Description */}
            <div className="grid gap-1.5">
              <Label htmlFor="item-desc">Description (optional)</Label>
              <Textarea
                id="item-desc"
                value={form.description}
                onChange={(e) => updateField("description", e.currentTarget.value)}
                rows={2}
                placeholder="Short description for the menu"
              />
            </div>

            {/* Category */}
            <div className="grid gap-1.5">
              <Label htmlFor="item-category">Category</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => updateField("categoryId", v ?? "")}
              >
                <SelectTrigger id="item-category" className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* VegType */}
            <div className="grid gap-1.5">
              <span className="text-sm leading-none font-medium">Food Type</span>
              <div className="flex flex-wrap gap-1">
                {VEG_TYPES.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={form.vegType === type ? "default" : "outline"}
                    size="sm"
                    aria-pressed={form.vegType === type}
                    onClick={() => updateField("vegType", type)}
                    className="flex items-center gap-1"
                  >
                    <VegMark vegType={type} />
                    {VEG_LABEL[type]}
                  </Button>
                ))}
              </div>
            </div>

            {/* Item type */}
            <div className="grid gap-1.5">
              <span className="text-sm leading-none font-medium">Item Type</span>
              <div className="flex flex-wrap gap-1">
                {ITEM_TYPES.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={form.itemType === type ? "default" : "outline"}
                    size="sm"
                    aria-pressed={form.itemType === type}
                    onClick={() => updateField("itemType", type)}
                  >
                    {ITEM_TYPE_LABEL[type]}
                  </Button>
                ))}
              </div>
            </div>

            {/* Availability & Active */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Available</Label>
                <Switch
                  checked={form.isAvailable}
                  onCheckedChange={(v) => updateField("isAvailable", v)}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Active</Label>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => updateField("isActive", v)}
                />
              </div>
            </div>

            {/* Has variants */}
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <Label className="text-sm">Has Variants</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Turn on to offer sizes like Half / Full, 200 ml / 500 ml
                </p>
              </div>
              <Switch
                checked={form.hasVariants}
                onCheckedChange={(v) => updateField("hasVariants", v)}
              />
            </div>

            {/* HSN/SAC — GST classification, so only shown for GST-enabled
                restaurants. Variants inherit the parent item's code. */}
            {gstEnabled && (
              <div className="grid gap-1.5">
                <Label htmlFor="item-hsn-sac">HSN / SAC Code (optional)</Label>
                <Input
                  id="item-hsn-sac"
                  value={form.hsnSacCode}
                  onChange={(e) => updateField("hsnSacCode", e.currentTarget.value)}
                  maxLength={HSN_SAC_CODE_MAX}
                  placeholder="e.g. 996311"
                  aria-describedby="item-hsn-sac-help"
                />
                <p
                  id="item-hsn-sac-help"
                  className="text-xs text-muted-foreground"
                >
                  Enter the HSN (goods) or SAC (services) code your accountant
                  applies to this item. It appears on the bill for your records.
                </p>
              </div>
            )}

            {/* Tax (GST) Override — only shown when the restaurant is GST-enabled */}
            {gstEnabled && (
              <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm">Tax (GST) Override</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Off = use the restaurant default GST (e.g. 5% CGST + SGST)
                  </p>
                </div>
                <Switch
                  checked={form.taxOverrideEnabled}
                  onCheckedChange={toggleItemTaxOverride}
                  aria-label="Enable item GST override"
                />
              </div>
              {form.taxOverrideEnabled && (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="grid min-w-[120px] flex-1 gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      GST Rate
                    </span>
                    <Select
                      value={gstRatePresetValue(form.taxRatePercent)}
                      onValueChange={(value) => setItemTaxRateFromPreset(value ?? "")}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GST_RATE_PRESETS.map((rate) => (
                          <SelectItem key={rate} value={String(rate)}>
                            {rate}%
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {gstRatePresetValue(form.taxRatePercent) === "custom" && (
                    <div className="grid min-w-[120px] flex-1 gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        Custom rate (%)
                      </span>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={form.taxRatePercent}
                        onChange={(e) => updateField("taxRatePercent", e.currentTarget.value)}
                        placeholder="e.g. 18"
                        className="h-9"
                        aria-label="Custom GST rate"
                      />
                    </div>
                  )}
                  <div className="grid min-w-[130px] flex-1 gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Tax Mode
                    </span>
                    <Select
                      value={form.taxMode}
                      onValueChange={(v) => updateField("taxMode", v ?? "")}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EXCLUSIVE">Exclusive</SelectItem>
                        <SelectItem value="INCLUSIVE">Inclusive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-[130px] flex-1 gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Tax Type
                    </span>
                    <Select
                      value={form.taxType}
                      onValueChange={(v) => updateField("taxType", v ?? "")}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CGST_SGST">CGST + SGST</SelectItem>
                        <SelectItem value="IGST">IGST</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              </div>
            )}

            {/* Base price */}
            {!form.hasVariants && (
              <div className="grid gap-1.5">
                <Label htmlFor="item-price">Base Price (₹)</Label>
                <Input
                  id="item-price"
                  type="number"
                  step="0.50"
                  min="0"
                  value={form.basePriceRupees}
                  onChange={(e) => updateField("basePriceRupees", e.currentTarget.value)}
                  placeholder="0"
                />
              </div>
            )}

            {/* Variants table */}
            {form.hasVariants && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm leading-none font-medium">Variants</span>
                  <Button type="button" variant="outline" size="sm" onClick={addVariant}>
                    <Plus className="mr-1 size-3" />
                    Add Variant
                  </Button>
                </div>

                {activeVariants.length === 0 && (
                  <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                    No active variants. Click &quot;Add Variant&quot; to create one.
                  </p>
                )}

                <div className="space-y-2">
                  {form.variants.map((row, idx) =>
                    !row.active ? null : (
                      <div
                        key={idx}
                        className="rounded-lg border bg-muted/30 p-3"
                      >
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_110px_90px_90px_auto] sm:items-end">
                          <div className="grid gap-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              Name
                            </span>
                            <Input
                              value={row.displayName}
                              onChange={(e) =>
                                updateVariant(idx, "displayName", e.currentTarget.value)
                              }
                              placeholder="Half"
                              className="h-8"
                              aria-label={`Variant name ${idx + 1}`}
                            />
                          </div>
                          <div className="grid gap-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              Price (₹)
                            </span>
                            <Input
                              type="number"
                              step="0.50"
                              min="0"
                              value={row.priceRupees}
                              onChange={(e) =>
                                updateVariant(idx, "priceRupees", e.currentTarget.value)
                              }
                              placeholder="0"
                              className="h-8"
                              aria-label={`Variant price ${idx + 1}`}
                            />
                          </div>
                          <div className="grid gap-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              Size value
                            </span>
                            <Input
                              type="number"
                              step="1"
                              min="0"
                              value={row.sizeValue}
                              onChange={(e) =>
                                updateVariant(idx, "sizeValue", e.currentTarget.value)
                              }
                              placeholder="—"
                              className="h-8"
                              aria-label={`Variant size value ${idx + 1}`}
                            />
                          </div>
                          <div className="grid gap-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              Unit
                            </span>
                            <select
                              value={row.sizeUnit}
                              onChange={(e) =>
                                updateVariant(idx, "sizeUnit", e.currentTarget.value)
                              }
                              aria-label={`Variant size unit ${idx + 1}`}
                              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
                            >
                              {SIZE_UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u || "—"}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1 sm:justify-start">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground"
                              onClick={() => moveVariant(idx, -1)}
                              disabled={idx === 0}
                              aria-label="Move variant up"
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground"
                              onClick={() => moveVariant(idx, 1)}
                              disabled={idx === form.variants.length - 1}
                              aria-label="Move variant down"
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeVariant(idx)}
                              aria-label={`Remove variant ${idx + 1}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        {gstEnabled && (
                          <div className="mt-3 border-t border-border/60 pt-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                              Tax (GST) Override
                            </span>
                            <Switch
                              checked={row.taxOverrideEnabled}
                              onCheckedChange={(v) => toggleVariantTaxOverride(idx, v)}
                              aria-label={`Enable GST override for variant ${idx + 1}`}
                            />
                          </div>
                          {row.taxOverrideEnabled && (
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <div className="grid min-w-[110px] flex-1 gap-1">
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  GST Rate
                                </span>
                                <Select
                                  value={gstRatePresetValue(row.taxRatePercent)}
                                  onValueChange={(value) =>
                                    setVariantTaxRateFromPreset(idx, value ?? "")
                                  }
                                >
                                  <SelectTrigger className="h-8 w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {GST_RATE_PRESETS.map((rate) => (
                                      <SelectItem key={rate} value={String(rate)}>
                                        {rate}%
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="custom">Custom</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {gstRatePresetValue(row.taxRatePercent) === "custom" && (
                                <div className="grid min-w-[110px] flex-1 gap-1">
                                  <span className="text-[10px] font-medium text-muted-foreground">
                                    Custom rate (%)
                                  </span>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.5"
                                    value={row.taxRatePercent}
                                    onChange={(e) =>
                                      updateVariant(idx, "taxRatePercent", e.currentTarget.value)
                                    }
                                    placeholder="e.g. 18"
                                    className="h-8"
                                    aria-label={`Custom GST rate for variant ${idx + 1}`}
                                  />
                                </div>
                              )}
                              <div className="grid min-w-[120px] flex-1 gap-1">
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  Tax Mode
                                </span>
                                <Select
                                  value={row.taxMode}
                                  onValueChange={(value) =>
                                    updateVariant(idx, "taxMode", value ?? "")
                                  }
                                >
                                  <SelectTrigger className="h-8 w-full">
                                    <SelectValue placeholder="Mode" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="EXCLUSIVE">Exclusive</SelectItem>
                                    <SelectItem value="INCLUSIVE">Inclusive</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid min-w-[120px] flex-1 gap-1">
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  Tax Type
                                </span>
                                <Select
                                  value={row.taxType}
                                  onValueChange={(value) =>
                                    updateVariant(idx, "taxType", value ?? "")
                                  }
                                >
                                  <SelectTrigger className="h-8 w-full">
                                    <SelectValue placeholder="Type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="CGST_SGST">CGST + SGST</SelectItem>
                                    <SelectItem value="IGST">IGST</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={handleSubmit}>
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
            {saving ? "Saving…" : initial ? "Save Changes" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}