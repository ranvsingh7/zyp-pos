import { Suspense } from "react";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { AppHeaderServer } from "@/components/app-header-server";
import { PosManager } from "@/components/pos/pos-manager";
import { getTablesAndSections } from "@/lib/tables/table-service";
import { getMenuCategories } from "@/lib/menu/category-service";
import { getMenuItems } from "@/lib/menu/item-service";
import { getPosOrders } from "@/lib/orders/order-service";
import { listOrderStaff } from "@/lib/orders/orders-management";
import type { StaffMap } from "@/lib/orders/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Point of Sale",
};

async function PosPageContent({
  searchParams,
}: {
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("POS", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;

  const restaurantId = String(restaurant.id);
  const params = await searchParams;
  const tableParam = Array.isArray(params.table) ? params.table[0] : params.table;

  const [tableData, orderData, referenceData] = await Promise.all([
    getTablesAndSections(restaurantId),
    getPosOrders(restaurantId),
    tableParam
      ? Promise.all([
          getMenuCategories(restaurantId),
          getMenuItems(restaurantId, { forPos: true }),
          listOrderStaff(restaurantId),
        ])
      : Promise.resolve(null),
  ]);
  const [categories, items, staffList] = referenceData ?? [[], [], []];

  // id → { fullName, role } so KOT history can resolve "Cancelled by".
  const staff: StaffMap = Object.fromEntries(
    staffList.map((s) => [s.id, { fullName: s.fullName, role: s.role }])
  );

  return (
    <div className="min-h-screen bg-background lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto flex w-full min-w-0 max-w-[1500px] flex-1 flex-col px-4 sm:px-6 lg:min-h-0">
        <div className="shrink-0 pt-6 pb-4 lg:pt-4 lg:pb-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Point of Sale
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a table, tap items to add them, and print kitchen tickets.
          </p>
        </div>
        <div className="min-h-0 flex-1 pb-4 lg:pb-6">
          <PosManager
            sections={tableData.sections}
            tables={tableData.tables}
            categories={categories}
            items={items}
            activeOrders={orderData.activeOrders}
            heldOrders={orderData.heldOrders}
            staff={staff}
            initialTableId={tableParam ?? null}
          />
        </div>
      </main>
    </div>
  );
}

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading POS…</div>
        </div>
      }
    >
      <PosPageContent searchParams={searchParams} />
    </Suspense>
  );
}