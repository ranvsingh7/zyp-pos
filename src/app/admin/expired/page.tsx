import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, Pagination, SubscriptionTableRows } from "@/components/admin/admin-common";
import { listSubscriptions } from "@/lib/admin/subscription-service";

export default async function AdminExpiredPage({
  searchParams: _searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await _searchParams;
  const q = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const page = Math.max(1, Number(q("page") ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(q("pageSize") ?? 25)));

  const result = await listSubscriptions({ search: undefined, status: "EXPIRED", page, pageSize });

  return (
    <>
      <PageHeader title="Expired" description="Subscriptions past their grace period. Tenant access is blocked." />
      <Card>
        <CardContent className="pt-6">
          <SubscriptionTableRows subscriptions={result.items} />
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            makeHref={(p) => `/admin/expired?${new URLSearchParams({ page: String(p) }).toString()}`}
          />
        </CardContent>
      </Card>
    </>
  );
}