/**
 * Restaurant-local date handling for the Orders module.
 *
 * Orders are stored with UTC `createdAt` timestamps, but "Today", "Yesterday"
 * and "This month" must be interpreted in the restaurant's own calendar day.
 * ZYP POS is INR-first, so the app timezone is fixed to Asia/Kolkata.
 *
 * All functions here are pure (no mongoose) so they can be unit-tested and used
 * by server and client safely. Ranges are UTC instants with an exclusive `to`.
 *
 * Note: the offset used is the one in effect near the target instant. This is
 * exact for fixed-offset zones such as Asia/Kolkata; zones with DST could see
 * a one-hour edge around a transition, which ZYP POS does not target.
 */

export const APP_TIMEZONE = "Asia/Kolkata";

export type DateRangeFilter = "today" | "yesterday" | "7d" | "month" | "custom";

export interface UtcRange {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl can report midnight as "24"; normalize back to 0.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Returns the local calendar date (year, 1-based month, day) of `date` in `tz`. */
export function getLocalYmd(
  date: Date,
  tz: string = APP_TIMEZONE
): { year: number; month: number; day: number } {
  const { year, month, day } = zonedParts(date, tz);
  return { year, month, day };
}

/**
 * UTC instant of local midnight for the calendar date y-m-d in `tz`.
 * e.g. 2025-03-15 00:00 IST === 2025-03-14T18:30:00.000Z.
 */
export function zonedMidnight(
  year: number,
  month: number,
  day: number,
  tz: string = APP_TIMEZONE
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const wall = zonedParts(new Date(guess), tz);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
  const offsetMs = wallAsUtc - guess;
  return new Date(guess - offsetMs);
}

/**
 * UTC instant of local midnight for the calendar day `dayOffset` days from
 * today (0 = today, -1 = yesterday, +1 = tomorrow) in `tz`.
 */
export function localMidnight(
  dayOffset: number,
  tz: string = APP_TIMEZONE,
  now: Date = new Date()
): Date {
  const { year, month, day } = getLocalYmd(now, tz);
  // Calendar arithmetic on the local date (Date.UTC normalizes overflows).
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return zonedMidnight(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    tz
  );
}

/** Local midnight of the given YYYY-MM-DD day (validated by the caller). */
export function localMidnightOfDate(
  ymd: string,
  tz: string = APP_TIMEZONE
): Date {
  const [year, month, day] = ymd.split("-").map((n) => Number(n));
  return zonedMidnight(year, month, day, tz);
}

/** Full UTC range of a single local calendar day. */
export function localDayRange(
  dayOffset: number,
  tz: string = APP_TIMEZONE,
  now: Date = new Date()
): UtcRange {
  return {
    from: localMidnight(dayOffset, tz, now),
    to: localMidnight(dayOffset + 1, tz, now),
  };
}

/**
 * Resolves a date filter into UTC boundaries. `to` is exclusive so a whole day
 * selection covers exactly one local day. `7d` includes today and the previous
 * six days; `month` runs from the first of the current local month to now.
 */
export function resolveDateRange(
  filter: DateRangeFilter,
  opts: { tz?: string; now?: Date; from?: string; to?: string } = {}
): UtcRange {
  const tz = opts.tz ?? APP_TIMEZONE;
  const now = opts.now ?? new Date();

  if (filter === "today") return localDayRange(0, tz, now);
  if (filter === "yesterday") return localDayRange(-1, tz, now);
  if (filter === "7d") {
    return { from: localMidnight(-6, tz, now), to: now };
  }
  if (filter === "month") {
    const { year, month } = getLocalYmd(now, tz);
    return { from: zonedMidnight(year, month, 1, tz), to: now };
  }
  // custom: from local midnight of `from`, to local midnight of `to` + 1 day.
  const from = opts.from
    ? localMidnightOfDate(opts.from, tz)
    : localDayRange(0, tz, now).from;
  const to = opts.to
    ? new Date(localMidnightOfDate(opts.to, tz).getTime() + 24 * 60 * 60 * 1000)
    : now;
  if (to < from) return { from, to: from };
  return { from, to };
}

/** True when `ymd` parses as a valid calendar date. */
export function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((n) => Number(n));
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const test = new Date(Date.UTC(year, month - 1, day));
  return (
    test.getUTCFullYear() === year &&
    test.getUTCMonth() === month - 1 &&
    test.getUTCDate() === day
  );
}