"use client";

import { Boxes, IndianRupee, PackageX, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatPaise } from "@/lib/menu/prices";
import type { InventorySummary } from "@/lib/inventory/types";

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Boxes;
  tone: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate font-heading text-2xl font-semibold tracking-tight">
            {value}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone}`}
        >
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}

export function InventorySummaryCards({
  summary,
}: {
  summary: InventorySummary;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        label="Total Items"
        value={String(summary.totalItems)}
        hint={`${summary.inStockCount} in stock`}
        icon={Boxes}
        tone="bg-primary/10 text-primary"
      />
      <SummaryCard
        label="Low Stock"
        value={String(summary.lowStockCount)}
        hint="At or below minimum"
        icon={TriangleAlert}
        tone="bg-amber-500/10 text-amber-600"
      />
      <SummaryCard
        label="Out of Stock"
        value={String(summary.outOfStockCount)}
        hint="Needs restocking"
        icon={PackageX}
        tone="bg-red-500/10 text-red-600"
      />
      <SummaryCard
        label="Estimated Inventory Value"
        value={formatPaise(summary.inventoryValuePaise)}
        hint="Stock × latest cost (estimate)"
        icon={IndianRupee}
        tone="bg-green-500/10 text-green-600"
      />
    </div>
  );
}
