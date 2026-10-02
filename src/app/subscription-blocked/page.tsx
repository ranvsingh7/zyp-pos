import type { Metadata } from "next";
import Link from "next/link";
import { UtensilsCrossed, ShieldX, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { requireAuth } from "@/lib/auth/guards";
import { getSubscriptionAccess } from "@/lib/admin/subscription-service";
import { formatDate } from "@/components/admin/admin-common";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/admin/view-labels";

export const metadata: Metadata = {
  title: "Subscription blocked | ZYP POS",
};

export default async function SubscriptionBlockedPage() {
  const user = await requireAuth();
  let access = null;
  let restaurantName = user.fullName;
  if (user.restaurantId) {
    const info = await getSubscriptionAccess(user.restaurantId);
    access = info;
    const { getCurrentRestaurant } = await import("@/lib/auth/guards");
    const restaurant = await getCurrentRestaurant();
    if (restaurant) restaurantName = restaurant.name;
  }

  const message =
    access?.status === "NONE"
      ? "No active subscription is linked to this account. Ask your ZYP POS administrator to assign a plan to get started."
      : access?.status === "SUSPENDED"
        ? "This account has been temporarily suspended by the administrator."
        : access?.status === "CANCELLED"
          ? "This subscription has been cancelled."
          : "Your subscription has expired. Renew it to continue using ZYP POS.";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">ZYP POS</span>
        </div>

        <div className="rounded-xl border bg-background p-6 shadow-sm">
          <div className="mb-4 flex flex-col items-center text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
              <ShieldX className="size-6" />
            </span>
            <h1 className="font-heading text-xl font-semibold tracking-tight">Access blocked</h1>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          </div>

          {access?.status && (
            <div className="mb-4 rounded-lg bg-muted p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarClock className="size-4" />
                  Subscription status
                </span>
                <span className="font-medium">{SUBSCRIPTION_STATUS_LABELS[access.status]}</span>
              </div>
              {access.expiryDate && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">Expired on / plan</span>
                  <span className="font-medium">
                    {access.planName ? `${access.planName} · ` : ""}{formatDate(access.expiryDate)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            Need help? Please contact your{" "}
            <span className="font-medium text-foreground">ZYP POS administrator</span> for{" "}
            <span className="font-medium text-foreground">{restaurantName}</span> to renew or
            assign a subscription.
          </div>

          <div className="mt-4 flex flex-col items-center gap-2">
            <Button nativeButton={false} render={<Link href="/settings/subscription" />}>
              View plan &amp; renewal history
            </Button>
            <Button nativeButton={false} render={<Link href="/dashboard" />}>Try again</Button>
            <LogoutButton />
          </div>
        </div>
</div>
    </div>
  );
}