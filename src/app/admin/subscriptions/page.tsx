import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader, Pagination, SubscriptionTableRows, FilterSelect } from "@/components/admin/admin-common";
import { listSubscriptions } from "@/lib/admin/subscription-service";
import { listPlans } from "@/lib/admin/plan-service";
import { subscriptionsFilterSchema } from "@/lib/admin/query";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/admin/view-labels";
import type { SubscriptionStatus } from "@/lib/admin/constants";

const STATUSES: SubscriptionStatus[] = ["TRIAL", "ACTIVE", "EXPIRING", "GRACE_PERIOD", "EXPIRED", "SUSPENDED", "CANCELLED"];

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const parsed = subscriptionsFilterSchema.safeParse({
    search: q("search"),
    status: q("status"),
    planId: q("planId"),
    page: q("page"),
    pageSize: q("pageSize"),
  });
  const filters = parsed.success ? parsed.data : { search: undefined, status: undefined, planId: undefined, page: 1, pageSize: 25 };

  const [result, plans] = await Promise.all([
    listSubscriptions({
      search: filters.search ?? undefined,
      status: filters.status ?? undefined,
      planId: filters.planId ?? undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
    listPlans({ includeInactive: true }),
  ]);
  const makeHref = (page: number) =>
    `/admin/subscriptions?${new URLSearchParams({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.planId ? { planId: filters.planId } : {}),
      page: String(page),
    }).toString()}`;

  return (
    <>
      <PageHeader title="Subscriptions" description="Every tenant subscription across the platform." />
      <form method="GET" action="/admin/subscriptions" className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="search" defaultValue={filters.search ?? ""} placeholder="Search restaurant or id…" className="max-w-xs" />
        <FilterSelect
          name="status"
          defaultValue={filters.status ?? ""}
          placeholder="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: SUBSCRIPTION_STATUS_LABELS[s] }))}
        />
        <FilterSelect
          name="planId"
          defaultValue={filters.planId ?? ""}
          placeholder="All plans"
          options={plans.map((p) => ({ value: p.planId, label: p.name }))}
        />
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/subscriptions" />}>Clear</Button>
      </form>

      <Card>
        <CardContent className="pt-6">
          <SubscriptionTableRows subscriptions={result.items} />
          <Pagination page={filters.page} pageSize={filters.pageSize} total={result.total} makeHref={makeHref} />
        </CardContent>
      </Card>
    </>
  );
}