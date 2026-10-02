import {
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from "./constants";

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
function isObjectIdLike(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value);
}

export const INVENTORY_FILTERS = [
  "all",
  "in",
  "low",
  "out",
  "inactive",
] as const;
export type InventoryFilter = (typeof INVENTORY_FILTERS)[number];

export const INVENTORY_SORTS = [
  "name",
  "stock_asc",
  "stock_desc",
  "value_desc",
  "cost_desc",
  "recent",
] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];

export const DEFAULT_INVENTORY_SORT: InventorySort = "name";

export const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export function isValidYmd(value: string): boolean {
  return YMD_PATTERN.test(value);
}

export type SearchParamValue = string | string[] | undefined | null;
export type SearchParamsRecord = Record<string, SearchParamValue>;

function first(value: SearchParamValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parsePage(value: SearchParamValue): number {
  const parsed = parseInt(first(value), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export interface NormalizedInventoryQuery {
  q: string;
  filter: InventoryFilter;
  categoryId: string | null;
  sort: InventorySort;
  page: number;
}

export function parseInventorySearchParams(
  searchParams: SearchParamsRecord
): NormalizedInventoryQuery {
  const q = first(searchParams.q).trim().slice(0, 80);

  const filterRaw = first(searchParams.filter);
  const filter = (INVENTORY_FILTERS as readonly string[]).includes(filterRaw)
    ? (filterRaw as InventoryFilter)
    : "all";

  const categoryRaw = first(searchParams.category).trim();
  const categoryId =
    categoryRaw && isObjectIdLike(categoryRaw) ? categoryRaw : null;

  const sortRaw = first(searchParams.sort);
  const sort = (INVENTORY_SORTS as readonly string[]).includes(sortRaw)
    ? (sortRaw as InventorySort)
    : DEFAULT_INVENTORY_SORT;

  return { q, filter, categoryId, sort, page: parsePage(searchParams.page) };
}

export function inventoryQueryToSearchParams(
  query: NormalizedInventoryQuery
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.categoryId) params.set("category", query.categoryId);
  if (query.sort !== DEFAULT_INVENTORY_SORT) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export interface NormalizedPurchaseQuery {
  q: string;
  from: string | null;
  to: string | null;
  page: number;
}

export function parsePurchaseSearchParams(
  searchParams: SearchParamsRecord
): NormalizedPurchaseQuery {
  const fromRaw = first(searchParams.from).trim();
  const toRaw = first(searchParams.to).trim();
  return {
    q: first(searchParams.q).trim().slice(0, 80),
    from: isValidYmd(fromRaw) ? fromRaw : null,
    to: isValidYmd(toRaw) ? toRaw : null,
    page: parsePage(searchParams.page),
  };
}

export function purchaseQueryToSearchParams(
  query: NormalizedPurchaseQuery
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export interface NormalizedMovementQuery {
  q: string;
  type: StockMovementType | "";
  itemId: string | null;
  from: string | null;
  to: string | null;
  page: number;
}

export function parseMovementSearchParams(
  searchParams: SearchParamsRecord
): NormalizedMovementQuery {
  const typeRaw = first(searchParams.type);
  const type = (STOCK_MOVEMENT_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as StockMovementType)
    : "";

  const itemRaw = first(searchParams.item).trim();
  const fromRaw = first(searchParams.from).trim();
  const toRaw = first(searchParams.to).trim();

  return {
    q: first(searchParams.q).trim().slice(0, 80),
    type,
    itemId: itemRaw && isObjectIdLike(itemRaw) ? itemRaw : null,
    from: isValidYmd(fromRaw) ? fromRaw : null,
    to: isValidYmd(toRaw) ? toRaw : null,
    page: parsePage(searchParams.page),
  };
}

export function movementQueryToSearchParams(
  query: NormalizedMovementQuery
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.itemId) params.set("item", query.itemId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}
