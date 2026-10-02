import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import {
  canManageInventory,
  canViewInventory,
} from "@/lib/inventory/permissions";
import {
  getInventorySummary,
  listInventoryCategories,
  listInventoryItems,
} from "@/lib/inventory/inventory-service";
import { parseInventorySearchParams } from "@/lib/inventory/query";
import { AppHeaderServer } from "@/components/app-header-server";
import { InventoryManager } from "@/components/inventory/inventory-manager";
import { InventorySubNav } from "@/components/inventory/inventory-sub-nav";

export const metadata: Metadata = {
  title: "Inventory",
};

type InventorySearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

async function InventoryPageContent({
  searchParams,
}: {
  searchParams: InventorySearchParams;
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
  const query = parseInventorySearchParams(sp);

  const [data, summary, categories] = await Promise.all([
    listInventoryItems(restaurantId, query),
    getInventorySummary(restaurantId),
    listInventoryCategories(restaurantId),
  ]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1500px] px-4 pt-6 pb-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            Track stock levels, record purchases, wastage and adjustments. Every
            change is logged as a stock movement.
          </p>
          <div className="mt-4">
            <InventorySubNav />
          </div>
        </div>

        <InventoryManager
          data={data}
          summary={summary}
          categories={categories}
          query={query}
          canManage={canManageInventory(auth.role)}
        />
      </main>
    </div>
  );
}

export default function InventoryPage({
  searchParams,
}: {
  searchParams: InventorySearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading inventory…</div>
        </div>
      }
    >
      <InventoryPageContent searchParams={searchParams} />
    </Suspense>
  );
}
