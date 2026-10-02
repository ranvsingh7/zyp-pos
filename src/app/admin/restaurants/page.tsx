import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader, Pagination, formatDate, formatDateTime } from "@/components/admin/admin-common";
import { SubscriptionStatusBadge } from "@/components/admin/status-badge";
import { CreateRestaurantDialog } from "@/components/admin/restaurant-actions";
import { listRestaurants } from "@/lib/admin/restaurant-admin-service";
import { listPlans } from "@/lib/admin/plan-service";
import { restaurantsFilterSchema } from "@/lib/admin/query";

export default async function AdminRestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const parsed = restaurantsFilterSchema.safeParse({
    search: q("search"),
    planId: q("planId"),
    page: q("page"),
    pageSize: q("pageSize"),
  });
  const filters = parsed.success ? parsed.data : { search: undefined, planId: undefined, page: 1, pageSize: 25 };

  const [result, plans] = await Promise.all([
    listRestaurants({
      search: filters.search ?? undefined,
      planId: filters.planId ?? undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
    listPlans({ includeInactive: true }),
  ]);

  const makeHref = (page: number) =>
    `/admin/restaurants?${new URLSearchParams({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.planId ? { planId: filters.planId } : {}),
      page: String(page),
    }).toString()}`;

  return (
    <>
      <PageHeader
        title="Restaurants"
        description="Tenant restaurant accounts and their subscription access."
        actions={<CreateRestaurantDialog plans={plans} />}
      />
      <form method="GET" action="/admin/restaurants" className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="search" defaultValue={filters.search ?? ""} placeholder="Search name, city, phone, owner…" className="max-w-xs" />
        <Button type="submit" variant="secondary" size="sm">Search</Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/restaurants" />}>Clear</Button>
      </form>

      <Card>
        <CardContent className="pt-6">
          {result.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No restaurants found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Restaurant</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">City</th>
                    <th className="px-3 py-2">Subscription</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Valid until</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.items.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Link href={`/admin/restaurants/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link>
                      </td>
                      <td className="px-3 py-2">
                        {r.owner ? (
                          <>
                            <span className="block">{r.owner.fullName}</span>
                            <span className="block text-xs text-muted-foreground">{r.owner.email}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">No owner</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{r.city}</td>
                      <td className="px-3 py-2">
                        {r.subscription ? r.subscription.planName : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.subscription ? (
                          <SubscriptionStatusBadge status={r.subscription.status} />
                        ) : (
                          <span className="text-xs text-muted-foreground">No subscription</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.subscription ? formatDate(r.subscription.expiryDate) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={filters.page} pageSize={filters.pageSize} total={result.total} makeHref={makeHref} />
        </CardContent>
      </Card>
    </>
  );
}