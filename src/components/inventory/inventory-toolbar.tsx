"use client";

import { useEffect, useState } from "react";
import { Plus, Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useFilterParams } from "@/components/inventory/use-filter-params";
import type { NormalizedInventoryQuery } from "@/lib/inventory/query";
import type { InventoryCategoryView } from "@/lib/inventory/types";

export function InventoryToolbar({
  query,
  categories,
  canManage,
  onAddItem,
  onAddPurchase,
  onAdjust,
  onWastage,
}: {
  query: NormalizedInventoryQuery;
  categories: InventoryCategoryView[];
  canManage: boolean;
  onAddItem(): void;
  onAddPurchase(): void;
  onAdjust(): void;
  onWastage(): void;
}) {
  const { setParams } = useFilterParams();
  const [term, setTerm] = useState(query.q);

  // Debounced search → URL. Initialised once from the URL and then owned by
  // the input (same pattern as the orders toolbar), so no state is synced
  // inside an effect.
  useEffect(() => {
    if (term.trim() === query.q) return;
    const handle = setTimeout(() => {
      setParams({ q: term.trim() || null });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            className="pl-8"
            placeholder="Search by name or SKU…"
            onChange={(e) => setTerm(e.currentTarget.value)}
          />
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onAddPurchase}>
              <Plus className="size-3.5" />
              Add Stock
            </Button>
            <Button variant="outline" size="sm" onClick={onAddItem}>
              <Plus className="size-3.5" />
              Add Item
            </Button>
            <Button variant="outline" size="sm" onClick={onAdjust}>
              <SlidersHorizontal className="size-3.5" />
              Adjust
            </Button>
            <Button variant="outline" size="sm" onClick={onWastage}>
              <TriangleAlert className="size-3.5" />
              Wastage
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={query.filter}
          onValueChange={(v) => setParams({ filter: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-40" aria-label="Stock status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="in">In Stock</SelectItem>
            <SelectItem value="low">Low Stock</SelectItem>
            <SelectItem value="out">Out of Stock</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={query.categoryId ?? "all"}
          onValueChange={(v) =>
            setParams({ category: v === "all" ? null : v })
          }
        >
          <SelectTrigger className="w-44" aria-label="Category filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={query.sort}
          onValueChange={(v) => setParams({ sort: v === "name" ? null : v })}
        >
          <SelectTrigger className="w-48" aria-label="Sort order">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name (A–Z)</SelectItem>
            <SelectItem value="stock_asc">Stock (low → high)</SelectItem>
            <SelectItem value="stock_desc">Stock (high → low)</SelectItem>
            <SelectItem value="value_desc">Value (high → low)</SelectItem>
            <SelectItem value="cost_desc">Cost (high → low)</SelectItem>
            <SelectItem value="recent">Recently updated</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
