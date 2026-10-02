"use client";

import * as React from "react";
import { useTransition } from "react";
import { Search, ShieldCheck, ShieldAlert, Download, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { listAuditLogsAction } from "@/actions/audit/actions";
import type { AuditLogView } from "@/lib/audit/audit-service";
import { formatDateTime } from "@/lib/format/date";

interface StaffOption {
  id: string;
  fullName: string;
  role: string;
}

export interface AuditLogViewerProps {
  initial: {
    rows: AuditLogView[];
    total: number;
    page: number;
    pageSize: number;
  };
  actions: string[];
  resourceTypes: string[];
  staff: StaffOption[];
}

interface Filters {
  fromYmd: string;
  toYmd: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  success: "" | "true" | "false";
  search: string;
}

const EMPTY_FILTERS: Filters = {
  fromYmd: "",
  toYmd: "",
  actorUserId: "",
  action: "",
  resourceType: "",
  success: "",
  search: "",
};

function RowStatus({ success }: { success: boolean }) {
  if (success) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
        <ShieldCheck className="size-3" /> Success
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600">
      <ShieldAlert className="size-3" /> Failure
    </span>
  );
}

function toCountLabel(total: number): string {
  return `${total} ${total === 1 ? "entry" : "entries"}`;
}

export function AuditLogViewer({ initial, actions, resourceTypes, staff }: AuditLogViewerProps) {
  const [rows, setRows] = React.useState<AuditLogView[]>(initial.rows);
  const [total, setTotal] = React.useState(initial.total);
  const [page, setPage] = React.useState(initial.page);
  const [pageSize] = React.useState(initial.pageSize);
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const runQuery = React.useCallback(
    (nextFilters: Filters, nextPage: number) => {
      startTransition(async () => {
        setError(null);
        const result = await listAuditLogsAction({ ...nextFilters, page: nextPage });
        if (result.success && result.data) {
          setRows(result.data.rows);
          setTotal(result.data.total);
          setPage(result.data.page);
        } else {
          setError(result.message ?? "Could not load audit logs.");
        }
      });
    },
    []
  );

  const applyFilters = (next: Filters) => {
    setFilters(next);
    runQuery(next, 1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
    runQuery(EMPTY_FILTERS, 1);
  };

  const exportUrl = React.useMemo(() => {
    const params = new URLSearchParams();
    if (filters.fromYmd) params.set("fromYmd", filters.fromYmd);
    if (filters.toYmd) params.set("toYmd", filters.toYmd);
    if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
    if (filters.action) params.set("action", filters.action);
    if (filters.resourceType) params.set("resourceType", filters.resourceType);
    if (filters.success) params.set("success", filters.success);
    if (filters.search) params.set("search", filters.search);
    const qs = params.toString();
    return `/api/audit/export${qs ? `?${qs}` : ""}`;
  }, [filters]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            From
            <input
              type="date"
              value={filters.fromYmd}
              onChange={(e) => setFilters({ ...filters, fromYmd: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            To
            <input
              type="date"
              value={filters.toYmd}
              onChange={(e) => setFilters({ ...filters, toYmd: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Staff
            <select
              value={filters.actorUserId}
              onChange={(e) => setFilters({ ...filters, actorUserId: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">All staff</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Action
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Resource
            <select
              value={filters.resourceType}
              onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">All resources</option>
              {resourceTypes.map((r) => (
                <option key={r} value={r}>
                  {r.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Outcome
            <select
              value={filters.success}
              onChange={(e) => setFilters({ ...filters, success: e.target.value as Filters["success"] })}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">All outcomes</option>
              <option value="true">Success</option>
              <option value="false">Failure</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Resource id / search
            <input
              type="search"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters(filters);
              }}
              placeholder="Order / bill # or id…"
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => applyFilters(filters)}
              disabled={isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <Search className="size-3.5" /> Apply
            </button>
            <button
              type="button"
              onClick={resetFilters}
              disabled={isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              <RotateCcw className="size-3.5" /> Reset
            </button>
            <a
              href={exportUrl}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Download className="size-3.5" /> Export CSV
            </a>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Filters are applied server-side. Exports re-run the same tenant-scoped,
          role-checked query.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">Time</th>
              <th className="px-3 py-2.5 font-medium">Staff</th>
              <th className="px-3 py-2.5 font-medium">Role</th>
              <th className="px-3 py-2.5 font-medium">Action</th>
              <th className="px-3 py-2.5 font-medium">Resource</th>
              <th className="px-3 py-2.5 font-medium">Resource ID</th>
              <th className="px-3 py-2.5 font-medium">Outcome</th>
              <th className="px-3 py-2.5 font-medium">Reason / IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  No audit entries match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium">
                    {row.actorName ?? "System"}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {row.actorRole ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{row.actorRole}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                    {row.action}
                  </td>
                  <td className="px-3 py-2.5">{row.resourceType}</td>
                  <td className="max-w-40 truncate px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {row.resourceId ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <RowStatus success={row.success} />
                  </td>
                  <td className="max-w-56 truncate px-3 py-2.5 text-xs text-muted-foreground">
                    {row.reason && <span className="block truncate">{row.reason}</span>}
                    {row.ip && <span className="block truncate font-mono">{row.ip}</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {toCountLabel(total)} · page {page} of {pageCount}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending || page <= 1}
            onClick={() => runQuery(filters, page - 1)}
            className={cn(
              "inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted",
              "disabled:opacity-50"
            )}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={isPending || page >= pageCount}
            onClick={() => runQuery(filters, page + 1)}
            className={cn(
              "inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted",
              "disabled:opacity-50"
            )}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}