"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import {
  INVENTORY_STOCK_STATUS_LABELS,
  type InventoryStockStatus,
} from "@/lib/inventory/constants";

const STATUS_STYLES: Record<InventoryStockStatus, string> = {
  IN_STOCK:
    "border-green-600/30 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  LOW_STOCK:
    "border-amber-600/30 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  OUT_OF_STOCK:
    "border-red-600/30 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

export function StockStatusBadge({
  status,
  className,
}: {
  status: InventoryStockStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("font-medium", STATUS_STYLES[status], className)}
    >
      {INVENTORY_STOCK_STATUS_LABELS[status]}
    </Badge>
  );
}
