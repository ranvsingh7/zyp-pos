"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { localMidnight } from "@/lib/orders/date-range";
import {
  REPORT_DATE_RANGE_LABELS,
  type ReportDateRange,
} from "@/lib/reports/constants";
import { localYmdFromDate } from "@/lib/reports/date-range";

/**
 * Shared date-range selector for the Dashboard and every Reports tab.
 * URL search params are the single source of truth: any change re-renders the
 * page server-side. Preserves unrelated query params (report tab, filters)
 * while resetting pagination.
 */
export function RangeFilter({
  date,
  from,
  to,
}: {
  date: ReportDateRange;
  from: string | null;
  to: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(params: URLSearchParams) {
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function nextParams(): URLSearchParams {
    return new URLSearchParams(searchParams.toString());
  }

  function setRange(next: ReportDateRange) {
    const params = nextParams();
    if (next === "today") params.delete("date");
    else params.set("date", next);
    params.delete("from");
    params.delete("to");
    params.delete("page");
    if (next === "custom") {
      params.set("from", localYmdFromDate(localMidnight(-6)));
      params.set("to", localYmdFromDate(localMidnight(0)));
    }
    go(params);
  }

  function setCustomDate(key: "from" | "to", value: string) {
    const params = nextParams();
    params.set("date", "custom");
    params.set(key, value);
    params.delete("page");
    go(params);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1">
        {(Object.keys(REPORT_DATE_RANGE_LABELS) as ReportDateRange[]).map(
          (option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                date === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {REPORT_DATE_RANGE_LABELS[option]}
            </button>
          )
        )}
      </div>

      {date === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from ?? ""}
            onChange={(e) => setCustomDate("from", e.currentTarget.value)}
            className="w-36"
            aria-label="From date"
          />
          <span className="text-sm text-muted-foreground">→</span>
          <Input
            type="date"
            value={to ?? ""}
            onChange={(e) => setCustomDate("to", e.currentTarget.value)}
            className="w-36"
            aria-label="To date"
          />
        </div>
      )}

      <span className="text-xs text-muted-foreground">
        {REPORT_DATE_RANGE_LABELS[date]}
        {date === "custom" && from && to ? ` (${from} → ${to})` : ""}
      </span>
    </div>
  );
}