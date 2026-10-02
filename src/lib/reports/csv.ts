/**
 * Minimal CSV serialization for server-generated report downloads.
 * Pure (no dependencies) so it can be unit-tested.
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  const raw = value === null || value === undefined ? "" : String(value);
  // CSV/formula injection hardening: a leading = + - @ can execute in some
  // spreadsheet apps, so neutralize it.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function csvLine(cells: CsvCell[]): string {
  return cells.map(escapeCell).join(",");
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [csvLine(headers)];
  for (const row of rows) {
    lines.push(csvLine(row));
  }
  // Trailing newline keeps POSIX tools and Excel happy.
  return `${lines.join("\r\n")}\r\n`;
}

/** Rupee value for CSV cells (major units, 2 decimals). */
export function paiseToCsvRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}
