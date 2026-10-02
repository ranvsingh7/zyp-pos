import { Suspense } from "react";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { assertCanViewOrders } from "@/lib/orders/permissions";
import { AppHeaderServer } from "@/components/app-header-server";
import { listKots } from "@/lib/orders/kot-service";
import { KitchenKots } from "@/components/kitchen/kitchen-kots";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kitchen",
};

async function KitchenPageContent() {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("KOT", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;
  assertCanViewOrders(auth.role);

  const kots = await listKots(String(restaurant.id), 50);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Kitchen
          </h1>
          <p className="text-sm text-muted-foreground">
            Recent KOTs printed from POS, newest first. Opening one reprints the
            exact stored ticket — never a snapshot of the live order.
          </p>
        </div>
        <KitchenKots kots={kots} />
      </main>
    </div>
  );
}

export default async function KitchenPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading kitchen…</div>
        </div>
      }
    >
      <KitchenPageContent />
    </Suspense>
  );
}