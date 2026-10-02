import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader, Pagination, FilterSelect, formatDateTime } from "@/components/admin/admin-common";
import { PaymentStatusBadge } from "@/components/admin/status-badge";
import { EditPaymentDialog, RefundPaymentButton } from "@/components/admin/payment-actions";
import { listPayments } from "@/lib/admin/payment-service";
import { paymentsFilterSchema } from "@/lib/admin/query";
import { formatPaise } from "@/lib/menu/prices";
import { SUBSCRIPTION_PAYMENT_STATUS_LABELS } from "@/lib/admin/view-labels";
import type { SubscriptionPaymentStatus } from "@/lib/admin/constants";

const STATUSES: SubscriptionPaymentStatus[] = ["PENDING", "PAID", "FAILED", "REFUNDED"];

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const parsed = paymentsFilterSchema.safeParse({
    search: q("search"),
    status: q("status"),
    restaurantId: q("restaurantId"),
    page: q("page"),
    pageSize: q("pageSize"),
  });
  const filters = parsed.success ? parsed.data : { search: undefined, status: undefined, restaurantId: undefined, page: 1, pageSize: 25 };

  const result = await listPayments({ search: filters.search ?? undefined, status: filters.status ?? undefined, restaurantId: filters.restaurantId ?? undefined, page: filters.page, pageSize: filters.pageSize });
  const makeHref = (page: number) =>
    `/admin/payments?${new URLSearchParams({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.restaurantId ? { restaurantId: filters.restaurantId } : {}),
      page: String(page),
    }).toString()}`;

  return (
    <>
      <PageHeader title="Payments" description="All subscription payment records and invoices." />
      <form method="GET" action="/admin/payments" className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="search" defaultValue={filters.search ?? ""} placeholder="Search invoice or reference…" className="max-w-xs" />
        <FilterSelect
          name="status"
          defaultValue={filters.status ?? ""}
          placeholder="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: SUBSCRIPTION_PAYMENT_STATUS_LABELS[s] }))}
        />
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/payments" />}>Clear</Button>
      </form>

      <Card>
        <CardContent className="pt-6">
          {result.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No payments found.</p>
          ) : (
            <div className="space-y-2">
              {result.items.map((p) => (
                <div key={p.paymentId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">{p.invoiceNumber}</p>
                    <p className="truncate font-medium">{p.restaurantName}</p>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center justify-end gap-3 text-sm">
                    <span className="font-medium">{formatPaise(p.amountPaise)}</span>
                    <span className="text-xs text-muted-foreground">{p.paymentMethod.replace("_", " ")}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(p.paidAt)}</span>
                    <PaymentStatusBadge status={p.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <EditPaymentDialog payment={p} />
                    {p.status === "PAID" && <RefundPaymentButton payment={p} />}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Pagination page={filters.page} pageSize={filters.pageSize} total={result.total} makeHref={makeHref} />
        </CardContent>
      </Card>
    </>
  );
}