import type { Role } from "@/lib/auth/roles";

/**
 * Shared constants for the Dashboard + Reports module.
 *
 * Reporting must not leak one restaurant's numbers into another, so every
 * service derives `restaurantId` from the session and never from user input.
 * Role gates here are enforced server-side for both pages and the CSV export
 * route; hiding a tab in the UI is never the source of truth.
 */

export const REPORT_DATE_RANGES = [
  "today",
  "yesterday",
  "7d",
  "this_month",
  "last_month",
  "custom",
] as const;
export type ReportDateRange = (typeof REPORT_DATE_RANGES)[number];

export const REPORT_DATE_RANGE_LABELS: Record<ReportDateRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom range",
};

export const DEFAULT_REPORT_DATE_RANGE: ReportDateRange = "today";

export const REPORT_TABS = [
  "sales",
  "payments",
  "orders",
  "items",
  "categories",
  "gst",
  "discounts",
  "cancellations",
] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  sales: "Sales",
  payments: "Payments",
  orders: "Orders",
  items: "Items",
  categories: "Categories",
  gst: "GST",
  discounts: "Discounts",
  cancellations: "Cancellations",
};

export const DEFAULT_REPORT_TAB: ReportTab = "sales";

/** Anyone with a valid restaurant session may open the reports area. */
export const REPORTS_READ_ROLES: readonly Role[] = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
];

/**
 * Revenue / tax / discount figures. Waiters are deliberately excluded from
 * sensitive financial data; cashiers get the money-facing sales and payments
 * reports but not the tax/discount breakdowns.
 */
export const FINANCIAL_READ_ROLES: readonly Role[] = ["OWNER", "MANAGER"];
export const SALES_READ_ROLES: readonly Role[] = ["OWNER", "MANAGER", "CASHIER"];
export const OPERATIONAL_READ_ROLES: readonly Role[] = [
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
];

/** Which roles may see each report tab. */
export const REPORT_TAB_ROLES: Record<ReportTab, readonly Role[]> = {
  sales: SALES_READ_ROLES,
  payments: SALES_READ_ROLES,
  orders: OPERATIONAL_READ_ROLES,
  items: OPERATIONAL_READ_ROLES,
  categories: OPERATIONAL_READ_ROLES,
  gst: FINANCIAL_READ_ROLES,
  discounts: FINANCIAL_READ_ROLES,
  cancellations: OPERATIONAL_READ_ROLES,
};

/** Dashboard access (operational) and the financial KPI strip. */
export const DASHBOARD_READ_ROLES: readonly Role[] = OPERATIONAL_READ_ROLES;
export const DASHBOARD_FINANCIAL_ROLES: readonly Role[] = SALES_READ_ROLES;

/** Rows per page for paginated report tables. */
export const REPORT_PAGE_SIZE = 25;

/** Top-N limits for dashboard widgets. */
export const DASHBOARD_TOP_ITEMS = 5;
export const DASHBOARD_RECENT_ORDERS = 6;

/** Longest allowed free-text filter. */
export const REPORT_SEARCH_MAX = 80;

/** Bill statuses that represent a completed sale (revenue recognised). */
export const SALE_BILL_STATUSES = ["PAID"] as const;

/** Bill statuses excluded from revenue/collection reporting. */
export const NON_REVENUE_BILL_STATUSES = ["CANCELLED", "REFUNDED"] as const;
