import {
  CalendarCheck2,
  IndianRupee,
  Ban,
  CheckCircle2,
  Clock4,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatPaise } from "@/lib/menu/prices";
import type { OrdersSummary } from "@/lib/orders/types";

interface OrdersSummaryCardsProps {
  summary: OrdersSummary;
}

/**
 * Server-rendered KPI strip for the Orders list. Every card is tenant-scoped
 * (the caller passes a summary already computed for the session's restaurant).
 */
export function OrdersSummaryCards({ summary }: OrdersSummaryCardsProps) {
  const cards = [
    {
      label: "Today's orders",
      value: String(summary.todayOrders),
      icon: CalendarCheck2,
      tone: "text-primary",
    },
    {
      label: "Today's sales",
      value: formatPaise(summary.todaySalesPaise),
      icon: IndianRupee,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Unpaid bills",
      value: String(summary.unpaidBills),
      icon: Clock4,
      tone: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Paid bills",
      value: String(summary.paidBills),
      icon: CheckCircle2,
      tone: "text-sky-600 dark:text-sky-400",
    },
    {
      label: "Cancelled orders",
      value: String(summary.cancelledOrders),
      icon: Ban,
      tone: "text-destructive",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map(({ label, value, icon: Icon, tone }) => (
        <Card key={label} size="sm">
          <CardContent className="flex items-center gap-3">
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted ${tone}`}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{label}</p>
              <p className="mt-0.5 truncate font-heading text-base font-semibold">
                {value}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}