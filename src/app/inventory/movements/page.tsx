import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { canViewInventory } from "@/lib/inventory/permissions";
import { listStockMovements } from "@/lib/inventory/stock-service";
import { parseMovementSearchParams } from "@/lib/inventory/query";
import { AppHeaderServer } from "@/components/app-header-server";
import { MovementsView } from "@/components/inventory/movements-view";
import { InventorySubNav } from "@/components/inventory/inventory-sub-nav";

export const metadata: Metadata = {
  title: "Stock Movements",
};

type MovementSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

async function MovementsPageContent({
  searchParams,
}: {
  searchParams: MovementSearchParams;
}) {
  const auth = await requireAuth();
  if (!canViewInventory(auth.role)) redirect("/dashboard");
  const restaurant = await requireRestaurant();
  const service = await requireService("INVENTORY", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;

  const sp = await searchParams;
  const restaurantId = String(restaurant.id);
  const query = parseMovementSearchParams(sp);
  const data = await listStockMovements(restaurantId, query);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1500px] px-4 pt-6 pb-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Stock Movements
          </h1>
          <p className="text-sm text-muted-foreground">
            The full audit trail of stock changes — purchases, adjustments,
            wastage and consumption.
          </p>
          <div className="mt-4">
            <InventorySubNav />
          </div>
        </div>

        <MovementsView data={data} query={query} />
      </main>
    </div>
  );
}

export default function MovementsPage({
  searchParams,
}: {
  searchParams: MovementSearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">
            Loading movements…
          </div>
        </div>
      }
    >
      <MovementsPageContent searchParams={searchParams} />
    </Suspense>
  );
}
