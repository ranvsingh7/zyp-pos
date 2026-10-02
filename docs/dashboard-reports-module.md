# Dashboard + Reports Module

Deliverable for the dashboard-reports milestone: real MongoDB aggregations power
the landing `/dashboard` and an eight-tab `/reports` area with server-generated
CSV exports. Covers the data layer, both routes, RBAC, tenant isolation, the
shared range wizard, tests and manual verification.

## 1. Scope

Implemented (this milestone):

- **Dashboard** at `/dashboard` — the default landing page. KPI strip (Total
  sales, Orders, Avg order value, Paid bills, Outstanding, Cancelled orders,
  Collected), a sales summary strip, Sales-by-day (area chart), hourly sales,
  payment-method donut, order-type bar chart, top items, category sales, recent
  orders, dining-floor occupancy and report shortcuts.
- **Date range wizard** — one shared `RangeFilter` drives the dashboard and every
  report tab (Today / Yesterday / Last 7 days / This month / Last month / Custom
  from–to), with business-day boundaries in `Asia/Kolkata`. URL params are the
  single source of truth and are fully validated (`date-range.ts`,
  `range-filter.tsx`).
- **Reports** at `/reports` with eight tabs, each server-rendered and paginated
  (25/page, clamped):
  - **Sales** — paid bills bucketed by `paidAt`, with search and summary.
  - **Payments** — every `Payment` record (split payments counted per method),
    with method chips and a per-method summary filter.
  - **Orders** — operational order log with type/status filters and joined bill
    status.
  - **Items** and **Categories** — product movement from paid bills only
    (post-discount line totals).
  - **GST** — tax-rate groups with CGST/SGST/IGST splits.
  - **Discounts** — every discounted paid bill.
  - **Cancellations** — cancelled orders + cancelled bills merged and paginated.
- **CSV exports** — server-generated at `/api/reports/export` for every tab
  (formula-injection hardened, rupee values in major units), auth + role checks
  run in the route, not the browser.
- **RBAC** (server-enforced on both pages and the export route; the UI only
  mirrors it): all roles open the reports area; waiters see operational tabs only
  (orders, items, categories, cancellations) and have dashboard money masked to a
  dash / zero; cashiers additionally see sales and payments; GST and discounts
  are OWNER/MANAGER only. A waiter hand-editing `?tab=gst` is server-redirected to
  the first visible tab (no redirect loop).
- **Tenant isolation** on every aggregation — `restaurantId` always derives from
  the session.

Not implemented (future): refunds/credit notes, KOT-level analytics per item
status, owner-only mid-shift snapshots, PDF/excel exports.

## 2. Files

Server / pure layers:

| File | Purpose |
| --- | --- |
| `src/lib/reports/constants.ts` | `REPORT_TABS`, `REPORT_TAB_LABELS`, `REPORT_DATE_RANGES`, `REPORT_DATE_RANGE_LABELS`, role maps (`REPORTS_READ_ROLES`, `FINANCIAL_READ_ROLES`, `SALES_READ_ROLES`, `OPERATIONAL_READ_ROLES`, `REPORT_TAB_ROLES`, `DASHBOARD_READ_ROLES`, `DASHBOARD_FINANCIAL_ROLES`), `REPORT_PAGE_SIZE`, `DASHBOARD_TOP_ITEMS`, `DASHBOARD_RECENT_ORDERS`, `REPORT_SEARCH_MAX`, `SALE_BILL_STATUSES`, `NON_REVENUE_BILL_STATUSES` |
| `src/lib/reports/date-range.ts` | `getBusinessDateRange` (single source of truth for every window, reuses `src/lib/orders/date-range`), `localYmdFromDate`, `localHourFromDate` — pure |
| `src/lib/reports/permissions.ts` | `canViewReports`, `canViewDashboard`, `canViewDashboardFinancials`, `canViewReportTab`, `visibleReportTabs`, `assert*`, `ReportForbiddenError` |
| `src/lib/reports/query.ts` | `parseReportQuery` — allow-list validation of URL state (pure) |
| `src/lib/reports/url.ts` | `reportQueryToParams`, `buildExportHref` — serialise a query into pagination/export URLs (pure) |
| `src/lib/reports/types.ts` | `ReportQuery`, `ReportPage<T>`, `DashboardSummary` (+ all sub-shapes) and the eight report result types |
| `src/lib/reports/dashboard-service.ts` | `getDashboardSummary(restaurantId, query, { includeFinancials })` — parallel MongoDB aggregations |
| `src/lib/reports/report-service.ts` | `getSalesReport`, `getPaymentReport`, `getOrderReport`, `getItemSalesReport`, `getCategorySalesReport`, `getGSTReport`, `getDiscountReport`, `getCancellationReport` |
| `src/lib/reports/shared.ts` | `toObjectId`, `resolveReportRange`, `loadStaffMap`, `paginate` |
| `src/lib/reports/csv.ts` | `toCsv` (quote/escape + `= + - @` injection hardening), `paiseToCsvRupees` — pure |
| `src/lib/reports/export.ts` | `buildReportExport` — rows/headers per tab; sales/payments/orders/discounts streamed one row at a time from MongoDB `cursor()`s, catalog/capped tabs buffered; `EXPORT_MAX_ROWS` (100k) guard |
| `src/models/Bill.ts`, `src/models/Order.ts` | new report indexes: Bill `{restaurantId,status,paidAt:-1}` and `{restaurantId,status,cancelledAt:-1}`, Order `{restaurantId,status,cancelledAt:-1}` |

Routes / client layer:

| File | Purpose |
| --- | --- |
| `src/app/dashboard/page.tsx` | Server route: auth, `includeFinancials` gate, `getDashboardSummary`, RangeFilter + all widgets |
| `src/app/reports/page.tsx` | Server route: auth + per-tab gate, redirect to first visible tab, tabs/toolbar/section mount |
| `src/app/api/reports/export/route.ts` | Server CSV download with per-tab role assertion |
| `src/components/dashboard/*` | `dashboard-kpis`, `sales-summary`, `charts` (recharts, client), `chart-cards`, `top-items`, `recent-orders`, `category-sales`, `quick-actions` |
| `src/components/reports/*` | `range-filter`, `stat-card`, `reports-tabs`, `reports-toolbar`, `report-table`, `pagination`, `report-sections` (all eight sections) |
| `src/components/app-header.tsx` | Reports added to `NAV_ITEMS` |

## 3. Design decisions

- **Revenue is recognised on `PAID` bills, bucketed by `paidAt`** (business time).
  This matches the Orders summary card and makes the split-payment rule
  reconcile exactly: a ₹1,000 bill paid Cash ₹400 + UPI ₹600 appears in Sales as
  ₹1,000 and in Payments as two rows totalling ₹1,000, each method counted once.
- **Payments** are bucketed by `Payment.createdAt` and bills with a terminal
  status (CANCELLED/REFUNDED) are excluded, so refund stubs never count as
  collection.
- **Everything money-related is server-side**: no frontend math on paise. The UI
  only formats. Waiters get `financialsHidden` data (money fields zeroed) or a
  visual dash.
- **One range resolver** (`getBusinessDateRange`) for dashboard and all eight
  tabs guarantees yesterday-today-7d-this-month-last-month-custom agree, so
  Sales totals and the dashboard strip always reconcile.
- **Sales/stock reports use live `menuitems`/`menucategories` lookups** for names
  and categories (no snapshot); a missing category is shown as "Uncategorised"
  and a renamed item keeps its bill snapshot name in top-items.
- **Custom range semantics**: inclusive from, exclusive to (local midnight of
  `to` + 1 day), so browsing "today" is contiguous even across DST-less IST.

## 4. Tests

| File | Covers |
| --- | --- |
| `src/lib/reports/date-range.test.ts` | IST boundaries for every preset incl. month/year wrapping, custom range, `localYmd`/`localHour` |
| `src/lib/reports/query.test.ts` | allow-listed tab/date/page/filters, custom only when valid, search cap, array params |
| `src/lib/reports/csv.test.ts` | quoting, CRLF, formula-injection neutralisation, `paiseToCsvRupees` |
| `src/lib/reports/permissions.test.ts` | per-role tab visibility incl. `visibleReportTabs` ordering |
| `tests/reports.e2e.test.ts` | real-MongoDB suite (`restopos_reports_e2e`): dashboard + waiter masking, split-payment #45 + sales↔payments↔orders reconciliation, item/category from paid bills only, GST CGST/SGST split, discounts, cancellations, all date windows, tenant isolation, pagination/clamping, CSV export content |

Run: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` (all green).
Plus `tests/*.e2e.test.ts` need the local mongod on `127.0.0.1:27018`.

## 5. Manual verification

`node /var/folders/qc/2jxn_t_97550jnb6tb_lzstw0000gn/T/opencode/pwtest/report-verify.js`
(Playwright against `next dev` on :3000 with `/tmp/pos-{owner,cashier,waiter}.jwt`,
demo restaurant **Demo Spice Kitchen**). 25 checks: dashboard widgets + range
presets, all eight tabs for owner, CSV download name/content, cashier payments +
GST redirect, waiter operational-only tabs, no CSV for waiters, server redirect
on a hand-edited financial URL, masked dashboard money.

## 6. Known caveats

- `orders` CSV export includes order/cancellation amounts; the route still
  enforces the tab role, and waiters get no export button at all.
- Category/item sales reflect current menu links for category grouping only;
  historical menu edits don't rewrite past bills.
- Custom "from > to" is normalised to an empty window (no totals shown).