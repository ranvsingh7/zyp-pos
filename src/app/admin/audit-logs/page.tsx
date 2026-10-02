import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader, Pagination, FilterSelect, formatDateTime } from "@/components/admin/admin-common";
import { listPlatformAuditLogs, TABLE_AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/admin/audit-logs-service";
import { auditLogFiltersSchema } from "@/lib/admin/query";

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const parsed = auditLogFiltersSchema.safeParse({
    action: q("action"),
    entityType: q("entityType"),
    search: q("search"),
    dateFrom: q("dateFrom"),
    dateTo: q("dateTo"),
    page: q("page"),
    pageSize: q("pageSize"),
  });
  const filters = parsed.success
    ? parsed.data
    : { action: undefined, entityType: undefined, search: undefined, dateFrom: undefined, dateTo: undefined, page: 1, pageSize: 25 };

  const result = await listPlatformAuditLogs({
    action: filters.action ?? undefined,
    entityType: filters.entityType ?? undefined,
    search: filters.search ?? undefined,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    page: filters.page,
    pageSize: filters.pageSize,
  });

  const makeHref = (page: number) =>
    `/admin/audit-logs?${new URLSearchParams({
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
      page: String(page),
    }).toString()}`;

  return (
    <>
      <PageHeader title="Audit logs" description="Immutable platform-wide security and admin events." />
      <form method="GET" action="/admin/audit-logs" className="mb-4 flex flex-wrap items-center gap-2">
        <Input name="search" defaultValue={filters.search ?? ""} placeholder="Search summary or entity…" className="max-w-xs" />
        <FilterSelect
          name="action"
          defaultValue={filters.action ?? ""}
          placeholder="All actions"
          options={TABLE_AUDIT_ACTIONS.map((a) => ({ value: a, label: a }))}
        />
        <FilterSelect
          name="entityType"
          defaultValue={filters.entityType ?? ""}
          placeholder="All entity types"
          options={AUDIT_ENTITY_TYPES.map((e) => ({ value: e, label: e }))}
        />
        <Input type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ""} className="w-40" />
        <Input type="date" name="dateTo" defaultValue={filters.dateTo ?? ""} className="w-40" />
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/audit-logs" />}>Clear</Button>
      </form>

      <Card>
        <CardContent className="pt-6">
          {result.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No audit events found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Entity</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.items.map((log) => (
                    <tr key={log.id} className="align-top hover:bg-muted/40">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{formatDateTime(log.createdAt)}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">{log.action}</span>
                      </td>
                      <td className="px-3 py-2">
                        <p>{log.entityName ?? log.entityType}</p>
                        <p className="text-xs text-muted-foreground">{log.restaurantName ?? log.restaurantId ?? ""}</p>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{log.summary ?? "—"}</td>
                      <td className="px-3 py-2">
                        <p>{log.actorName ?? "System"}</p>
                        <p className="text-xs text-muted-foreground">{log.actorRole}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} makeHref={makeHref} />
        </CardContent>
      </Card>
    </>
  );
}