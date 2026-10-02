import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import {
  canManageInventory,
  canViewInventory,
} from "@/lib/inventory/permissions";
import { listPurchases } from "@/lib/inventory/purchase-service";
import { parsePurchaseSearchParams } from "@/lib/inventory/query";
import { AppHeaderServer } from "@/components/app-header-server";
import { PurchasesView } from "@/components/inventory/purchases-view";
import { InventorySubNav } from "@/components/inventory/inventory-sub-nav";

export const metadata: Metadata = {
  title: "Inventory Purchases",
};

type PurchaseSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

async function PurchasesPageContent({
  searchParams,
}: {
  searchParams: PurchaseSearchParams;
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
  const query = parsePurchaseSearchParams(sp);
  const data = await listPurchases(restaurantId, query);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1500px] px-4 pt-6 pb-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Purchases
          </h1>
          <p className="text-sm text-muted-foreground">
            Every stock purchase, with supplier, invoice and line-item history.
          </p>
          <div className="mt-4">
            <InventorySubNav />
          </div>
        </div>

        <PurchasesView
          data={data}
          query={query}
          canManage={canManageInventory(auth.role)}
        />
      </main>
    </div>
  );
}

export default function PurchasesPage({
  searchParams,
}: {
  searchParams: PurchaseSearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading purchases…</div>
        </div>
      }
    >
      <PurchasesPageContent searchParams={searchParams} />
    </Suspense>
  );
}
