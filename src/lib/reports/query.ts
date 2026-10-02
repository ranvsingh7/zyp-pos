/**
 * Pure parsing/validation of report search params. Kept free of mongoose and
 * `server-only` so it can be unit-tested and reused by pages and the CSV
 * export route.
 */

import {
  BILL_PAYMENT_METHODS,
  type BillPaymentMethod,
} from "@/lib/billing/constants";
import {
  ORDER_STATUSES,
  ORDER_TYPES,
  type OrderStatus,
  type OrderType,
} from "@/lib/orders/constants";
import { isValidYmd } from "@/lib/orders/date-range";
import {
  DEFAULT_REPORT_DATE_RANGE,
  DEFAULT_REPORT_TAB,
  REPORT_DATE_RANGES,
  REPORT_SEARCH_MAX,
  REPORT_TABS,
  type ReportDateRange,
  type ReportTab,
} from "./constants";
import type { ReportQuery } from "./types";

export type SearchParamValue = string | string[] | undefined;
export type SearchParams = Record<string, SearchParamValue>;

function first(value: SearchParamValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isTab(value: string): value is ReportTab {
  return (REPORT_TABS as readonly string[]).includes(value);
}

function isRange(value: string): value is ReportDateRange {
  return (REPORT_DATE_RANGES as readonly string[]).includes(value);
}

function isOrderType(value: string): value is OrderType {
  return (ORDER_TYPES as readonly string[]).includes(value);
}

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

function isMethod(value: string): value is BillPaymentMethod {
  return (BILL_PAYMENT_METHODS as readonly string[]).includes(value);
}

export function parseReportQuery(params: SearchParams = {}): ReportQuery {
  const rawTab = first(params.tab);
  const rawRange = first(params.date);

  const tab = isTab(rawTab) ? rawTab : DEFAULT_REPORT_TAB;
  const date = isRange(rawRange) ? rawRange : DEFAULT_REPORT_DATE_RANGE;

  const rawFrom = first(params.from).trim();
  const rawTo = first(params.to).trim();
  const from = date === "custom" && isValidYmd(rawFrom) ? rawFrom : null;
  const to = date === "custom" && isValidYmd(rawTo) ? rawTo : null;

  const rawPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;

  const rawType = first(params.type);
  const rawStatus = first(params.status);
  const rawMethod = first(params.method);

  return {
    tab,
    date,
    from,
    to,
    page,
    q: first(params.q).trim().slice(0, REPORT_SEARCH_MAX),
    orderType: isOrderType(rawType) ? rawType : "",
    status: isOrderStatus(rawStatus) ? rawStatus : "",
    method: isMethod(rawMethod) ? rawMethod : "",
  };
}
