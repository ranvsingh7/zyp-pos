/** UI-safe date/time formatters for the Orders module (ISO strings → en-IN). */

import {
  formatDate as formatDateImpl,
  formatDateTime as formatDateTimeImpl,
  formatTime as formatTimeImpl,
} from "@/lib/format/date";

/**
 * These are rendered inside client components, so they must produce byte-identical
 * output on the server and in the browser or React throws a hydration error. All
 * three delegate to `@/lib/format/date`, which pins both the locale and the
 * timezone; the local names are kept because six components import them.
 */
export function formatDateTime(iso: string | null | undefined): string {
  return formatDateTimeImpl(iso);
}

export function formatTime(iso: string | null | undefined): string {
  return formatTimeImpl(iso);
}

export function formatShortDate(iso: string | null | undefined): string {
  return formatDateImpl(iso);
}
