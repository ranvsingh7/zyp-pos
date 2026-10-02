"use client";

import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { InventoryPagination } from "@/components/inventory/inventory-pagination";
import { useFilterParams } from "@/components/inventory/use-filter-params";
import {
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPES,
} from "@/lib/inventory/constants";
import type { NormalizedMovementQuery } from "@/lib/inventory/query";
import type { Paged, StockMovementView } from "@/lib/inventory/types";
import { formatDateTime } from "@/lib/format/date";

export function MovementsView({
  data,
  query,
}: {
  data: Paged<StockMovementView>;
  query: NormalizedMovementQuery;
}) {
  const { setParams } = useFilterParams();

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <div className="relative w-full lg:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            key={query.q}
            defaultValue={query.q}
            className="pl-8"
            placeholder="Search item or reason…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setParams({ q: e.currentTarget.value.trim() || null });
              }
            }}
          />
        </div>

        <Select
          value={query.type || "all"}
          onValueChange={(v) => setParams({ type: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-44" aria-label="Movement type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {STOCK_MOVEMENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {STOCK_MOVEMENT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          aria-label="From date"
          className="w-40"
          value={query.from ?? ""}
          onChange={(e) => setParams({ from: e.currentTarget.value || null })}
        />
        <Input
          type="date"
          aria-label="To date"
          className="w-40"
          value={query.to ?? ""}
          onChange={(e) => setParams({ to: e.currentTarget.value || null })}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Change</th>
              <th className="px-4 py-2.5 font-medium">Before → After</th>
              <th className="px-4 py-2.5 font-medium">By</th>
              <th className="px-4 py-2.5 font-medium">Reason / Note</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No stock movements match your filters.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{row.itemName}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant="outline"
                      className={
                        row.direction === "IN"
                          ? "border-green-600/30 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                          : "border-red-600/30 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                      }
                    >
                      {STOCK_MOVEMENT_TYPE_LABELS[row.type]}
                    </Badge>
                  </td>
                  <td
                    className={
                      row.direction === "IN"
                        ? "px-4 py-2.5 font-medium text-green-600"
                        : "px-4 py-2.5 font-medium text-red-600"
                    }
                  >
                    {row.quantityLabel}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {row.beforeStockLabel} → {row.afterStockLabel}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {row.createdByName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {[row.reason, row.note].filter(Boolean).join(" · ") || "—"}
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
        label="movements"
        onPage={(page) => setParams({ page: String(page) })}
      />
    </div>
  );
}
