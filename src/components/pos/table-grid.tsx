"use client";

import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrderView } from "@/lib/orders/types";
import type { TableSectionView, TableView } from "@/lib/tables/types";
import type { TableStatus } from "@/lib/tables/constants";

const TABLE_STATUS_TEXT: Record<TableStatus, string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
};

const TABLE_BUTTON_STYLES: Record<TableStatus, string> = {
  AVAILABLE:
    "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/70 hover:bg-emerald-500/15 dark:text-emerald-400",
  OCCUPIED:
    "border-red-500/50 bg-red-500/10 text-red-700 hover:border-red-500/70 hover:bg-red-500/15 dark:text-red-400",
  RESERVED:
    "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 hover:border-yellow-500/70 hover:bg-yellow-500/15 dark:text-yellow-400",
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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeSections = useMemo(
    () => sections.filter((s) => s.isActive),
    [sections]
  );
  const activeTables = useMemo(
    () => tables.filter((table) => table.isActive),
    [tables]
  );
  const activeOrdersByTableId = useMemo(
    () => new Map(activeOrders.map((order) => [order.tableId, order])),
    [activeOrders]
  );

  const renderTable = (table: TableView) => {
    const order = activeOrdersByTableId.get(table.id);
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
          selectedTableId === table.id && "border-primary ring-2 ring-primary"
        )}
      >
        <span className="flex w-full min-w-0 items-center justify-between gap-1">
          <span className="truncate text-sm font-semibold">{table.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            {order && (
              <span className="text-xs font-semibold tabular-nums opacity-80">
                #{order.orderNumber}
              </span>
            )}
            {hasNewKot && (
              <Badge className="bg-amber-500 text-white">NEW KOT</Badge>
            )}
          </span>
        </span>
        <span className="block w-full truncate text-xs opacity-90">
          {order?.createdAt
            ? `${TABLE_STATUS_TEXT[table.status]} · ${formatElapsed(order.createdAt, now)}${pendingCountLabel(order)}`
            : TABLE_STATUS_TEXT[table.status]}
        </span>
      </button>
    );
  };

  const sectionGroups = activeSections.map((section) => ({
    section,
    tables: activeTables.filter((table) => table.sectionId === section.id),
  }));
  const unassignedTables = activeTables.filter(
    (table) => !table.sectionId || !activeSections.some((section) => section.id === table.sectionId)
  );

  return (
    <div className="flex flex-col gap-4">
      {activeTables.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No active tables. Add tables in the Tables module first.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {sectionGroups.map(({ section, tables: sectionTables }) =>
            sectionTables.length > 0 ? (
              <section key={section.id}>
                <h3 className="mb-2 text-sm font-semibold">{section.name}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-6">
                  {sectionTables.map(renderTable)}
                </div>
              </section>
            ) : null
          )}
          {unassignedTables.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Other tables</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-6">
                {unassignedTables.map(renderTable)}
              </div>
            </section>
          )}
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

function formatElapsed(startedAt: string, now: number): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "--:--";
  const elapsedSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}