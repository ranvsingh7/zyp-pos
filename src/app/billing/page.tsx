import { Suspense } from "react";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { listBills } from "@/lib/billing/bill-service";
import { canManageBills } from "@/lib/billing/permissions";
import { AppHeaderServer } from "@/components/app-header-server";
import { BillingList } from "@/components/billing/billing-list";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Billing",
};

async function BillingPageContent() {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("BILLING", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;

  const { bills, total } = await listBills(restaurant.id, { limit: 20 });

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <BillingList
        canPrint={canManageBills(auth.role)}
        initialBills={bills}
        initialTotal={total}
      />
    </div>
  );
}

export default async function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">
            Loading bills…
          </div>
        </div>
      }
    >
      <BillingPageContent />
    </Suspense>
  );
}