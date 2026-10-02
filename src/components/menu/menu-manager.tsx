"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type {
  MenuCategoryView,
  MenuItemView,
} from "@/lib/menu/types";
import { VegMark } from "@/components/menu/veg-mark";
import { CategoryManager } from "@/components/menu/category-manager";
import { ItemForm } from "@/components/menu/item-form";
import { ConfirmDialog } from "@/components/menu/confirm-dialog";
import { ToastView, type ToastData } from "@/components/menu/toast";
import {
  deleteMenuItemAction,
  toggleMenuItemAvailabilityAction,
  toggleMenuItemStatusAction,
} from "@/actions/menu/items";

interface MenuManagerProps {
  canEdit: boolean;
  canToggleAvailability: boolean;
  gstEnabled: boolean;
  categories: MenuCategoryView[];
  items: MenuItemView[];
}

export function MenuManager({
  canEdit,
  canToggleAvailability,
  gstEnabled,
  categories,
  items,
}: MenuManagerProps) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [vegFilter, setVegFilter] = useState<string>("all");
  const [availFilter, setAvailFilter] = useState<string>("all");
  const [varFilter, setVarFilter] = useState<string>("all");

  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [itemEditor, setItemEditor] = useState<
    | null
    | { mode: "create" }
    | { mode: "edit"; item: MenuItemView }
  >(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((kind: ToastData["kind"], message: string) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast({ kind, message });
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const activeCategories = categories.filter((c) => c.isActive);
  const categoryMap = new Map(
    categories.map((c) => [c.id, c])
  );

  const filtered = items.filter((item) => {
    if (item.name.toLowerCase().indexOf(debounced.toLowerCase()) === -1) return false;
    if (catFilter !== "all" && item.categoryId !== catFilter) return false;
    if (vegFilter !== "all" && item.vegType !== vegFilter) return false;
    if (availFilter === "available" && !item.isAvailable) return false;
    if (availFilter === "unavailable" && item.isAvailable) return false;
    if (varFilter === "variants" && !item.hasVariants) return false;
    if (varFilter === "plain" && item.hasVariants) return false;
    if (!item.isActive) return true;
    return true;
  });

  function refresh() {
    router.refresh();
  }

  function onMutation(kind: "success" | "error", message: string) {
    refresh();
    showToast(kind, message);
  }

  async function runConfirmAction() {
    setConfirmPending(true);
    try {
      await confirmState?.action();
      onMutation("success", "Done.");
    } catch (e: unknown) {
      onMutation("error", e instanceof Error ? e.message : "Action failed.");
    } finally {
      setConfirmPending(false);
      setConfirmState(null);
    }
  }

  function promptDelete(item: MenuItemView) {
    setConfirmState({
      title: `Delete "${item.name}"?`,
      message:
        "This item will be permanently removed from your menu. You can recreate it later.",
      action: async () => {
        const res = await deleteMenuItemAction({ id: item.id });
        if (!res.success) throw new Error(res.message);
      },
    });
  }

  async function handleQuickStatus(item: MenuItemView, activate: boolean) {
    const res = await toggleMenuItemStatusAction({
      id: item.id,
      isActive: activate,
    });
    if (res.success) onMutation("success", activate ? "Item enabled." : "Item disabled.");
    else onMutation("error", res.message ?? "Update failed.");
  }

  async function handleQuickAvailability(
    item: MenuItemView,
    available: boolean
  ) {
    const res = await toggleMenuItemAvailabilityAction({
      id: item.id,
      isAvailable: available,
    });
    if (res.success)
      onMutation("success", available ? "Marked available." : "Marked unavailable.");
    else onMutation("error", res.message ?? "Update failed.");
  }

  function variantSummary(item: MenuItemView) {
    if (!item.hasVariants) {
      return item.basePrice != null
        ? `₹${Math.round(item.basePrice / 100)}`
        : "—";
    }
    const active = item.variants.filter((v) => v.isActive);
    if (active.length === 0) return "No variants";
    const list = active
      .slice(0, 3)
      .map((v) => `${v.displayName} ₹${Math.round(v.pricePaise / 100)}`)
      .join(" · ");
    if (active.length > 3) return `${list} +${active.length - 3}`;
    return list;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-8 sm:px-6">
        {/* Page header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Menu
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your dishes, categories, and availability.
            </p>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCatManagerOpen(true)}
              >
                <Plus className="mr-1 size-3.5" />
                Categories
              </Button>
              <Button
                size="sm"
                onClick={() => setItemEditor({ mode: "create" })}
              >
                <Plus className="mr-1 size-3.5" />
                Add Item
              </Button>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search menu…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              className="pl-9 pr-3"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={catFilter} onValueChange={(v) => setCatFilter(v ?? "all")}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {activeCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={vegFilter} onValueChange={(v) => setVegFilter(v ?? "all")}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue placeholder="Veg type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="VEG">Veg</SelectItem>
                <SelectItem value="NON_VEG">Non-veg</SelectItem>
                <SelectItem value="EGG">Egg</SelectItem>
                <SelectItem value="NA">Not specified</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={availFilter}
              onValueChange={(v) => setAvailFilter(v ?? "all")}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="Availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All items</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>

            <Select value={varFilter} onValueChange={(v) => setVarFilter(v ?? "all")}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="Variants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All items</SelectItem>
                <SelectItem value="variants">With variants</SelectItem>
                <SelectItem value="plain">Without variants</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Category quick-filters */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setCatFilter("all")}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              catFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            All ({items.length})
          </button>
          {activeCategories.map((cat) => {
            const count = items.filter(
              (i) => i.categoryId === cat.id
            ).length;
            return (
              <button
                key={cat.id}
                onClick={() =>
                  setCatFilter((p) => (p === cat.id ? "all" : cat.id))
                }
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  catFilter === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {cat.name} ({count})
              </button>
            );
          })}
        </div>

        {/* Items grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <p className="text-muted-foreground">
              {items.length === 0
                ? "No menu items yet. Add your first dish to get started."
                : "No items match your filters."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const catName =
                categoryMap.get(item.categoryId)?.name ?? "—";
              return (
                <div
                  key={item.id}
                  className="group relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <VegMark vegType={item.vegType} />
                        <h3 className="truncate text-sm font-semibold">
                          {item.name}
                        </h3>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {catName}
                      </p>
                    </div>

                    <Badge
                      variant={
                        item.isActive
                          ? item.isAvailable
                            ? "default"
                            : "secondary"
                          : "outline"
                      }
                      className="shrink-0"
                    >
                      {!item.isActive
                        ? "Disabled"
                        : item.isAvailable
                          ? "Available"
                          : "Unavailable"}
                    </Badge>
                  </div>

                  <p className="truncate text-sm font-medium text-foreground">
                    {variantSummary(item)}
                  </p>

                  {item.variants.filter((v) => v.isActive).length > 0 &&
                    item.hasVariants && (
                      <p className="text-xs text-muted-foreground">
                        {item.variants.filter((v) => v.isActive).length} variant
                        {item.variants.filter((v) => v.isActive).length === 1
                          ? ""
                          : "s"}
                        {item.variants.some((v) => v.taxOverride.enabled)
                          ? " · custom GST"
                          : ""}
                      </p>
                    )}

                  <p className="text-xs text-muted-foreground">
                    {item.taxOverride.enabled
                      ? `GST ${item.taxOverride.taxRatePercent}% · ${
                          item.taxOverride.taxMode === "INCLUSIVE"
                            ? "Inclusive"
                            : "Exclusive"
                        } · ${
                          item.taxOverride.taxType === "IGST"
                            ? "IGST"
                            : "CGST + SGST"
                        }`
                      : "GST: restaurant default"}
                  </p>

                  <div className="mt-auto flex flex-wrap items-center gap-1 pt-2 border-t border-border/50">
                    {canToggleAvailability && item.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          handleQuickAvailability(item, !item.isAvailable)
                        }
                      >
                        {item.isAvailable
                          ? "Mark Unavailable"
                          : "Mark Available"}
                      </Button>
                    )}
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            handleQuickStatus(item, !item.isActive)
                          }
                        >
                          {item.isActive ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setItemEditor({ mode: "edit", item })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => promptDelete(item)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Modals */}
      <CategoryManager
        open={catManagerOpen}
        onClose={() => setCatManagerOpen(false)}
        categories={categories}
        onSaved={refresh}
      />

      {itemEditor && (
        <ItemForm
          open
          onClose={() => setItemEditor(null)}
          categories={activeCategories}
          initial={itemEditor.mode === "edit" ? itemEditor.item : null}
          gstEnabled={gstEnabled}
          onSaved={refresh}
        />
      )}

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message}
        confirmLabel="Delete"
        destructive
        pending={confirmPending}
        onConfirm={runConfirmAction}
        onClose={() => setConfirmState(null)}
      />

      <ToastView toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}