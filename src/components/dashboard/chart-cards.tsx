import { CalendarDays, Clock3, HandCoins, Store } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  OrderTypeTotal,
  PaymentMethodTotal,
  TimeBucket,
} from "@/lib/reports/types";
import {
  OrderTypeBreakdownChart,
  PaymentBreakdownChart,
  SalesTrendChart,
} from "@/components/dashboard/charts";

export function SalesTrendCard({ dailySales }: { dailySales: TimeBucket[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4 text-primary" />
          Sales by day
        </CardTitle>
        <CardDescription className="text-xs">Revenue per business day</CardDescription>
      </CardHeader>
      <CardContent>
        <SalesTrendChart data={dailySales} kind="daily" />
      </CardContent>
    </Card>
  );
}

export function HourlySalesCard({ hourlySales }: { hourlySales: TimeBucket[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock3 className="size-4 text-primary" />
          Sales by hour
        </CardTitle>
        <CardDescription className="text-xs">Revenue per hour of the day</CardDescription>
      </CardHeader>
      <CardContent>
        <SalesTrendChart data={hourlySales} kind="hourly" />
      </CardContent>
    </Card>
  );
}

export function PaymentBreakdownCard({
  data,
}: {
  data: PaymentMethodTotal[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HandCoins className="size-4 text-primary" />
          Payment methods
        </CardTitle>
        <CardDescription className="text-xs">Collected by payment method</CardDescription>
      </CardHeader>
      <CardContent>
        <PaymentBreakdownChart data={data} />
      </CardContent>
    </Card>
  );
}

export function OrderTypeCard({ data }: { data: OrderTypeTotal[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="size-4 text-primary" />
          Order types
        </CardTitle>
        <CardDescription className="text-xs">Orders by channel</CardDescription>
      </CardHeader>
      <CardContent>
        <OrderTypeBreakdownChart data={data} />
      </CardContent>
    </Card>
  );
}