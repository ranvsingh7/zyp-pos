# Billing + Payments Module

Deliverable for the billing milestone. Covers bill generation from live orders,
GST-aware money math, split/partial/full payment capture, print & reprint of an
80mm receipt, cancellation, RBAC, tenant isolation, tests, and manual
verification.

## 1. Scope

Implemented (this milestone):

- **Generate bill** from any active/served/held order (`ORDER` snapshot, not the
  live document).
- **Payments**: record a CASH/UPI/CARD/OTHER payment of any amount (partial,
  split across methods, or full), and **complete payment** to settle the
  remaining due.
- **Atomic, transaction-less integrity**: an overpayment can never be recorded,
  a double-click can never double-charge, and generated/payment operations are
  idempotent under unique-key guards (no multi-document transactions — the
  local MongoDB does not support them).
- **GST engine** (integer paise): tax-exclusive and tax-inclusive, 5%/18%/…
  configured via `RestaurantSettings.defaultTaxRate`, CGST+SGST (intra-state)
  vs IGST (inter-state) per `gstScheme`, single "Tax" line for non-registered
  restaurants, optional service charge and round-off to the nearest rupee.
- **Order-level discount** (`Order.discountPaise`) captured into the bill and
  distributed across line items.
- **One bill per order**, sequential per-restaurant numbers `BILL-000001` …
  with a configurable alphanumeric prefix (`RestaurantSettings.billPrefix`).
- **Print / reprint** an 80mm thermal-styled receipt from the **stored bill
  snapshot** — reprint never re-reads the live order, menu or settings.
- **Payment flow updates the order**: full payment moves the order to `PAID`
  (+`paidAt`) and, for dine-in, releases the table back to `AVAILABLE`.
- **Cancellation**: unpaid bills can be cancelled with a reason (OWNER/MANAGER
  only); paid/refunded bills require a future refund/credit-note workflow.
- **Billing UI**: `/billing` list (status filters, number search, load-more,
  print, open), and `/orders/[id]` order page with a **BillingPanel** (Generate
  bill → payment modal → print). Header nav gains **Billing**; the POS active
  order context links straight to the order page.
- **Audit trail**: bill actions are recorded through the shared
  `TableAuditLogModel` (`BILL_GENERATED`, `BILL_PAYMENT_ADDED`, `BILL_PAID`,
  `BILL_CANCELLED`, `BILL_PRINTED`).

Not implemented (future): refunds/credit notes, partial-cancel, cash drawer,
Z-reports, payment gateways. Restaurant-wide tax, round-off, service charge
and numbering prefixes are configured on the tenant `/settings` page.

## 2. Files

Server layer:

| File | Purpose |
| --- | --- |
| `src/lib/billing/constants.ts` | Bill statuses (`DRAFT/UNPAID/PARTIAL/PAID/CANCELLED/REFUNDED`), payment methods, `GST_SCHEMES`, `BILLABLE_ORDER_STATUSES`, `PAYABLE_BILL_STATUSES`, numbering constants (`pad 6`, prefix default/limit), limits, RBAC role sets |
| `src/lib/billing/types.ts` | `BillView`, `BillItemView`, `PaymentView`, `BillListItemView` |
| `src/lib/billing/errors.ts` | `BillNotFoundError`, `BillValidationError`, `BillForbiddenError`, `BillAlreadyPaidError`, `BillNotPayableError`, `OverpaymentError`, `BillConflictError` |
| `src/lib/billing/validation.ts` | Zod schemas (generate, by-id, record/complete payment, cancel, list) |
| `src/lib/billing/permissions.ts` | `canReadBills` (all staff), `canManageBills` (OWNER/MANAGER/CASHIER), `canCancelBills` (OWNER/MANAGER) + asserts |
| `src/lib/billing/tax.ts` | Pure integer-paise engine: `calculateBill`, `calculateTaxBase`, `distributePaise`, `splitGst` |
| `src/lib/billing/bill-service.ts` | `generateBill`, `recordPayment`, `completePayment`, `cancelBill`, `markBillPrinted`, `getBill`, `getBillForOrder`, `listBills`, `formatBillNumber`/`normalizeBillPrefix`, views |
| `src/lib/billing/print.ts` | `buildBillHtml` — 80mm thermal-styled receipt from a stored `BillView` |
| `src/actions/billing/_shared.ts` | `BillingActionResult` + `wrapBillingAction` |
| `src/actions/billing/actions.ts` | 8 server actions (generate/get/getForOrder/record/complete/cancel/print + list), each with `requireAuth` + `requireRestaurant` + permission asserts |
| `src/models/Bill.ts` | Bill snapshot schema: money fields, tax config, order context, item snapshots, 6 indexes (unique `{restaurantId,orderId}`, unique `{restaurantId,billNumber}`, `restaurantId+billSequence`, `restaurantId+createdAt`, `restaurantId+paymentStatus`, `restaurantId+status`) |
| `src/models/Payment.ts` | Payment record schema + indexes (**unique partial** `{restaurantId, idempotencyKey}` where `idempotencyKey` exists, `restaurantId+billId+createdAt`, `restaurantId+createdAt`) |
| `src/models/TableAuditLog.ts` + `src/lib/tables/audit.ts` | Shared audit system extended with `BILL` entity + `BILL_*` actions; `recordAudit` (+ `recordTableAudit` alias) |

Supporting changes: `src/models/Order.ts` (added `discountPaise`, `paidAt`),
`src/lib/orders/{constants,validation,order-service}.ts`
(`ORDER_MAX_DISCOUNT_PAISE`, optional `discountPaise`, `paidAt` write),
`src/models/RestaurantSettings.ts` + `src/lib/restaurant-service.ts`
(`gstScheme` field, `INTRA_STATE` default), `src/lib/db/index.ts`
(`BillModel`/`PaymentModel` included in `syncIndexesOnce`).

Client layer:

| File | Purpose |
| --- | --- |
| `src/components/billing/billing-panel.tsx` | Order page panel: generate bill, money summary, discounts/taxes, Pay/Print/Reprint/Cancel |
| `src/components/billing/payment-modal.tsx` | Method buttons + amount field + **Record payment** / **Complete payment** |
| `src/components/billing/billing-list.tsx` | `/billing` list: status filters, search, load-more, print/open |
| `src/components/billing/print-bill-button.tsx` | Opens the receipt popup (80mm) synchronously in the click gesture |
| `src/components/orders/order-detail.tsx` | Order page shell (info + items + BillingPanel) |
| `src/app/billing/page.tsx`, `src/app/orders/[id]/page.tsx` | Routes |

Tests: `src/lib/billing/tax.test.ts`, `src/lib/billing/permissions.test.ts`,
`src/lib/billing/validation.test.ts`, `tests/billing.e2e.test.ts`
(18 scenarios + audit trail against a real MongoDB).

## 3. Data model

`Bill` (collection `bills`) is a **financial snapshot**: item lines record
immutable `nameSnapshot`/`variantNameSnapshot`/`unitPricePaise`/`quantity` plus
the per-line tax breakdown, and the document carries subtotal/discount/tax/service
charge/round-off/grand totals, the tax configuration that produced them, the
order context, and payment progress:

```
billNumber         // "BILL-000001", unique per restaurant
billSequence       // per-restaurant counter
status             // DRAFT | UNPAID | PARTIAL | PAID | CANCELLED | REFUNDED
paymentStatus      // mirror of status, kept in sync by the service (reporting)
items[] { menuItemId, nameSnapshot, variantId?, variantNameSnapshot?, quantity,
          unitPricePaise, taxableValuePaise, discountAmountPaise,
          taxRatePercent, cgstAmountPaise, sgstAmountPaise, igstAmountPaise,
          lineTotalPaise }
subtotal / discount / taxableAmount / cgst+sgst+igst / totalTaxPaise
taxRatePercent, taxInclusive, gstScheme, gstRegistered, gstin
serviceChargeEnabled/RatePercent/AmountPaise, roundOffEnabled/AmountPaise
grandTotalPaise, paidAmountPaise, dueAmountPaise
orderId/orderNumber/orderType, tableId?/tableNameSnapshot?, customerName?, customerPhone?
createdBy, paidAt?, cancelledBy?, cancelledAt?, cancellationReason?,
printedCount, printedAt?
```

`Payment` (collection `payments`):

```
restaurantId, billId, orderId, method (CASH|UPI|CARD|OTHER),
amountPaise, referenceNumber?, note?, receivedBy, idempotencyKey?
```

Only the bill's `status`/`paymentStatus`/`paidAmountPaise`/`dueAmountPaise`/
`paidAt` mutate after generation; the money and item columns never change.

## 4. Business rules

- **One bill per order**: `{restaurantId, orderId}` is unique. Double-submit
  returns the existing bill; a concurrent race recovers via the E11000 retry
  loop (re-sequence or return the winner).
- **Billable orders**: `OPEN / KOT_SENT… / HELD / BILLED`. `CANCELLED` and
  `PAID` orders are rejected; an order with zero lines is rejected. Generating a
  bill does **not** change the order status or the table.
- **Money math is deterministic integer paise** (`tax.ts`, unit-tested to lock
  exact printed amounts):
  - `subtotal − discount = taxable`; tax on top (exclusive) or derived
    backwards (inclusive).
  - GST split by `gstScheme`: CGST+SGST (intra) or IGST (inter); unregistered
    restaurants bill a single Tax line.
  - Service charge and round-off (nearest whole rupee) apply after tax; the
    `grandTotalPaise` is what the guest pays.
  - Discount and tax are distributed across lines with the largest-remainder
    method so the printed columns sum exactly to the totals.
- **Payments on a payable bill only** (`PAYABLE_BILL_STATUSES`):
  - `recordPayment(amount)` atomically reserves the money with
    `findOneAndUpdate` + an `$expr` overpay guard and a pipeline `$set` that
    advances `paidAmountPaise`/`dueAmountPaise`/`status` in the same write —
    an overpayment or a concurrent double-payment simply matches nothing and is
    rejected.
  - Full payment sets `PAID` + `paidAt`, moves the order to `PAID` (`paidAt`)
    and releases the dine-in table (only if no other active order sits on it).
  - **Idempotency**: `recordPayment` and `completePayment` accept an optional
    `idempotencyKey` (`crypto.randomUUID()` per attempt from the client). The
    unique partial index `{restaurantId, idempotencyKey}` prevents a second
    recorded payment; a keyed retry whose payment already landed reconciles and
    returns the bill instead of erroring. Un-keyed races are stopped by the
    atomic overpay guard (exactly one payment ever lands).
  - `completePayment` settles the current due in one call; settling an
    already-PAID bill is a no-op (returns the bill), never a duplicate.
  - Already-PAID bills reject further payments (`BillAlreadyPaidError`);
    cancelled/refunded bills reject all payments (`BillNotPayableError`).
- **Discount** is an order-level `discountPaise` (validated ≤ total at order
  time, cap ₹1,00,000); the bill re-uses the saved order value so the client
  can never set discounts at billing time.
- **Cancel**: unpaid bills only. OWNER/MANAGER. Records reason + `cancelledAt`.
  Idempotent on repeat. The order reverts to nothing — it stays in whatever
  status it was (typically the operator uses the existing order cancel instead).
- **Print**: renders the stored snapshot (never live data); `markBillPrinted`
  bumps `printedCount` for reprints. Popup opened synchronously in the click
  gesture to dodge popup blockers.
- **Audit**: every bill action writes a tenant-scoped `TableAuditLogModel`
  entry (fail-soft).

## 5. RBAC

| Role | View bills | Generate + pay | Cancel |
| --- | --- | --- | --- |
| OWNER | yes | yes | yes |
| MANAGER | yes | yes | yes |
| CASHIER | yes | yes | no |
| WAITER | yes | no | no |

Every write server action asserts the role before touching the DB; UI control
hiding is only ergonomics.

## 6. Duplicate-prevention strategy

1. Bill generation: unique `{restaurantId, orderId}` + E11000 retry loop.
2. Payment: one **atomic guarded update** (overpay guard) commits the balance
   and status transition in a single write — a concurrent second payment either
   finds the bill already `PAID`/`PARTIAL` and fails the guard, or is stopped by
   the unique idempotency key, never both succeed.
3. Keyed dedupe: the loser of a keyed race reconciles against the recorded
   payment (bounded retry) and returns the bill.
4. Client buttons disable while busy; server guards are the source of truth.
   Verified by `Promise.allSettled` race tests (keyed and un-keyed).

## 7. Tenant isolation

Every bill/payment/order query scopes by `restaurantId`; bill numbers and
sequences are per restaurant; a foreign restaurant can have its own
`BILL-000001`. Cross-tenant reads return `null`, cross-tenant writes throw
`BillNotFoundError`. Verified by E2E.

## 8. Tests & verification

Automated (187 total suite-wide, all passing; `npm run lint`, `npx tsc --noEmit`,
`npm run build` clean):

- `tax.test.ts` (11): exclusive/inclusive, intra/inter GST split, unregistered,
  discount + clamping, service charge + round-off, `distributePaise`, column-sum
  invariants.
- `permissions.test.ts` (3): read/manage/cancel matrix.
- `validation.test.ts` (8): malformed ids, amount bounds, methods, reason
  length, paging defaults/coercion.
- `tests/billing.e2e.test.ts` (18 + audit): sequential `BILL-000001/2`,
  idempotent double-generate, generate does not disturb order/table, held order
  billable, cancelled/unknown rejected, snapshot immutability after menu price
  change, discount line-split, full payment → order `PAID` + table released +
  re-pay rejected, split CASH+UPI, partial-then-complete idempotency, overpay
  rejection (no stray payments), keyed double-click dedupe, un-keyed race,
  takeaway settle without tables, GST by settings (exclusive intra + inclusive
  inter), print marker, cancel/paid-cancel rules, filters + tenant isolation,
  not-found, audit entries.

Manual (`scripts/`-style against the dev server + demo restaurant — follow the
`pos-kot.js` pattern): generate bill for a table order (number, snapshot lines),
double-click generate (one bill), pay in full → table becomes AVAILABLE +
order PAID, split ₹1000 as cash 400 + UPI 600, partial 500 then complete,
attempt an overpay (blocked), reprint after changing a menu price (totals
unchanged), TAKEAWAY and QUICK_SALE bills, cancel an unpaid bill, cross-tenant
denial, cashier sees no cancel button and waiter sees no pay button.

### Fixes found during verification

- **Native driver return shape**: `BillModel.collection.findOneAndUpdate`
  returns the document directly (not `{ value }`), so `updatedRaw?.value` was
  `undefined` — the payment committed while the service threw `OverpaymentError`
  and skipped the payment/order steps. The service now tolerates both shapes.
- **`PaymentModal` rupees/paise mismatch**: the amount field displayed paise as
  rupees. Now it renders rupees via `paiseToRupees` and parses back through
  `rupeesToPaise`; a "Full" button resets to the remaining due.
- **Form-reset-in-effect lint**: opening the payment dialog is now handled by
  conditional mounting in the parent (fresh state per open) instead of a
  setState-in-effect, which the project's React hooks rules forbid.

## 9. Known limitations / next module

- Refund/credit-note workflow (cancelling a **paid** bill is rejected).
- Per-item tax rates are configurable on the menu; the restaurant-wide
  defaults are edited on `/settings`.
- Round-off, service charge and GST scheme are edited on `/settings`
  (restaurant-facing, owner/manager only). Existing bills keep their
  snapshotted values.
- Cash drawer, Z-report, payment gateways not wired.