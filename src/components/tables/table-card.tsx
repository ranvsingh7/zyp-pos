"use client";

import { Users, Pencil, MoreHorizontal } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { TableView } from "@/lib/tables/types";
import type { TableStatus } from "@/lib/tables/constants";
import { TABLE_STATUS_LABELS } from "@/lib/tables/constants";

export const TABLE_STATUS_STYLES: Record<
  "AVAILABLE" | "OCCUPIED" | "RESERVED" | "INACTIVE",
  { badge: string; dot: string; ring: string }
> = {
  AVAILABLE: {
    badge: "bg-green-600/15 text-green-700 dark:bg-green-500/15 dark:text-green-400",
    dot: "bg-green-600",
    ring: "ring-green-600/20",
  },
  OCCUPIED: {
    badge: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    dot: "bg-amber-500",
    ring: "ring-amber-500/20",
  },
  RESERVED: {
    badge: "bg-sky-500/15 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
    dot: "bg-sky-500",
    ring: "ring-sky-500/20",
  },
  INACTIVE: {
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    ring: "ring-muted",
  },
};

export function resolveStatusBadge(table: TableView) {
  return table.isActive
    ? TABLE_STATUS_STYLES[table.status]
    : TABLE_STATUS_STYLES.INACTIVE;
}

export function statusLabel(table: TableView): string {
  return table.isActive
    ? TABLE_STATUS_LABELS[table.status]
    : "Inactive";
}

interface TableCardProps {
  table: TableView;
  canEdit: boolean;
  canChangeStatus: boolean;
  onEdit(table: TableView): void;
  onChangeStatus(table: TableView, status: TableStatus): void;
  onToggleActive(table: TableView): void;
  onOpenMenu(table: TableView): void;
}

export function TableCard({
  table,
  canEdit,
  canChangeStatus,
  onEdit,
  onChangeStatus,
  onToggleActive,
  onOpenMenu,
}: TableCardProps) {
  const status = resolveStatusBadge(table);
  const label = statusLabel(table);

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md ring-1",
        status.ring,
        !table.isActive && "opacity-90"
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{table.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {table.sectionName ?? "No section"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenMenu(table)}
          aria-label={`Actions for ${table.name}`}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5" />
        <span>
          {table.capacity} seat{table.capacity === 1 ? "" : "s"}
        </span>
      </div>

      <Badge
        className={cn(
          "w-fit font-medium",
          status.badge,
          !table.isActive && "opacity-80"
        )}
      >
        <span className={cn("size-1.5 rounded-full", status.dot)} />
        {label}
      </Badge>

      <Separator className="my-3" />

      {canChangeStatus && (
        <div className="mb-2">
          <label
            htmlFor={`status-${table.id}`}
            className="mb-1 block text-[11px] font-medium text-muted-foreground"
          >
            Status
          </label>
          <select
            id={`status-${table.id}`}
            value={table.status}
            onChange={(e) =>
              onChangeStatus(table, e.currentTarget.value as TableStatus)
            }
            disabled={!table.isActive}
            className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <option value="AVAILABLE">Available</option>
            <option value="OCCUPIED">Occupied</option>
            <option value="RESERVED">Reserved</option>
          </select>
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 px-2 text-xs"
            onClick={() => onEdit(table)}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onToggleActive(table)}
          >
            {table.isActive ? "Disable" : "Enable"}
          </Button>
        </div>
      )}
    </div>
  );
}