import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader, formatDate, formatDateTime } from "@/components/admin/admin-common";
import { SubscriptionStatusBadge, PaymentStatusBadge } from "@/components/admin/status-badge";
import { SubscriptionActions } from "@/components/admin/subscription-actions";
import { EditRestaurantDialog, SuspendRestaurantDialog, ReactivateRestaurantDialog, TransferRestaurantDialog } from "@/components/admin/restaurant-actions";
import { EditPaymentDialog, RefundPaymentButton } from "@/components/admin/payment-actions";
import { getRestaurantById } from "@/lib/admin/restaurant-admin-service";
import { listPlans } from "@/lib/admin/plan-service";
import { listPayments } from "@/lib/admin/payment-service";
import { listSubscriptionHistory } from "@/lib/admin/subscription-service";
import { formatPaise } from "@/lib/menu/prices";
import { PLAN_BILLING_CYCLE_LABELS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/admin/view-labels";
import { ServiceKeyList } from "@/components/service-key-list";

export default async function AdminRestaurantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const restaurant = await getRestaurantById(id);
  if (!restaurant) notFound();

  const [plans, payments, history] = await Promise.all([
    listPlans({ includeInactive: true }),
    listPayments({ restaurantId: id, pageSize: 10 }),
    listSubscriptionHistory(id),
  ]);

  const sub = restaurant.subscription;
  // The subscription document has no payment columns; the money trail lives in
  // the payment ledger, so the newest record is what "latest payment" means.
  const latestPayment = payments.items[0] ?? null;

  return (
    <>
      <PageHeader
        title={restaurant.name}
        description={`${restaurant.city}, ${restaurant.state} · ${restaurant.businessType}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/restaurants" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
            <EditRestaurantDialog restaurant={restaurant} />
            {restaurant.isActive ? (
              <SuspendRestaurantDialog restaurant={restaurant} />
            ) : (
              <ReactivateRestaurantDialog restaurant={restaurant} />
            )}
            <TransferRestaurantDialog restaurant={restaurant} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Restaurant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Phone" value={restaurant.phone} />
            <Row label="Email" value={restaurant.email ?? "—"} />
            <Row label="Address" value={restaurant.address} />
            <Row label="Pincode" value={restaurant.pincode} />
            <Row label="GST" value={restaurant.gstRegistered ? (restaurant.gstin ?? "Registered") : "Not registered"} />
            <Row label="Status" value={restaurant.isActive ? "Active" : "Suspended"} />
            <Row label="Created" value={formatDateTime(restaurant.createdAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {restaurant.owner ? (
              <>
                <Row label="Name" value={restaurant.owner.fullName} />
                <Row label="Email" value={restaurant.owner.email} />
                <Row label="Phone" value={restaurant.owner.phone ?? "—"} />
              </>
            ) : (
              <p className="text-muted-foreground">No owner assigned.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Tax configuration</CardTitle>
            <CardDescription>
              Per-restaurant GST settings applied to new bills. Existing bills keep their snapshots.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {restaurant.taxSettings ? (
              <>
                <Row label="Tax enabled" value={restaurant.taxSettings.taxEnabled ? "Yes" : "No"} />
                <Row label="Default rate" value={`${restaurant.taxSettings.defaultTaxRate}%`} />
                <Row
                  label="CGST / SGST"
                  value={`${restaurant.taxSettings.cgstRatePercent}% / ${restaurant.taxSettings.sgstRatePercent}%`}
                />
                <Row label="IGST" value={`${restaurant.taxSettings.igstRatePercent}%`} />
                <Row label="Scheme" value={restaurant.taxSettings.gstScheme === "INTER_STATE" ? "IGST (inter-state)" : "CGST + SGST (intra-state)"} />
                <Row label="Prices include tax" value={restaurant.taxSettings.taxInclusive ? "Yes" : "No"} />
              </>
            ) : (
              <p className="text-muted-foreground">No tax settings found.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Subscription</CardTitle>
                <CardDescription>
                  {sub
                    ? `${sub.planName} · ${formatPaise(sub.finalPricePaise)} / ${PLAN_BILLING_CYCLE_LABELS[sub.billingCycle]}`
                    : "No subscription assigned yet."}
                </CardDescription>
              </div>
              {sub && <SubscriptionStatusBadge status={sub.status} />}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
              <div className="space-y-1 text-sm">
                {sub ? (
                  <>
                    <Row label="Plan" value={sub.planName} />
                    <Row label="Billing cycle" value={PLAN_BILLING_CYCLE_LABELS[sub.billingCycle]} />
                    <Row label="List price" value={formatPaise(sub.listPricePaise)} />
                    <Row
                      label="Discount"
                      value={
                        sub.discountAmountPaise > 0
                          ? `− ${formatPaise(sub.discountAmountPaise)}`
                          : formatPaise(0)
                      }
                    />
                    <Row
                      label="Final purchase price"
                      value={
                        <span className="font-semibold">{formatPaise(sub.finalPricePaise)}</span>
                      }
                    />
                    <Row label="Start date" value={formatDate(sub.startDate)} />
                    <Row
                      label="Expiry date"
                      value={`${formatDate(sub.expiryDate)} · ${sub.daysLeft} days left`}
                    />
                    <Row label="Status" value={SUBSCRIPTION_STATUS_LABELS[sub.status]} />
                    {/* What this venue can actually use, resolved through the
                        snapshot fallback like everywhere else. */}
                    <div className="border-t py-3">
                      <p className="mb-2 text-muted-foreground">Included services</p>
                      <ServiceKeyList serviceKeys={sub.serviceKeys} />
                    </div>
                    {sub.status === "SUSPENDED" && (
                      <>
                        <Row label="On hold since" value={sub.suspendedAt ? formatDateTime(sub.suspendedAt) : "—"} />
                        <Row label="Reason" value={sub.suspensionReason ?? "—"} />
                      </>
                    )}
                    <Row
                      label="Latest payment"
                      value={latestPayment ? `${formatPaise(latestPayment.amountPaise)} · ${latestPayment.paymentMethod.replace("_", " ")}` : "—"}
                    />
                    <Row
                      label="Payment reference"
                      value={
                        latestPayment?.transactionReference
                          ? latestPayment.transactionReference
                          : "—"
                      }
                    />
                    <Row label="Grace period" value={`${sub.gracePeriodDays} days`} />
                    <Row label="Auto-renew" value={sub.autoRenew ? "On" : "Off"} />
                    <Row label="Notes" value={sub.notes ?? "—"} />
                  </>
                ) : (
                  <p className="text-muted-foreground">Create a subscription to grant this restaurant access to the app.</p>
                )}
              </div>
              <SubscriptionActions
                restaurantId={restaurant.id}
                restaurantName={restaurant.name}
                subscription={sub}
                plans={plans}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent payments</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.items.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No payments recorded.</p>
            ) : (
              <div className="space-y-2">
                {payments.items.map((p) => (
                  <div key={p.paymentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <div>
                      <p className="font-mono text-xs">{p.invoiceNumber}</p>
                      <p className="text-sm font-medium">{formatPaise(p.amountPaise)} · {p.paymentMethod.replace("_", " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(p.paidAt)}
                        {p.transactionReference ? ` · ref ${p.transactionReference}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <PaymentStatusBadge status={p.status} />
                      <EditPaymentDialog payment={p} />
                      {p.status === "PAID" && <RefundPaymentButton payment={p} />}
                    </div>
                  </div>
                ))}
                <Link href={`/admin/payments?restaurantId=${restaurant.id}`} className="text-sm text-primary hover:underline">All payments →</Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription history</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No subscription changes yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l pl-4">
                {history.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="absolute -left-1.5 mt-1 size-2.5 rounded-full border bg-background" />
                    <p className="font-medium capitalize">{h.action.replaceAll("_", " ").toLowerCase()}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.fromPlanName && h.toPlanName && h.fromPlanName !== h.toPlanName
                        ? `${h.fromPlanName} → ${h.toPlanName}`
                        : h.toPlanName ?? h.fromPlanName ?? ""}
                      {h.fromFinalPricePaise != null && h.toFinalPricePaise != null && h.fromFinalPricePaise !== h.toFinalPricePaise
                        ? ` · ${formatPaise(h.fromFinalPricePaise)} → ${formatPaise(h.toFinalPricePaise)}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(h.changedAt)}
                      {h.changedByRole ? ` · ${h.changedByRole.replaceAll("_", " ")}` : ""}
                    </p>
                    {h.reason && <p className="text-xs text-muted-foreground italic">“{h.reason}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}