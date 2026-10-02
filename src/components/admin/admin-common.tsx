import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscriptionStatusBadge, PaymentStatusBadge } from "@/components/admin/status-badge";
import { formatPaise } from "@/lib/menu/prices";
import type { SubscriptionView } from "@/lib/admin/subscription-service";
import type { PaymentView } from "@/lib/admin/payment-service";
import { formatDate as formatDateImpl, formatDateTime as formatDateTimeImpl } from "@/lib/format/date";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function FilterSelect({
  name,
  defaultValue,
  placeholder,
  options,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <option value="">{placeholder ?? "All"}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function formatDate(date: Date | null | undefined): string {
  return formatDateImpl(date);
}

export function formatDateTime(date: Date | null | undefined): string {
  return formatDateTimeImpl(date);
}

export function Pagination({
  page,
  pageSize,
  total,
  makeHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  makeHref: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {total === 0 ? "No results" : `Page ${page} of ${totalPages} · ${total} total`}
      </span>
      <div className="flex gap-2">
        {prev && <Link className="rounded-md border px-3 py-1.5 hover:bg-accent" href={makeHref(prev)}>Previous</Link>}
        {next && <Link className="rounded-md border px-3 py-1.5 hover:bg-accent" href={makeHref(next)}>Next</Link>}
      </div>
    </div>
  );
}

export function SubscriptionTableRows({ subscriptions }: { subscriptions: SubscriptionView[] }) {
  if (subscriptions.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No subscriptions found.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Restaurant</th>
            <th className="px-3 py-2">Plan</th>
            <th className="px-3 py-2">Price</th>
            <th className="px-3 py-2">Expiry</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {subscriptions.map((s) => (
            <tr key={s.subscriptionId} className="hover:bg-muted/40">
              <td className="px-3 py-2 font-medium">{s.restaurantName}</td>
              <td className="px-3 py-2">{s.planName}</td>
              <td className="px-3 py-2">{formatPaise(s.finalPricePaise)}</td>
              <td className="px-3 py-2">{formatDate(s.expiryDate)}</td>
              <td className="px-3 py-2"><SubscriptionStatusBadge status={s.status} /></td>
              <td className="px-3 py-2 text-right">
                <Link href={`/admin/restaurants/${s.restaurantId}`} className="text-primary hover:underline">View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentTableRows({ payments }: { payments: PaymentView[] }) {
  if (payments.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No payments found.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Invoice</th>
            <th className="px-3 py-2">Restaurant</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">Method</th>
            <th className="px-3 py-2">Paid at</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {payments.map((p) => (
            <tr key={p.paymentId} className="hover:bg-muted/40">
              <td className="px-3 py-2 font-mono text-xs">{p.invoiceNumber}</td>
              <td className="px-3 py-2 font-medium">{p.restaurantName}</td>
              <td className="px-3 py-2">{formatPaise(p.amountPaise)}</td>
              <td className="px-3 py-2">{p.paymentMethod.replace("_", " ")}</td>
              <td className="px-3 py-2">{formatDate(p.paidAt)}</td>
              <td className="px-3 py-2"><PaymentStatusBadge status={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}