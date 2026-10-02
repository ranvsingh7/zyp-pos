import "server-only";

import { DEFAULT_ADMIN_TIMEZONE } from "./constants";
import {
  formatDate as formatDateImpl,
  formatDateTime as formatDateTimeImpl,
} from "@/lib/format/date";

/**
 * Single date utility for the SaaS admin panel. All subscription dates are
 * stored as UTC Dates; display happens in the configured admin timezone.
 * Every admin page/form uses these helpers — never inline `new Date(...)`
 * arithmetic so business rules (warning/grace windows) stay consistent.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function daysUntil(date: Date, now: Date = new Date()): number {
  // Whole days from the start of today until the start of `date`.
  const from = startOfUtcDay(now).getTime();
  const to = startOfUtcDay(date).getTime();
  return Math.round((to - from) / DAY_MS);
}

export function isUtcDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** yyyy-mm-dd (UTC) for query inputs / comparisons. */
export function toYmd(date: Date): string {
  const d = new Date(date);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Parse a UTC yyyy-mm-dd string into a date at 00:00 UTC. */
export function fromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function clampDays(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

/** Display helpers honouring the configured admin timezone. */
export function formatAdminDate(
  date: Date | string | null | undefined,
  timezone: string = DEFAULT_ADMIN_TIMEZONE
): string {
  return formatDateImpl(date, timezone);
}

export function formatAdminDateTime(
  date: Date | string | null | undefined,
  timezone: string = DEFAULT_ADMIN_TIMEZONE
): string {
  return formatDateTimeImpl(date, timezone);
}

/** Platform default business day count helper used by the dashboard. */
export function localMonthRange(now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

export function localYearRange(now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  return { from, to };
}