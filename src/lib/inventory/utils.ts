export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive exact matcher used for duplicate-name checks. */
export function exactCaseInsensitiveRegex(value: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}$`, "i");
}

/** Case-insensitive "contains" matcher used for list search. */
export function containsCaseInsensitiveRegex(value: string): RegExp {
  return new RegExp(escapeRegExp(value), "i");
}

/** Start of day (local) for a YYYY-MM-DD string, or null when invalid. */
export function ymdToStartOfDay(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** End of day (local, inclusive) for a YYYY-MM-DD string, or null. */
export function ymdToEndOfDay(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Builds a `createdAt`/`purchaseDate` range filter from YYYY-MM-DD bounds. */
export function dateRangeFilter(
  field: string,
  from: string | null,
  to: string | null
): Record<string, unknown> | null {
  const start = ymdToStartOfDay(from);
  const end = ymdToEndOfDay(to);
  if (!start && !end) return null;
  const range: Record<string, Date> = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;
  return { [field]: range };
}

export function toIso(value: unknown): string {
  return value ? new Date(value as string | number | Date).toISOString() : "";
}
