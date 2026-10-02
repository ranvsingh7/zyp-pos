/**
 * Deterministic date formatting for anything that is rendered in the browser.
 *
 * `toLocaleString()` and friends are only safe when the output is identical on
 * the server and the client. They are not, for two independent reasons:
 *
 *  1. **Locale.** With no locale argument they use the runtime default, which
 *     differs between Node and the browser. The same instant rendered as
 *     "29/09/2026, 13:29:38" on the server and "29/9/2026, 1:29:38 pm" in the
 *     client is the classic symptom, and React discards the whole server
 *     subtree when it happens.
 *  2. **Timezone.** Even with an explicit locale, the result still depends on
 *     the runtime's local timezone. A server in UTC and a browser in
 *     Asia/Kolkata disagree for every timestamp except midnight.
 *
 * So every formatter here pins *both*: a fixed locale and a fixed timezone. The
 * two runtimes then cannot disagree, and there is nothing to hydrate.
 *
 * Deliberately free of `server-only`: this is imported by client components.
 * The server-only admin helpers in `@/lib/admin/date-utils` re-export from
 * here so both sides of the app format identically by construction.
 *
 * Timestamps are stored and transported as UTC. This module only decides how
 * that instant is *displayed*; it never converts the stored value.
 */

/**
 * The single display timezone for the whole product.
 *
 * The admin panel already treated Asia/Kolkata as its display zone
 * (`DEFAULT_ADMIN_TIMEZONE`); this is now the one definition of it, exported
 * here because client components need it too.
 */
export const DISPLAY_TIMEZONE = "Asia/Kolkata";

/** Fixed so the server and the browser always agree on the pattern. */
const LOCALE = "en-IN";

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function format(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions,
  timezone: string
): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: timezone }).format(date);
}

/** e.g. "29 Sept 2026, 1:29 pm" — the default for audit and history tables. */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  timezone: string = DISPLAY_TIMEZONE
): string {
  return format(
    value,
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    },
    timezone
  );
}

/** e.g. "29 Sept 2026" */
export function formatDate(
  value: Date | string | number | null | undefined,
  timezone: string = DISPLAY_TIMEZONE
): string {
  return format(value, { day: "2-digit", month: "short", year: "numeric" }, timezone);
}

/** e.g. "1:29 pm" */
export function formatTime(
  value: Date | string | number | null | undefined,
  timezone: string = DISPLAY_TIMEZONE
): string {
  return format(value, { hour: "2-digit", minute: "2-digit", hour12: true }, timezone);
}

/** yyyy-mm-dd in the display timezone, for `<input type="date">` values. */
export function formatDateInput(
  value: Date | string | number | null | undefined,
  timezone: string = DISPLAY_TIMEZONE
): string {
  const date = toDate(value);
  if (!date) return "";
  // en-CA renders ISO-like yyyy-mm-dd, which is what the input expects.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}
