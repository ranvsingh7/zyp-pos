import Link from "next/link";
import { ArrowRight, Clock4 } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/orders/format";
import { ORDER_STATUS_TONE } from "@/lib/orders/status-ui";
import { ORDER_STATUS_LABELS, orderTypeLabel } from "@/lib/orders/constants";
import { formatPaise } from "@/lib/menu/prices";
import type { RecentOrderRow } from "@/lib/reports/types";

interface RecentOrdersProps {
  orders: RecentOrderRow[];
  includeFinancials: boolean;
}

/** Latest orders linking through to the management detail page. */
export function RecentOrders({ orders, includeFinancials }: RecentOrdersProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock4 className="size-4 text-primary" />
            Recent orders
          </CardTitle>
          <CardDescription className="text-xs">Latest activity across the restaurant</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {orders.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No orders yet.
            </li>
          )}
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">#{order.orderNumber}</span>
                    <Badge className={cn(ORDER_STATUS_TONE[order.status])}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {orderTypeLabel[order.orderType]}
                    {order.tableNameSnapshot ? ` · ${order.tableNameSnapshot}` : ""}
                    {order.customerName ? ` · ${order.customerName}` : ""} ·{" "}
                    {formatTime(order.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium">
                    {includeFinancials ? formatPaise(order.totalPaise) : ""}
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}