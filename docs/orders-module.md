# Orders Management Module

Deliverable for the orders-management milestone. The POS is where orders are
**created**; this module is where past and in-flight orders are **viewed,
searched, filtered, paginated, inspected and cancelled**. Covers the data layer,
the `/orders` list and `/orders/[id]` detail pages, RBAC, tenant isolation,
tests and manual verification.

## 1. Scope

Implemented (this milestone):

- **Order history list** at `/orders` — server-rendered, URL-driven state, for
  every role.
- **Search** across order number, customer name, customer phone and table name
  (`ORDER_SEARCH_MAX` = 80 chars, regex-escaped).
- **Filters**: date range (today / yesterday / last 7 days / this month / custom
  from–to), order type, order status, **bill payment status**, table, and
  creating staff.
- **Sort**: newest, oldest, amount (high→low / low→high), order number.
- **Pagination**: `ORDERS_PAGE_SIZE` = 25 per page, clamped to the last page.
- **KPI summary cards**: Today's Orders, Today's Sales (paid), Unpaid Bills,
  Paid Bills, Cancelled Orders.
- **Order detail** at `/orders/[id]` — items with historical snapshots, notes,
  totals (bill-preferred), KOT history with view/reprint, a status/payment
  timeline, the billing panel (generate/pay/print/cancel bill), cancellation,
  and a friendly 404.
- **Payment status join**: list rows show the bill's status/number/grand total
  when a live (non-terminal) bill exists, otherwise the order snapshot total.
- **RBAC**: read access for all four roles; cancellation still OWNER/MANAGER/
  CASHIER. Waiters never see financial mutation controls.
- **Tenant isolation** on every query; invalid/foreign ids resolve to `null`/`[]`.

Not implemented (future): exports/CSV, date-range presets beyond the above,
per-item status tracking, refunds (see the billing module).

## 2. Files

Server / pure layers:

| File | Purpose |
| --- | --- |
| `src/lib/orders/date-range.ts` | `APP_TIMEZONE` (Asia/Kolkata), `getLocalYmd`, `zonedMidnight`, `localMidnight`, `localMidnightOfDate`, `localDayRange`, `resolveDateRange`, `isValidYmd` — pure UTC range math with exclusive `to` |
| `src/lib/orders/orders-query.ts` | `parseOrdersSearchParams`, `isOrdersQueryFiltered`, `ordersQueryToSearchParams`, `NormalizedOrdersQuery` — allow-list validation for URL state (pure; safe in the client bundle) |
| `src/lib/orders/orders-management.ts` | **server-only** read service: `listOrders`, `getOrdersSummary`, `getOrderById`, `getOrderKots`, `getOrderBill`, `getOrderDetails`, `listOrderTables`, `listOrderStaff`, `loadStaffMap` |
| `src/lib/orders/format.ts` | `formatDateTime`, `formatTime`, `formatShortDate` (Asia/Kolkata) |
| `src/lib/orders/status-ui.ts` | `ORDER_STATUS_TONE`, `PAYMENT_STATUS_TONE`, `ORDER_TYPE_TONE` badge styling |
| `src/lib/orders/types.ts` | `OrderListRow`, `OrderListResult`, `OrdersSummary`, `StaffMember`, `StaffMap`, `OrderDetailsView`; `OrderView` gained `createdBy`/`cancelledBy`, `KotView` gained `createdAt`/`createdBy` |
| `src/lib/orders/constants.ts` | `ORDERS_READ_ROLES`, `ORDERS_MANAGE_ROLES`, `ORDERS_PAGE_SIZE`, `ORDERS_TYPE_FILTERS`, `ORDERS_STATUS_FILTERS`, `ORDERS_PAYMENT_FILTERS`, `ORDER_SORTS`, `DEFAULT_ORDER_SORT`, `ORDER_SEARCH_MAX` |
| `src/lib/orders/permissions.ts` | added `canViewOrders` / `assertCanViewOrders` |

Client layer:

| File | Purpose |
| --- | --- |
| `src/app/orders/page.tsx` | Server route: auth + `assertCanViewOrders`, parallel data fetch, Suspense |
| `src/app/orders/[id]/page.tsx` | Server route: `getOrderDetails`, passes `canManage`/`canCancelBill`/`canCancelOrder` |
| `src/app/orders/[id]/not-found.tsx` | Friendly 404 for missing/foreign orders |
| `src/components/orders/order-detail.tsx` | Detail page: header, badges, cancel, items/totals, KOT history, timeline, BillingPanel |
| `src/components/orders/orders-toolbar.tsx` | Debounced search + date/type/status/payment/table/staff/sort controls, reset |
| `src/components/orders/orders-table.tsx` | Desktop table + mobile cards, empty state, pagination, per-row View/Print |
| `src/components/orders/orders-summary.tsx` | Five KPI cards |
| `src/components/orders/orders-print.ts` | `openPrintWindow`, `writePrintWindow` helpers |

Supporting changes: `src/models/Order.ts` (indexes
`{restaurantId,status,createdAt}`, `{restaurantId,orderType,createdAt}`,
`{restaurantId,tableId,createdAt}`), `src/lib/db/index.ts` (`OrderModel`
`syncIndexes`), `src/lib/orders/order-service.ts` (`createdBy`/`cancelledBy` on
the view), `src/lib/orders/kot-service.ts` (`createdAt`/`createdBy` on the
view), `src/components/app-header.tsx` (**Orders** nav, `ListOrdered` icon),
`src/components/billing/billing-panel.tsx` (print gated behind `canManage` so
waiters never see an erroring print action).

Tests: `src/lib/orders/date-range.test.ts`,
`src/lib/orders/orders-query.test.ts`,
`src/lib/orders/permissions.test.ts`, `tests/orders-management.e2e.test.ts`
(20 scenarios against a real MongoDB, dedicated DB
`restopos_ordersmgr_e2e`).

## 3. Data layer

The module is **read-first** and never mutates historical snapshots:

- `listOrders(restaurantId, searchParams)` builds a tenant-scoped Mongo filter,
  resolves the date range to UTC, and (for the payment filter) first resolves
  matching bill `orderId`s so it can use the indexed `Bill.status`, then
  constrains orders by `_id`.
- `hydrateRows` joins **live bills** (`status ∉ {CANCELLED, REFUNDED}`) and staff
  names. When a bill exists it is authoritative for the amount/status/number;
  otherwise the order snapshot `totalPaise` is shown. `itemsCount` sums item
  quantities.
- `getOrdersSummary` runs two `$facet` aggregations (Orders and Bills) scoped to
  the restaurant: today's order count, all-time cancelled count, unpaid
  (`UNPAID`/`PARTIAL`) and paid bill counts, and today's paid sales (sum of
  `grandTotalPaise` for bills `PAID` with `paidAt` in today's local day).
- `getOrderDetails` composes the order view, its KOTs (oldest first), its bill,
  and a staff map covering every referenced user (creator, canceller, KOT
  authors, bill author, payment receivers).

Indexes added to support the list/summary: see §2. All money stays integer
paise; all dates are stored UTC and bucketed by `APP_TIMEZONE`.

## 4. Business rules

- **URL is the single source of truth.** `parseOrdersSearchParams` validates
  every value against its allow-list; anything unknown falls back to the default
  (`today`, `newest`, page 1) so a hand-edited URL still renders.
- **Local-day boundaries.** `resolveDateRange` returns UTC instants with an
  exclusive `to`. `today`/`yesterday` are whole local days; `7d` = today + the
  previous six; `month` = first local day of the month → now; `custom` treats
  both ends as inclusive local days (`to` becomes the next local midnight).
- **Payment filter** uses the **bill** lifecycle and excludes terminal bills;
  cancelled/refunded bills are never joined onto a row, so the row falls back to
  the order snapshot and is omitted from `PAID`/`PARTIAL`/`UNPAID` filters.
- **Search** is case-insensitive and regex-escaped. A digits-only query matches
  the exact order number **or** the textual fields (phone numbers are numeric).
- **Sorting** appends `_id` as a tiebreaker for deterministic paging; the
  `orderNumber` sort has a unique per-restaurant index.
- **Cancellation** is delegated to the existing `cancelOrder` action/order
  service (OWNER/MANAGER/CASHIER); the detail page only renders the control when
  `canCancelOrder`.
- **Billing** is delegated to `BillingPanel` and the billing actions; the detail
  page passes `canManage`/`canCancelBill`, and the bill snapshot is preferred for
  displayed totals once present.
- **Tenant isolation** everywhere: list/summary scope by `restaurantId`;
  single-order reads validate the ObjectId shape and tenant and otherwise return
  `null`/`[]`.

## 5. RBAC

| Role | View list/detail | Cancel order | Bill/pay/print/cancel bill |
| --- | --- | --- | --- |
| OWNER | yes | yes | yes |
| MANAGER | yes | yes | yes |
| CASHIER | yes | yes | yes |
| WAITER | yes | no | no |

`canViewOrders` allows all four; mutation controls are gated server-side by the
existing order/billing permission asserts, with UI hiding only as ergonomics.

## 6. UI notes

- Buttons render links with the project's Base UI convention:
  `render={<Link/>}` + `nativeButton={false}` (the project's Button has no
  `asChild`).
- The toolbar writes filters back with `router.replace`; the search box is
  debounced (400 ms) and the custom range exposes two date inputs.
- The table renders a desktop grid and a stacked mobile card list from the same
  rows, with Prev/Next pagination links.

## 7. Tests & verification

Automated (228 total suite-wide, all passing; `npm run lint`,
`npx tsc --noEmit`, `npm run build` clean):

- `date-range.test.ts` (12): local date/midnight math in Asia/Kolkata, all
  filters, inclusive custom ranges, `isValidYmd`.
- `orders-query.test.ts` (8): defaults, valid/array values, invalid fallbacks,
  search-length cap, round-trip serialization.
- `permissions.test.ts` (4): operate/cancel matrix + all roles can view.
- `tests/orders-management.e2e.test.ts` (20): list + join, empty page, tenant
  isolation, type/status filters, payment filter (incl. cancelled-bill
  exclusion), search by number/table/name/phone, local-day date filters,
  sorting, pagination clamping, KPI aggregation, single-order fetch (invalid/
  foreign), KOTs (tenant-scoped, oldest-first), bill fetch, full details with
  staff map, historical snapshot after a menu change, cancellation audit, table/
  staff filter sources, malformed-filter tolerance, one-bill-per-order.

Manual (dev server + demo restaurant, Playwright script — 51 checks, all
passing): `/orders` renders the 5 KPI cards and 4 seeded orders; debounced
search by number and customer; URL filters for status/type/payment/date (incl.
custom range) and sort; page clamping; order detail with KOT history, timeline
and billing panel; generate bill → complete payment → `BILL-000001 · PAID`
badge, "Bill settled" timeline entry, `payment=PAID` filter, and summary
Paid/Today's-sales updates; cancel an open order with a reason (status +
timeline + summary); invalid id → friendly 404; mobile card layout; and a
waiter session that can view orders but sees no cancel/generate controls.

### Fixes found during verification

- **Client bundle leak**: `orders-query.ts` (used by the client toolbar/table)
  imported `isValidObjectId` from `@/lib/menu/utils`, which pulled mongoose into
  the browser build and broke `next build`. Replaced with a pure 24-hex pattern
  check.
- **Timezone-correct local midnight**: the first implementation derived
  "local midnight" as the UTC midnight of the local calendar date, which is off
  by the zone offset (Asia/Kolkata is UTC+5:30). It now converts a local wall
  time to its UTC instant via `Intl.DateTimeFormat` parts.
- **Numeric search missed phone numbers**: digits-only queries only matched
  `orderNumber`. They now match the number or the textual fields.

## 8. Known limitations / next steps

- No CSV/print-all export of the list.
- Order status is the order-level value; no per-line kitchen progress view
  (KOT history is shown instead).
- Refunds/credit notes remain future work in the billing module.
