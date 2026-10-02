"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPaise } from "@/lib/menu/prices";
import type { BillPaymentMethod } from "@/lib/billing/constants";
import { BILL_PAYMENT_METHOD_LABELS } from "@/lib/billing/constants";
import type { TimeBucket, PaymentMethodTotal, OrderTypeTotal } from "@/lib/reports/types";
import { orderTypeLabel } from "@/lib/orders/constants";

const PIE_COLORS = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
];

interface SalesTrendChartProps {
  data: TimeBucket[];
  kind: "daily" | "hourly";
}

/** Area chart of revenue per day / hour for the selected range. */
export function SalesTrendChart({ data, kind }: SalesTrendChartProps) {
  const chartData = data.map((d) => ({
    label: kind === "hourly" ? d.label.split(":")[0] : d.label,
    sales: d.salesPaise,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
          <XAxis
            dataKey="label"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatPaise(Number(v))}
            width={64}
          />
          <Tooltip
            formatter={(value) => formatPaise(Number(value))}
            labelFormatter={(label) => (kind === "hourly" ? `${label}:00` : label)}
            contentStyle={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="sales"
            name="Sales"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#salesFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface PaymentBreakdownChartProps {
  data: PaymentMethodTotal[];
}

/** Donut of collected amount split across payment methods. */
export function PaymentBreakdownChart({ data }: PaymentBreakdownChartProps) {
  const chartData = data.map((d) => ({
    name: BILL_PAYMENT_METHOD_LABELS[d.method],
    value: d.amountPaise,
  }));
  if (chartData.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No payments in this range.
      </p>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={48}
            outerRadius={80}
            paddingAngle={2}
            stroke="var(--background)"
          >
            {chartData.map((entry, i) => (
              <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatPaise(Number(value))}
            contentStyle={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {chartData.map((d, i) => (
          <span key={d.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="size-2.5 rounded-full"
              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
            />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

interface OrderTypeBreakdownChartProps {
  data: OrderTypeTotal[];
}

/** Horizontal bars of orders + sales per order type. */
export function OrderTypeBreakdownChart({ data }: OrderTypeBreakdownChartProps) {
  const chartData = data.map((d) => ({
    name: orderTypeLabel[d.orderType],
    orders: d.orders,
    sales: d.salesPaise,
  }));

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No billed orders in this range.
      </p>
    );
  }

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" horizontal={false} />
          <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={76}
          />
          <Tooltip
            formatter={(value, name) =>
              name === "sales" ? formatPaise(Number(value)) : String(value)
            }
            contentStyle={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
          />
          <Bar dataKey="orders" name="Orders" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export type PaymentMethod = BillPaymentMethod;