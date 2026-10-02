import { Suspense } from "react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuth, getCurrentRestaurant } from "@/lib/auth/guards";
import {
  getSubscriptionAccess,
  getSubscriptionByRestaurantId,
  listSubscriptionHistory,
  type SubscriptionHistoryView,
  type SubscriptionView,
} from "@/lib/admin/subscription-service";
import { formatAdminDate, formatAdminDateTime } from "@/lib/admin/date-utils";
import { PLAN_BILLING_CYCLE_LABELS } from "@/lib/admin/view-labels";
import { formatPaise } from "@/lib/menu/prices";
import { AppHeaderServer } from "@/components/app-header-server";
import { SettingsSubnav } from "@/components/settings/settings-subnav";
import { SubscriptionStatusBadge } from "@/components/admin/status-badge";
import { ServiceKeyList } from "@/components/service-key-list";

export const metadata: Metadata = {
  title: "Subscription",
};

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/40 py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** Days remaining, phrased the way an owner reads it. */
function daysRemainingLabel(daysLeft: number, status: string): string {
  if (status === "EXPIRED") return "Expired";
  if (status === "CANCELLED") return "Cancelled";
  if (daysLeft < 0) return "Expired";
  if (daysLeft === 0) return "Today";
  return `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
}

function SummaryCard({
  subscription,
  daysLeft,
  status,
}: {
  subscription: SubscriptionView;
  daysLeft: number;
  status: string;
}) {
  return (
    <div className="rounded-lg border p-4 text-sm">
      <Row label="Current plan" value={subscription.planName} />
      <Row
        label="Plan type"
        value={subscription.isFree ? "Free" : "Paid"}
      />
      {/* The resolved entitlement set, not the raw stored field: a venue on a
          pre-snapshot subscription still sees the services it actually has. */}
      <div className="border-t py-3">
        <p className="mb-2 text-muted-foreground">Included services</p>
        <ServiceKeyList serviceKeys={subscription.serviceKeys} />
      </div>
      <Row
        label="Billing cycle"
        value={PLAN_BILLING_CYCLE_LABELS[subscription.billingCycle] ?? subscription.billingCycle}
      />
      <Row label="Term length" value={`${subscription.durationDays} days`} />
      <Row label="Start date" value={formatAdminDate(subscription.startDate)} />
      <Row label="Valid until" value={formatAdminDate(subscription.expiryDate)} />
      {subscription.gracePeriodDays > 0 && (
        <Row
          label="Grace period"
          value={`${subscription.gracePeriodDays} days, until ${formatAdminDate(subscription.graceEndDate)}`}
        />
      )}
      <Row
        label="Days remaining"
        value={<span className={daysLeft <= 7 && daysLeft >= 0 ? "text-amber-600" : ""}>{daysRemainingLabel(daysLeft, status)}</span>}
      />
      <Row
        label="Status"
        value={
          <SubscriptionStatusBadge status={subscription.status} />
        }
      />
    </div>
  );
}

function PriceCard({ subscription }: { subscription: SubscriptionView }) {
  return (
    <div className="rounded-lg border p-4 text-sm">
      <Row label="List price" value={formatPaise(subscription.listPricePaise)} />
      <Row
        label="Discount"
        value={
          subscription.discountAmountPaise > 0
            ? `− ${formatPaise(subscription.discountAmountPaise)}`
            : formatPaise(0)
        }
      />
      <Row
        label="Amount payable"
        value={
          <span className="font-semibold">{formatPaise(subscription.finalPricePaise)}</span>
        }
      />
      <p className="pt-3 text-xs text-muted-foreground">
        Pricing is set by the ZYP POS team. Please contact your ZYP POS administrator to change
        plan, apply a discount or renew.
      </p>
    </div>
  );
}

function HistoryList({ history }: { history: SubscriptionHistoryView[] }) {
  if (history.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No renewals yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Change</th>
            <th className="px-3 py-2">Plan</th>
            <th className="px-3 py-2">Valid from</th>
            <th className="px-3 py-2">Valid until</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-right">When</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {history.map((h, i) => (
            <tr key={`${h.action}-${i}`} className="hover:bg-muted/40">
              <td className="px-3 py-2 capitalize">
                {h.action.replaceAll("_", " ").toLowerCase()}
              </td>
              <td className="px-3 py-2">
                {h.fromPlanName && h.toPlanName && h.fromPlanName !== h.toPlanName
                  ? `${h.fromPlanName} → ${h.toPlanName}`
                  : (h.toPlanName ?? h.fromPlanName ?? "—")}
              </td>
              <td className="px-3 py-2">{formatAdminDate(h.toStartDate)}</td>
              <td className="px-3 py-2">{formatAdminDate(h.toExpiryDate)}</td>
              <td className="px-3 py-2 text-right">
                {h.toFinalPricePaise != null ? formatPaise(h.toFinalPricePaise) : "—"}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {formatAdminDateTime(h.changedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function SubscriptionPageContent() {
  const auth = await requireAuth();

  // Deliberately NOT `requireRestaurant()`. The subscription gate redirects a
  // blocked venue before it can open any app page, which would hide the very
  // status and renewal history the owner needs in order to renew. This page is
  // a read-only billing view with no mutations, so it authenticates the
  // restaurant without consuming application access. Every other app page still
  // goes through `requireRestaurant()`.
  if (!auth.restaurantId) redirect("/onboarding/restaurant");
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect("/api/auth/signout?error=restaurant_not_found");
  const restaurantId = String(restaurant.id);

  const [subscription, access, history] = await Promise.all([
    getSubscriptionByRestaurantId(restaurantId),
    getSubscriptionAccess(restaurantId),
    listSubscriptionHistory(restaurantId),
  ]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer
        userName={auth.fullName}
        restaurantName={restaurant.name}
        restaurantLogoUrl={restaurant.logoUrl}
      />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Subscription</h1>
          <p className="text-sm text-muted-foreground">
            Your ZYP POS plan. This page is read-only — to change plan, apply a discount, renew
            or assign a subscription, please contact your ZYP POS administrator.
          </p>
        </div>
        <SettingsSubnav />

        {subscription ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h2 className="mb-2 text-sm font-medium">Summary</h2>
                <SummaryCard
                  subscription={subscription}
                  daysLeft={access.daysLeft}
                  status={access.status}
                />
              </div>
              <div>
                <h2 className="mb-2 text-sm font-medium">Pricing</h2>
                <PriceCard subscription={subscription} />
              </div>
            </div>

            <div className="mt-6">
              <h2 className="mb-2 text-sm font-medium">Renewal history</h2>
              <div className="rounded-lg border">
                <HistoryList history={history} />
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg border p-6 text-sm">
            <p className="font-medium">No active subscription</p>
            <p className="mt-1 text-muted-foreground">
              ZYP POS is not available to this restaurant until a plan is assigned. Please contact
              your ZYP POS administrator to get a subscription set up.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default async function SubscriptionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading subscription…</div>
        </div>
      }
    >
      <SubscriptionPageContent />
    </Suspense>
  );
}
