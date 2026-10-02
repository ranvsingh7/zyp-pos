export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive exact-name matcher used for duplicate checks. */
export function exactCaseInsensitiveRegex(value: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}$`, "i");
}

let collator: Intl.Collator | undefined;

/**
 * Natural, case-insensitive comparison so that "T2" sorts before "T10".
 * Used as a stable secondary sort key when displayOrder ties.
 */
export function naturalCompare(a: string, b: string): number {
  if (!collator) {
    collator = new Intl.Collator("en", {
      numeric: true,
      sensitivity: "base",
    });
  }
  return collator.compare(a, b);
}