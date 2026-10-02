"use client";

import { Search, X, Plus } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { usePos } from "@/components/pos/pos-store";
import { VegMark } from "@/components/menu/veg-mark";
import type { MenuCategoryView, MenuItemView } from "@/lib/menu/types";
import { formatPaise } from "@/lib/menu/prices";

export function MenuBrowser({
  categories,
  items,
  onAddItem,
}: {
  categories: MenuCategoryView[];
  items: MenuItemView[];
  onAddItem: (item: MenuItemView) => void;
}) {
  const { state, dispatch } = usePos();
  const activeCategories = categories.filter((c) => c.isActive);
  const sorted = [...items].sort((a, b) => a.displayOrder - b.displayOrder);

  const sellable = sorted.filter((item) => item.isActive);

  const normalized = state.search.trim().toLowerCase();
  const filtered = sellable.filter(
    (item) =>
      (state.selectedCategory === "all" ||
        item.categoryId === state.selectedCategory) &&
      (!normalized || item.name.toLowerCase().includes(normalized))
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Search */}
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.search}
          onChange={(e) =>
            dispatch({ type: "SET_SEARCH", value: e.currentTarget.value })
          }
          placeholder="Search menu…"
          className="pl-9 pr-9"
        />
        {state.search && (
          <button
            type="button"
            onClick={() => dispatch({ type: "SET_SEARCH", value: "" })}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => dispatch({ type: "SET_CATEGORY", value: "all" })}
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            state.selectedCategory === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          All
        </button>
        {activeCategories.map((c) => {
          const count = sellable.filter((item) => item.categoryId === c.id).length;
          if (count === 0) return null;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                dispatch({
                  type: "SET_CATEGORY",
                  value:
                    state.selectedCategory === c.id ? "all" : c.id,
                })
              }
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                state.selectedCategory === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {c.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Items */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {sellable.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <p className="text-sm text-muted-foreground">
              No items on the menu yet. Add items in the Menu module first.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <p className="text-sm text-muted-foreground">
              No items match your search.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {filtered.map((item) => (
              <ItemCard key={item.id} item={item} onAddItem={onAddItem} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  onAddItem,
}: {
  item: MenuItemView;
  onAddItem: (item: MenuItemView) => void;
}) {
  const sellable = item.isAvailable && item.isActive;
  const activeVariants = item.variants.filter((v) => v.isActive);
  const minVariantPrice =
    activeVariants.length > 0
      ? Math.min(...activeVariants.map((v) => v.pricePaise))
      : null;

  return (
    <button
      type="button"
      disabled={!sellable}
      onClick={() => onAddItem(item)}
      className={cn(
        "group flex min-h-28 flex-col items-start justify-between gap-2 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all",
        sellable
          ? "border-input hover:border-primary/40 hover:shadow-md focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          : "border-input opacity-60 cursor-not-allowed"
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <VegMark vegType={item.vegType} />
          <span className="text-sm leading-snug font-semibold">{item.name}</span>
        </div>
        {!sellable && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Unavailable
          </span>
        )}
      </div>

      <div className="flex w-full items-end justify-between gap-2">
        <div className="min-w-0">
          {item.hasVariants ? (
            <>
              <p className="text-sm font-semibold">
                {minVariantPrice != null
                  ? `From ${formatPaise(minVariantPrice)}`
                  : "No variants"}
              </p>
              {item.hasVariants && (
                <p className="text-xs text-muted-foreground">
                  {activeVariants.length} size{activeVariants.length === 1 ? "" : "s"}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-semibold">
              {item.basePrice != null ? formatPaise(item.basePrice) : "—"}
            </p>
          )}
        </div>
        {sellable && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground group-active:translate-y-px">
            <Plus className="size-4" />
          </span>
        )}
      </div>
    </button>
  );
}