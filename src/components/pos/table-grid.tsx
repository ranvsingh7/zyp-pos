"use client";

import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrderView } from "@/lib/orders/types";
import type { TableSectionView, TableView } from "@/lib/tables/types";
import type { TableStatus } from "@/lib/tables/constants";

const TABLE_STATUS_TEXT: Record<TableStatus, string> = {
  AVAILABLE: "Open",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
};

const TABLE_BUTTON_STYLES: Record<TableStatus, string> = {
  AVAILABLE:
    "border-input bg-card text-foreground hover:border-primary/40 hover:bg-muted",
  OCCUPIED:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  RESERVED:
    "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

/**
 * STEP 1 — table selection. Active tables as a card grid showing their current
 * order and a "NEW KOT" badge when a table's order has unprinted quantities.
 * Held orders get a compact resume list so they stay reachable without
 * cluttering the primary order-taking flow.
 */
export function TableGrid({
  sections,
  tables,
  activeOrders,
  heldOrders,
  busy,
  selectedTableId,
  onOpenTable,
  onResumeOrder,
}: {
  sections: TableSectionView[];
  tables: TableView[];
  activeOrders: OrderView[];
  heldOrders: OrderView[];
  busy: boolean;
  selectedTableId: string | null;
  onOpenTable: (table: TableView) => void;
  onResumeOrder: (order: OrderView) => void;
}) {
  const [sectionFilter, setSectionFilter] = useState<string>("all");

  const activeSections = useMemo(
    () => sections.filter((s) => s.isActive),
    [sections]
  );
  const visibleTables = useMemo(
    () =>
      sectionFilter === "all"
        ? tables.filter((t) => t.isActive)
        : tables.filter((t) => t.isActive && t.sectionId === sectionFilter),
    [sectionFilter, tables]
  );
  const activeOrdersByTableId = useMemo(
    () => new Map(activeOrders.map((order) => [order.tableId, order])),
    [activeOrders]
  );

  return (
    <div className="flex flex-col gap-4">
      {activeSections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSectionFilter("all")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              sectionFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            All tables
          </button>
          {activeSections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                setSectionFilter((prev) => (prev === s.id ? "all" : s.id))
              }
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                sectionFilter === s.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {tables.filter((t) => t.isActive).length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No active tables. Add tables in the Tables module first.
        </p>
      ) : visibleTables.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No tables in this section.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-2 xl:grid-cols-3">
          {visibleTables.map((table) => {
            const order = activeOrdersByTableId.get(table.id);
            const isSelected = selectedTableId === table.id;
            const hasNewKot = order?.pendingKitchenPrint != null;
            const clickable = table.status === "AVAILABLE" || order != null;
            return (
              <button
                key={table.id}
                type="button"
                disabled={!clickable || busy}
                onClick={() => onOpenTable(table)}
                title={
                  !clickable
                    ? table.status === "RESERVED"
                      ? "Table is reserved."
                      : "Table is occupied but has no active order."
                    : undefined
                }
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  TABLE_BUTTON_STYLES[table.status],
                  isSelected && "border-primary ring-2 ring-primary"
                )}
              >
                <span className="flex w-full min-w-0 items-center justify-between gap-1">
                  <span className="truncate text-sm font-semibold">
                    {table.name}
                  </span>
                  {hasNewKot && (
                    <Badge className="shrink-0 bg-amber-500 text-white">
                      NEW KOT
                    </Badge>
                  )}
                </span>
                <span className="block w-full truncate text-xs opacity-90">
                  {order
                    ? `#${order.orderNumber}${pendingCountLabel(order)}`
                    : TABLE_STATUS_TEXT[table.status]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {heldOrders.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Held orders
          </h3>
          <div className="flex flex-col gap-2">
            {heldOrders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    #{order.orderNumber}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {order.tableNameSnapshot ?? "Table"} ·{" "}
                    {order.items.length} item
                    {order.items.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onResumeOrder(order)}
                >
                  <Play className="size-3.5" />
                  Resume
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function pendingCountLabel(order: OrderView): string {
  const count = order.pendingKitchenItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );
  return count > 0 ? ` · +${count}` : "";
}