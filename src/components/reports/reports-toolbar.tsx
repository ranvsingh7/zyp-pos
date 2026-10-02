"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BILL_PAYMENT_METHOD_LABELS,
  BILL_PAYMENT_METHODS,
} from "@/lib/billing/constants";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  ORDER_TYPES,
  orderTypeLabel,
} from "@/lib/orders/constants";
import { REPORT_TAB_LABELS, type ReportTab } from "@/lib/reports/constants";
import { buildExportHref } from "@/lib/reports/url";
import type { ReportQuery } from "@/lib/reports/types";
import { RangeFilter } from "./range-filter";

interface ReportsToolbarProps {
  query: ReportQuery;
  showExport: boolean;
}

/**
 * Per-tab filter bar for the Reports page: date range (shared), tab-specific
 * selects, a debounced search box and the CSV export link. Every change goes
 * through the URL so the server re-renders the section.
 */
export function ReportsToolbar({ query, showExport }: ReportsToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(query.q);
  const [searchTouched, setSearchTouched] = useState(false);

  function go(params: URLSearchParams) {
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function nextParams(): URLSearchParams {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    return params;
  }

  useEffect(() => {
    const trimmed = search.trim();
    if (!searchTouched && trimmed === query.q) return;
    if (trimmed === query.q) return;
    const timer = window.setTimeout(() => {
      const params = nextParams();
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      go(params);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function setFilter(key: "type" | "status" | "method", value: string) {
    const params = nextParams();
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    go(params);
  }

  const exportHref = buildExportHref(query);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <RangeFilter date={query.date} from={query.from} to={query.to} />
        <div className="flex flex-wrap items-center gap-2">
          {showExport && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={exportHref} />}
            >
              <Download className="size-4" />
              CSV
            </Button>
          )}
          {query.tab === "items" || query.tab === "gst" ? null : (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.currentTarget.value);
                  setSearchTouched(true);
                }}
                placeholder={`Search ${REPORT_TAB_LABELS[query.tab].toLowerCase()}…`}
                className="pl-9 pr-8"
                aria-label="Search report"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSearchTouched(true);
                  }}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          )}
          <TabFilters query={query} setFilter={setFilter} />
        </div>
      </div>
    </div>
  );
}

function TabFilters({
  query,
  setFilter,
}: {
  query: ReportQuery;
  setFilter: (key: "type" | "status" | "method", value: string) => void;
}) {
  const tab: ReportTab = query.tab;

  if (tab === "orders" || tab === "sales") {
    return (
      <>
        <Select
          value={query.orderType || "all"}
          onValueChange={(v) => setFilter("type", v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder="Order type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ORDER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {orderTypeLabel[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tab === "orders" && (
          <Select
            value={query.status || "all"}
            onValueChange={(v) => setFilter("status", v ?? "all")}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ORDER_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </>
    );
  }

  if (tab === "payments") {
    return (
      <Select
        value={query.method || "all"}
        onValueChange={(v) => setFilter("method", v ?? "all")}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="Method" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All methods</SelectItem>
          {BILL_PAYMENT_METHODS.map((m) => (
            <SelectItem key={m} value={m}>
              {BILL_PAYMENT_METHOD_LABELS[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return null;
}