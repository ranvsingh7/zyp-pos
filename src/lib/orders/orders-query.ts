import {
  DEFAULT_ORDER_SORT,
  ORDERS_PAYMENT_FILTERS,
  ORDER_SORTS,
  ORDER_STATUSES,
  ORDER_SEARCH_MAX,
  ORDER_TYPES,
  type OrderSort,
  type OrderStatus,
  type OrderType,
} from "./constants";
import type { BillStatus } from "@/lib/billing/constants";
import { isValidYmd, type DateRangeFilter } from "./date-range";

/** Pure ObjectId shape check — avoids importing mongoose into client code. */
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
function isObjectIdLike(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value);
}

/**
 * Parses and normalizes the Orders list `searchParams` from the URL into one
 * typed query object. Every value is validated against its allow-list;
 * invalid/unknown input falls back to the default instead of erroring, so the
 * page always renders even when the URL is hand-edited.
 */

export interface NormalizedOrdersQuery {
  q: string;
  date: DateRangeFilter;
  /** Custom range start, YYYY-MM-DD (only used when date === "custom"). */
  from: string | null;
  /** Custom range end, YYYY-MM-DD (only used when date === "custom"). */
  to: string | null;
  type: OrderType | "";
  status: OrderStatus | "";
  payment: BillStatus | "";
  table: string | null;
  staff: string | null;
  sort: OrderSort;
  page: number;
}

export type OrdersSearchParamValue = string | string[] | undefined | null;

function first(value: OrdersSearchParamValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function parseOrdersSearchParams(
  searchParams: Record<string, OrdersSearchParamValue>
): NormalizedOrdersQuery {
  const q = first(searchParams.q).trim().slice(0, ORDER_SEARCH_MAX);

  const dateRaw = first(searchParams.date);
  const date: DateRangeFilter = ["today", "yesterday", "7d", "month", "custom"].includes(dateRaw)
    ? (dateRaw as DateRangeFilter)
    : "today";

  const fromRaw = first(searchParams.from).trim();
  const toRaw = first(searchParams.to).trim();

  const typeRaw = first(searchParams.type);
  const type = (ORDER_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as OrderType)
    : "";

  const statusRaw = first(searchParams.status);
  const status = (
    ORDER_STATUSES as readonly string[]
  ).includes(statusRaw)
    ? (statusRaw as OrderStatus)
    : "";

  const paymentRaw = first(searchParams.payment);
  const payment = (
    ORDERS_PAYMENT_FILTERS as readonly string[]
  ).includes(paymentRaw)
    ? (paymentRaw as BillStatus | "")
    : "";

  const tableRaw = first(searchParams.table);
  const table = tableRaw && isObjectIdLike(tableRaw) ? tableRaw : null;

  const staffRaw = first(searchParams.staff);
  const staff = staffRaw && isObjectIdLike(staffRaw) ? staffRaw : null;

  const sortRaw = first(searchParams.sort);
  const sort = (ORDER_SORTS as readonly string[]).includes(sortRaw)
    ? (sortRaw as OrderSort)
    : DEFAULT_ORDER_SORT;

  const pageRaw = parseInt(first(searchParams.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return {
    q,
    date,
    from: isValidYmd(fromRaw) ? fromRaw : null,
    to: isValidYmd(toRaw) ? toRaw : null,
    type,
    status,
    payment,
    table,
    staff,
    sort,
    page,
  };
}

/** True when the query carries any filter/search beyond the defaults. */
export function isOrdersQueryFiltered(query: NormalizedOrdersQuery): boolean {
  return (
    query.q !== "" ||
    query.date !== "today" ||
    query.type !== "" ||
    query.status !== "" ||
    query.payment !== "" ||
    query.table !== null ||
    query.staff !== null
  );
}

/**
 * Serializes a query back into search params (used for toolbar builds and
 * pagination links so URL state is the single source of truth).
 */
export function ordersQueryToSearchParams(
  query: NormalizedOrdersQuery
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.date !== "today") params.set("date", query.date);
  if (query.date === "custom") {
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  }
  if (query.type) params.set("type", query.type);
  if (query.status) params.set("status", query.status);
  if (query.payment) params.set("payment", query.payment);
  if (query.table) params.set("table", query.table);
  if (query.staff) params.set("staff", query.staff);
  if (query.sort !== DEFAULT_ORDER_SORT) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}