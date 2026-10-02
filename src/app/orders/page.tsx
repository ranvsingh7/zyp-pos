import { Suspense } from "react";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { assertCanViewOrders } from "@/lib/orders/permissions";
import { canManageBills } from "@/lib/billing/permissions";
import { AppHeaderServer } from "@/components/app-header-server";
import {
  listOrders,
  getOrdersSummary,
  listOrderTables,
  listOrderStaff,
} from "@/lib/orders/orders-management";
import { parseOrdersSearchParams } from "@/lib/orders/orders-query";
import { OrdersToolbar } from "@/components/orders/orders-toolbar";
import { OrdersTable } from "@/components/orders/orders-table";
import { OrdersSummaryCards } from "@/components/orders/orders-summary";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orders",
};

type OrdersSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function OrdersPageContent({ searchParams }: { searchParams: OrdersSearchParams }) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("ORDERS", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;
  assertCanViewOrders(auth.role);

  const sp = await searchParams;
  const restaurantId = String(restaurant.id);

  const [result, summary, tables, staff] = await Promise.all([
    listOrders(restaurantId, sp),
    getOrdersSummary(restaurantId),
    listOrderTables(restaurantId),
    listOrderStaff(restaurantId),
  ]);

  const query = parseOrdersSearchParams(sp);
  const canPrint = canManageBills(auth.role);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1500px] px-4 pt-6 pb-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Orders
          </h1>
          <p className="text-sm text-muted-foreground">
            Search, filter and review every order. Orders are created in POS;
            this page is the history and management view.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <OrdersSummaryCards summary={summary} />

          <Suspense
            fallback={
              <div className="h-40 animate-pulse rounded-xl border bg-card/60" />
            }
          >
            <div className="rounded-xl border bg-card p-4">
              <OrdersToolbar query={query} tables={tables} staff={staff} />
            </div>
          </Suspense>

          <OrdersTable
            rows={result.rows}
            total={result.total}
            page={result.page}
            pageCount={result.pageCount}
            query={query}
            canPrint={canPrint}
          />
        </div>
      </main>
    </div>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: OrdersSearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading orders…</div>
        </div>
      }
    >
      <OrdersPageContent searchParams={searchParams} />
    </Suspense>
  );
}