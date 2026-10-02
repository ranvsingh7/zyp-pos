import {
  IndianRupee,
  ShoppingBag,
  CheckCircle2,
  Ban,
  Wallet,
  TrendingUp,
} from "lucide-react";
import { formatPaise } from "@/lib/menu/prices";
import type { DashboardKpis, DashboardSalesSummary } from "@/lib/reports/types";
import { StatCard } from "@/components/reports/stat-card";

export interface DashboardStatCardsProps {
  kpis: DashboardKpis;
  sales: DashboardSalesSummary;
  includeFinancials: boolean;
}

/** KPI strip for the dashboard, tenant-scoped server data only. */
export function DashboardStatCards({
  kpis,
  sales,
  includeFinancials,
}: DashboardStatCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <StatCard
        label="Total sales"
        value={includeFinancials ? formatPaise(kpis.totalSalesPaise) : "—"}
        icon={IndianRupee}
        tone="text-emerald-600 dark:text-emerald-400"
      />
      <StatCard
        label="Orders"
        value={String(kpis.ordersCount)}
        icon={ShoppingBag}
        tone="text-primary"
      />
      <StatCard
        label="Avg order value"
        value={includeFinancials ? formatPaise(kpis.averageOrderValuePaise) : "—"}
        icon={TrendingUp}
        tone="text-sky-600 dark:text-sky-400"
      />
      <StatCard
        label="Paid bills"
        value={String(kpis.paidBills)}
        icon={CheckCircle2}
        tone="text-emerald-600 dark:text-emerald-400"
      />
      <StatCard
        label="Outstanding"
        value={
          includeFinancials
            ? formatPaise(kpis.dueAmountPaise)
            : "—"
        }
        hint={includeFinancials ? `${kpis.dueBills} unpaid / partial` : undefined}
        icon={Wallet}
        tone="text-amber-600 dark:text-amber-400"
      />
      <StatCard
        label="Cancelled orders"
        value={String(kpis.cancelledOrders)}
        icon={Ban}
        tone="text-destructive"
      />
      {includeFinancials && (
        <StatCard
          label="Collected"
          value={formatPaise(sales.collectedPaise)}
          hint="Payments received in range"
          icon={Wallet}
          tone="text-violet-600 dark:text-violet-400"
        />
      )}
    </div>
  );
}