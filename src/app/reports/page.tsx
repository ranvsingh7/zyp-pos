import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeaderServer } from "@/components/app-header-server";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import {
  assertCanViewReports,
  assertCanViewReportTab,
  visibleReportTabs,
} from "@/lib/reports/permissions";
import { parseReportQuery } from "@/lib/reports/query";
import { ReportsTabs } from "@/components/reports/reports-tabs";
import { ReportsToolbar } from "@/components/reports/reports-toolbar";
import { ReportSection } from "@/components/reports/report-sections";

export const metadata: Metadata = {
  title: "Reports | ZYP POS",
};

type ReportsSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function ReportsContent({
  searchParams,
}: {
  searchParams: ReportsSearchParams;
}) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("REPORTS", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;
  assertCanViewReports(auth.role);

  const sp = await searchParams;
  const query = parseReportQuery(sp);

  const visible = visibleReportTabs(auth.role);
  if (visible.length === 0 || !visible.includes(query.tab)) {
    // Never redirect to `/reports` (which would land back on the default tab
    // and loop for roles that cannot see it) — go straight to a visible tab.
    redirect(visible.length ? `/reports?tab=${visible[0]}` : "/login");
  }
  assertCanViewReportTab(auth.role, query.tab);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-10 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Revenue, payments, orders and operational analytics for{" "}
            {restaurant.name}.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <ReportsTabs active={query.tab} visible={visible} />

          <div className="rounded-xl border bg-card p-3 sm:p-4">
            <ReportsToolbar query={query} showExport={auth.role !== "WAITER"} />
          </div>

          <ReportSection
            restaurantId={String(restaurant.id)}
            query={query}
          />
        </div>
      </main>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: ReportsSearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading reports…</div>
        </div>
      }
    >
      <ReportsContent searchParams={searchParams} />
    </Suspense>
  );
}