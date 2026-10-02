import { Suspense } from "react";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { assertCanViewOrders, canCancelOrders } from "@/lib/orders/permissions";
import { canManageBills, canCancelBills } from "@/lib/billing/permissions";
import { getOrderDetails } from "@/lib/orders/orders-management";
import { notFound } from "next/navigation";
import { AppHeaderServer } from "@/components/app-header-server";
import { OrderDetail } from "@/components/orders/order-detail";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order details",
};

async function OrderPageContent({ orderId }: { orderId: string }) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("ORDERS", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;
  assertCanViewOrders(auth.role);

  const details = await getOrderDetails(String(restaurant.id), orderId);
  if (!details) notFound();

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <OrderDetail
        details={details}
        canManage={canManageBills(auth.role)}
        canCancelBill={canCancelBills(auth.role)}
        canCancelOrder={canCancelOrders(auth.role)}
      />
    </div>
  );
}

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading order…</div>
        </div>
      }
    >
      <OrderPageContent orderId={id} />
    </Suspense>
  );
}