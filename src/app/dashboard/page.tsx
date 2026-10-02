import { Suspense } from "react";
import type { Metadata } from "next";
import { LayoutGrid, UtensilsCrossed, ClipboardList, ReceiptText } from "lucide-react";
import { AppHeaderServer } from "@/components/app-header-server";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import type { ServiceKey } from "@/lib/services/catalog";
import {
  assertCanViewDashboard,
  canViewDashboardFinancials,
} from "@/lib/reports/permissions";
import { getDashboardSummary } from "@/lib/reports/dashboard-service";
import { parseReportQuery } from "@/lib/reports/query";
import { RangeFilter } from "@/components/reports/range-filter";
import { DashboardStatCards } from "@/components/dashboard/dashboard-kpis";
import { SalesSummaryCards } from "@/components/dashboard/sales-summary";
import {
  HourlySalesCard,
  OrderTypeCard,
  PaymentBreakdownCard,
  SalesTrendCard,
} from "@/components/dashboard/chart-cards";
import { TopItems } from "@/components/dashboard/top-items";
import { CategorySales } from "@/components/dashboard/category-sales";
import { RecentOrders } from "@/components/dashboard/recent-orders";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dashboard | ZYP POS",
};

type DashboardSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function DashboardContent({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("DASHBOARD", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;
  assertCanViewDashboard(auth.role);

  const sp = await searchParams;
  const query = parseReportQuery(sp);
  const includeFinancials = canViewDashboardFinancials(auth.role);

  const summary = await getDashboardSummary(String(restaurant.id), query, {
    includeFinancials,
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-10 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Live snapshot for {restaurant.name} · {summary.range.label}.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-3 sm:p-4">
            <RangeFilter date={query.date} from={query.from} to={query.to} />
          </div>

          <DashboardStatCards
            kpis={summary.kpis}
            sales={summary.sales}
            includeFinancials={includeFinancials}
          />

          {includeFinancials && <SalesSummaryCards sales={summary.sales} />}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SalesTrendCard dailySales={summary.dailySales} />
            </div>
            <div className="grid gap-4">
              {includeFinancials && (
                <PaymentBreakdownCard data={summary.paymentBreakdown} />
              )}
              <OrderTypeCard data={summary.orderTypeBreakdown} />
            </div>
          </div>

          <HourlySalesCard hourlySales={summary.hourlySales} />

          <div className="grid gap-4 lg:grid-cols-3">
            <TopItems
              items={summary.topItems}
              includeFinancials={includeFinancials}
            />
            <CategorySales
              rows={summary.categorySales}
              includeFinancials={includeFinancials}
            />
            <RecentOrders
              orders={summary.recentOrders}
              includeFinancials={includeFinancials}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <QuickActions serviceKeys={service.access.serviceKeys} />
            <DiningFloorCard
              occupied={summary.tables.occupied}
              total={summary.tables.total}
            />
            <ReportsShortcuts serviceKeys={service.access.serviceKeys} />
          </div>
        </div>
      </main>
    </div>
  );
}

function DiningFloorCard({ occupied, total }: { occupied: number; total: number }) {
  const available = Math.max(0, total - occupied);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="size-4 text-primary" />
          Dining floor
        </CardTitle>
        <CardDescription className="text-xs">Occupancy right now</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-muted py-3">
          <p className="font-heading text-xl font-semibold">{occupied}</p>
          <p className="text-xs text-muted-foreground">Occupied</p>
        </div>
        <div className="rounded-lg bg-muted py-3">
          <p className="font-heading text-xl font-semibold">{available}</p>
          <p className="text-xs text-muted-foreground">Available</p>
        </div>
        <div className="rounded-lg bg-muted py-3">
          <p className="font-heading text-xl font-semibold">{total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportsShortcuts({ serviceKeys }: { serviceKeys?: readonly ServiceKey[] }) {
  if (serviceKeys && !serviceKeys.includes("REPORTS")) return null;
  const links = [
    { href: "/reports?tab=sales", label: "Sales report", icon: ReceiptText },
    { href: "/reports?tab=payments", label: "Payments report", icon: UtensilsCrossed },
    { href: "/reports?tab=gst", label: "GST report", icon: ClipboardList },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Report shortcuts</CardTitle>
        <CardDescription className="text-xs">Deep links into the reports</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {links.map(({ href, label, icon: Icon }) => (
          <Button
            key={href}
            variant="outline"
            className="justify-start gap-2"
            nativeButton={false}
            render={<Link href={href} />}
          >
            <Icon className="size-4 text-muted-foreground" />
            {label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading dashboard…</div>
        </div>
      }
    >
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}