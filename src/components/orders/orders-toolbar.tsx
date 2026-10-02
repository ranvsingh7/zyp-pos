"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw, Search, X } from "lucide-react";
import { cn } from "cn";
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
  DEFAULT_ORDER_SORT,
  ORDER_STATUS_LABELS,
  ORDER_TYPES,
  ORDER_STATUSES,
  ORDERS_PAYMENT_FILTERS,
  orderTypeLabel,
} from "@/lib/orders/constants";
import { BILL_STATUS_LABELS } from "@/lib/billing/constants";
import {
  getLocalYmd,
  localMidnight,
} from "@/lib/orders/date-range";
import type { DateRangeFilter } from "@/lib/orders/date-range";
import {
  isOrdersQueryFiltered,
  type NormalizedOrdersQuery,
} from "@/lib/orders/orders-query";

const DATE_OPTIONS: { value: DateRangeFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

function ymdOf(date: Date): string {
  const { year, month, day } = getLocalYmd(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface OrdersToolbarProps {
  query: NormalizedOrdersQuery;
  tables: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; fullName: string; role: string }>;
}

/**
 * The Orders list filter bar. Every change is reflected into the URL's
 * search params (URL state is the single source of truth and the list is
 * re-rendered on the server), with the search box debounced to avoid
 * spamming navigation.
 */
export function OrdersToolbar({ query, tables, staff }: OrdersToolbarProps) {
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
    return new URLSearchParams(searchParams.toString());
  }

  function setParam(params: URLSearchParams, key: string, value: string | null) {
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page");
  }

  // Debounced search → URL.
  useEffect(() => {
    const trimmed = search.trim();
    if (!searchTouched && trimmed === query.q) return;
    if (trimmed === query.q) return;
    const timer = window.setTimeout(() => {
      const params = nextParams();
      setParam(params, "q", trimmed);
      go(params);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function setDate(next: DateRangeFilter) {
    const params = nextParams();
    if (next === "today") params.delete("date");
    else params.set("date", next);
    params.delete("from");
    params.delete("to");
    params.delete("page");
    if (next === "custom") {
      const from = ymdOf(localMidnight(-6));
      const to = ymdOf(localMidnight(0));
      params.set("from", from);
      params.set("to", to);
    }
    go(params);
  }

  function setCustomDate(key: "from" | "to", value: string) {
    const params = nextParams();
    params.set("date", "custom");
    setParam(params, key, value);
    go(params);
  }

  function setFilter(
    key: "type" | "status" | "payment" | "table" | "staff" | "sort",
    value: string
  ) {
    const params = nextParams();
    if (key === "sort" && value === DEFAULT_ORDER_SORT) params.delete("sort");
    else setParam(params, key, value);
    go(params);
  }

  function clearFilters() {
    setSearch("");
    setSearchTouched(true);
    go(new URLSearchParams());
  }

  const filtered = isOrdersQueryFiltered(query);
  const dateLabels: Record<DateRangeFilter, string> = DATE_OPTIONS.reduce(
    (acc, o) => ({ ...acc, [o.value]: o.label }),
    {} as Record<DateRangeFilter, string>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              setSearchTouched(true);
            }}
            placeholder="Order #, customer, phone or table"
            className="pl-9 pr-9"
            aria-label="Search orders"
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

        <div className="flex items-center gap-2">
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFilters}
            >
              <RotateCcw className="size-4" />
              Reset
            </Button>
          )}
          <Select
            value={query.sort}
            onValueChange={(v) => setFilter("sort", v ?? DEFAULT_ORDER_SORT)}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="amount_desc">Amount: high to low</SelectItem>
              <SelectItem value="amount_asc">Amount: low to high</SelectItem>
              <SelectItem value="number">Order number</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1">
          {DATE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setDate(option.value)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                query.date === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {query.date === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={query.from ?? ""}
              onChange={(e) => setCustomDate("from", e.currentTarget.value)}
              className="w-36"
              aria-label="From date"
            />
            <span className="text-sm text-muted-foreground">→</span>
            <Input
              type="date"
              value={query.to ?? ""}
              onChange={(e) => setCustomDate("to", e.currentTarget.value)}
              className="w-36"
              aria-label="To date"
            />
          </div>
        )}

        <Select
          value={query.type || "all"}
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

        <Select
          value={query.status || "all"}
          onValueChange={(v) => setFilter("status", v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-40">
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

        <Select
          value={query.payment || "all"}
          onValueChange={(v) => setFilter("payment", v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="Payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            {ORDERS_PAYMENT_FILTERS.filter((p) => p !== "").map((p) => (
              <SelectItem key={p} value={p}>
                {BILL_STATUS_LABELS[p as keyof typeof BILL_STATUS_LABELS]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={query.table ?? "all"}
          onValueChange={(v) => setFilter("table", v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder="Table" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tables</SelectItem>
            {tables.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={query.staff ?? "all"}
          onValueChange={(v) => setFilter("staff", v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder="Created by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          Showing {dateLabels[query.date]}
          {query.date === "custom" && query.from && query.to
            ? ` (${query.from} → ${query.to})`
            : ""}
        </span>
      </div>
    </div>
  );
}