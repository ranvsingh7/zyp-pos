import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader, StatCard, SubscriptionTableRows } from "@/components/admin/admin-common";
import { getDashboardData } from "@/lib/admin/dashboard-service";
import { formatPaise } from "@/lib/menu/prices";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/admin/view-labels";
import type { SubscriptionStatus } from "@/lib/admin/constants";

const STATUS_ORDER: SubscriptionStatus[] = [
  "ACTIVE",
  "TRIAL",
  "EXPIRING",
  "GRACE_PERIOD",
  "EXPIRED",
  "SUSPENDED",
  "CANCELLED",
];

export default async function AdminDashboardPage() {
  const data = await getDashboardData();

  return (
    <>
      <PageHeader
        title="Platform dashboard"
        description="Overview of restaurants, subscriptions, and revenue."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Restaurants" value={data.totals.restaurants} sub={`${data.totals.activeRestaurants} active`} />
        <StatCard label="Subscriptions (MRR)" value={formatPaise(data.mrrPaise)} sub="monthly-equivalent recurring revenue" />
        <StatCard label="Revenue this month" value={formatPaise(data.revenue.thisMonthPaise)} sub={`${data.revenue.paymentCountThisMonth} payments`} />
        <StatCard label="New restaurants" value={data.newRestaurantsThisMonth} sub="this month" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Subscription status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{SUBSCRIPTION_STATUS_LABELS[status]}</span>
                <span className="font-medium">{data.subscriptionCounts[status]}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue</CardTitle>
            <CardDescription>Paid subscription receipts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="This month" value={formatPaise(data.revenue.thisMonthPaise)} />
              <StatCard label="This year" value={formatPaise(data.revenue.thisYearPaise)} />
              <StatCard label="All time" value={formatPaise(data.revenue.totalPaise)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Expiring soon</CardTitle>
              <Link href="/admin/expiring" className="text-sm text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent><SubscriptionTableRows subscriptions={data.expiringSoon} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Trial ending within 7 days</CardTitle>
              <Link href="/admin/expiring" className="text-sm text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent><SubscriptionTableRows subscriptions={data.pendingTrialEnd} /></CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>By plan</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {data.byPlan.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No plan data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Plan</th>
                      <th className="px-3 py-2">Subscriptions</th>
                      <th className="px-3 py-2">Paid</th>
                      <th className="px-3 py-2">MRR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.byPlan.map((row) => (
                      <tr key={row.planId}>
                        <td className="px-3 py-2 font-medium">{row.planName}</td>
                        <td className="px-3 py-2">{row.count}</td>
                        <td className="px-3 py-2">{row.paidCount}</td>
                        <td className="px-3 py-2">{formatPaise(row.mrrPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.expired.length > 0 && (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Expired</CardTitle>
                <Link href="/admin/expired" className="text-sm text-primary hover:underline">View all</Link>
              </div>
            </CardHeader>
            <CardContent><SubscriptionTableRows subscriptions={data.expired} /></CardContent>
          </Card>
        </div>
      )}
    </>
  );
}