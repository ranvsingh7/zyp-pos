import { Trophy } from "lucide-react";
import { formatPaise } from "@/lib/menu/prices";
import type { TopItemRow } from "@/lib/reports/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface TopItemsProps {
  items: TopItemRow[];
  includeFinancials: boolean;
}

/** Best-selling items by quantity with an inline heat bar. */
export function TopItems({ items, includeFinancials }: TopItemsProps) {
  const maxQty = Math.max(1, ...items.map((i) => i.quantity));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4 text-primary" />
          Top items
        </CardTitle>
        <CardDescription className="text-xs">By quantity sold</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">No sales in this range.</p>
        )}
        {items.map((item, index) => (
          <div key={`${item.menuItemId}-${item.name}`} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">
                <span className="mr-1.5 text-xs text-muted-foreground">
                  {index + 1}
                </span>
                {item.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.quantity} × {includeFinancials ? formatPaise(item.salesPaise) : "—"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${Math.min(100, (item.quantity / maxQty) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}