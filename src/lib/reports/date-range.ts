/**
 * The single source of truth for report date windows.
 *
 * Dashboard and every report must resolve "Today", "This month", etc. the same
 * way or their totals will not reconcile. All boundaries are computed in the
 * restaurant's business timezone (Asia/Kolkata) and returned as UTC instants
 * with an exclusive `to`, so a whole local day is covered exactly once.
 *
 * Pure / dependency-free (except the shared timezone helpers) so it can be
 * unit-tested and used on both server and client.
 */

import {
  APP_TIMEZONE,
  getLocalYmd,
  localDayRange,
  localMidnight,
  localMidnightOfDate,
  zonedMidnight,
  type UtcRange,
} from "@/lib/orders/date-range";
import {
  DEFAULT_REPORT_DATE_RANGE,
  type ReportDateRange,
} from "./constants";

export interface BusinessRangeOptions {
  tz?: string;
  now?: Date;
  /** YYYY-MM-DD for the custom range start (inclusive). */
  from?: string;
  /** YYYY-MM-DD for the custom range end (inclusive). */
  to?: string;
}

/**
 * Resolves a report range filter into UTC boundaries.
 *
 * - today       : [local midnight today, local midnight tomorrow)
 * - yesterday   : [local midnight yesterday, local midnight today)
 * - 7d          : [local midnight 6 days ago, now)
 * - this_month  : [1st of this local month, now)
 * - last_month  : [1st of last local month, 1st of this local month)
 * - custom      : [local midnight `from`, local midnight `to` + 1 day)
 */
export function getBusinessDateRange(
  filter: ReportDateRange = DEFAULT_REPORT_DATE_RANGE,
  opts: BusinessRangeOptions = {}
): UtcRange {
  const tz = opts.tz ?? APP_TIMEZONE;
  const now = opts.now ?? new Date();

  switch (filter) {
    case "today":
      return localDayRange(0, tz, now);
    case "yesterday":
      return localDayRange(-1, tz, now);
    case "7d":
      return { from: localMidnight(-6, tz, now), to: now };
    case "this_month": {
      const { year, month } = getLocalYmd(now, tz);
      return { from: zonedMidnight(year, month, 1, tz), to: now };
    }
    case "last_month": {
      const { year, month } = getLocalYmd(now, tz);
      // Normalize month-1 to a real calendar month (Jan -> Dec of prev year).
      const prev = new Date(Date.UTC(year, month - 2, 1));
      const prevYear = prev.getUTCFullYear();
      const prevMonth = prev.getUTCMonth() + 1;
      return {
        from: zonedMidnight(prevYear, prevMonth, 1, tz),
        to: zonedMidnight(year, month, 1, tz),
      };
    }
    case "custom":
    default: {
      const from = opts.from
        ? localMidnightOfDate(opts.from, tz)
        : localDayRange(0, tz, now).from;
      const to = opts.to
        ? new Date(
            localMidnightOfDate(opts.to, tz).getTime() + 24 * 60 * 60 * 1000
          )
        : now;
      if (to < from) return { from, to: from };
      return { from, to };
    }
  }
}

/** Local YYYY-MM-DD for a UTC instant (used to bucket sales per business day). */
export function localYmdFromDate(
  date: Date,
  tz: string = APP_TIMEZONE
): string {
  const { year, month, day } = getLocalYmd(date, tz);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Local hour (0-23) for a UTC instant. */
export function localHourFromDate(
  date: Date,
  tz: string = APP_TIMEZONE
): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(date)
  ) % 24;
}

export type { UtcRange };
