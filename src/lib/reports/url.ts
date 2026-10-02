import type { ReportQuery } from "./types";

/** Serializable subset of a report query for pagination / export URLs. */
export function reportQueryToParams(query: ReportQuery): Record<string, string> {
  const p: Record<string, string> = { tab: query.tab };
  if (query.date !== "today") p.date = query.date;
  if (query.from) p.from = query.from;
  if (query.to) p.to = query.to;
  if (query.orderType) p.type = query.orderType;
  if (query.status) p.status = query.status;
  if (query.method) p.method = query.method;
  if (query.q) p.q = query.q;
  return p;
}

/** Full query string builder for the CSV export link. */
export function buildExportHref(query: ReportQuery): string {
  const p = reportQueryToParams(query);
  const params = new URLSearchParams(p);
  params.set("type", query.tab);
  return `/api/reports/export?${params.toString()}`;
}