"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchInventoryItemsAction } from "@/actions/inventory/actions";
import type { InventoryItemView } from "@/lib/inventory/types";

export function ItemPicker({
  value,
  onSelect,
  placeholder = "Search item by name or SKU…",
  autoFocus,
}: {
  value: InventoryItemView | null;
  onSelect(item: InventoryItemView | null): void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<InventoryItemView[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      const res = await searchInventoryItemsAction(term);
      setRows(res.success ? res.data ?? [] : []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [term, open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.name}</p>
          <p className="text-xs text-muted-foreground">
            {value.currentStockLabel} in stock
            {value.sku ? ` · ${value.sku}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onSelect(null);
            setTerm("");
            setOpen(true);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className="pl-8"
          onChange={(e) => {
            setTerm(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {loading && (
          <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {rows.length === 0 && !loading ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {term.trim()
                ? "No matching items."
                : "Type to search, or add items first."}
            </p>
          ) : (
            rows.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onSelect(item);
                  setTerm("");
                  setOpen(false);
                }}
              >
                <Package className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.currentStockLabel}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
