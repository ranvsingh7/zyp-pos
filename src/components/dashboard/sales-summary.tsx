import { formatPaise } from "@/lib/menu/prices";
import type { DashboardSalesSummary } from "@/lib/reports/types";
import { StatCard } from "@/components/reports/stat-card";

/** Sales composition for the range: what makes up the billed total. */
export function SalesSummaryCards({ sales }: { sales: DashboardSalesSummary }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Billed sales" value={formatPaise(sales.billedSalesPaise)} />
      <StatCard label="Discounts" value={`− ${formatPaise(sales.discountPaise)}`} />
      <StatCard label="Tax (GST)" value={formatPaise(sales.taxPaise)} />
      <StatCard label="Service charge" value={formatPaise(sales.serviceChargePaise)} />
      <StatCard label="Round-off" value={formatPaise(sales.roundOffPaise)} />
      <StatCard label="Taxable value" value={formatPaise(sales.netSalesPaise)} />
    </div>
  );
}