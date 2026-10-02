import { formatPaise } from "@/lib/menu/prices";
import type { CategorySalesRow } from "@/lib/reports/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CategorySalesProps {
  rows: CategorySalesRow[];
  includeFinancials: boolean;
}

/** Revenue per menu category, with a heat bar relative to the top category. */
export function CategorySales({ rows, includeFinancials }: CategorySalesProps) {
  const maxSales = Math.max(1, ...rows.map((r) => r.salesPaise));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Category sales</CardTitle>
        <CardDescription className="text-xs">Share of revenue by category</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No sales in this range.</p>
        )}
        {rows.map((row) => {
          const key = row.categoryId ?? row.categoryName;
          const pct = (row.salesPaise / maxSales) * 100;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{row.categoryName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.quantity} · {includeFinancials ? formatPaise(row.salesPaise) : "—"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-sky-500/70"
                  style={{ width: `${includeFinancials ? Math.min(100, pct) : 0}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}