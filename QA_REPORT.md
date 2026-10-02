# ZYP POS — End-to-End Production-Readiness QA Report

Generated: 2026-09-24 · Scope: full-stack audit (frontend, backend, DB, auth, tenant isolation, billing, security, concurrency, UI/prerender). Every status below is backed by a test, a verified reproduction, or a documented SSR check.

---

## 1. Environment

| Component | Status |
|---|---|
| Unit/DB-connected test suite | **PASS** — 453/453 tests, 45 files green |
| TypeScript (`npm run typecheck`) | **PASS** — 0 errors |
| ESLint (`npm run lint`) | **PASS** — 0 errors |
| Production build (`npm run build`) | **PASS** |
| Test DBs | Isolated instances on the QA Mongo (27018): `restopos_qa`, `restopos_qa_race`; per-suite e2e DBs unchanged |
| SSR smoke server | Local `next start` against the smoke DB; routes, redirects, guards, tampered-cookie rejection exercised via HTTP |
| Interactive browser testing | **NOT VERIFIED** — no Playwright/headless browser in this environment; replaced by SSR/curl checks + full HTTP-level guard matrix |

---

## 2. Concurrency & data-integrity findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **P1** | Concurrent order creation could mint **duplicate public order numbers**. Reproduced head-on: 20 parallel TAKEAWAY `createOrder` calls yielded only 3 unique numbers on a fresh DB. Root cause: `nextOrderNumber` was a non-atomic max+1 read and `{restaurantId, orderNumber}` had **no unique index**, so concurrent writers silently duplicated numbers (breaks GST/billing lookup and legal invoicing lineage). | **FIXED** |
| 2 | P2 | Public `signupAction` had **no rate limiting** while login was throttled (5/15 min). Unthrottled signup allows account-flooding / spam / DB write-abuse. | **FIXED** |
| 3 | P2 | `Restaurant.ownerId` was index- but **not unique**; onboarding double-submit could bypass the service guard and orphan a second restaurant for one owner. | **FIXED** (defense-in-depth + race guard) |
| 4 | P2 | `Subscription.restaurantId` was **not unique** although the service enforces one-subscription-per-restaurant (billing/access gate depends on the invariant). | **FIXED** (defense-in-depth + race guard) |
| 5 | P3 | Deployment index sync (`syncIndexesOnce` in `src/lib/db/index.ts`) covered only a subset of models (Order, Bill, Payment, KOT, inventory, purchase, subscription pay, platforms). User, Restaurant, RestaurantSettings, MenuCategory/MenuItem/MenuVariant, RestaurantTable, TableSection were **never index-synced** — schema-index drift risk on existing deployments (eg. the P1 fix above would not be applied to already-created `orders` collections). | **FIXED** — full model coverage added |

### Fix 1 — order-number race (root-cause)
- `src/models/Order.ts`: added `orderSchema.index({ restaurantId: 1, orderNumber: 1 }, { unique: true })`.
- `src/lib/orders/order-service.ts`: `insertOrderWithNumberRetry()` — on E11000 re-mints and retries (up to 25 attempts; a separate `isDuplicateKey` guard). `createOrder` now uses it for DINE_IN / TAKEAWAY / QUICK_SALE (DINE_IN keeps its table-claim; retries never re-claim).
- `src/lib/billing/bill-service.ts`: bill-sequence retry raised 5 → 25 for symmetry (bill number already had a unique index).
- Regression tests: `tests/qa-order-number-race.test.ts` (parallel TAKEAWAY → 20/20 unique sequential numbers; parallel DINE_IN on 24 tables → 24/24). **Stable across repeated runs.**

### Fixes 3 & 4 — unique-index guards
- `src/models/Restaurant.ts`: `{ ownerId: 1 }` → `{ unique: true }`.
- `src/models/Subscription.ts`: `{ restaurantId: 1 }` → `{ unique: true }`.
- Tests assert a second concurrent-style create is rejected with Mongo error code 11000.

### Fix 5 — index sync coverage
- `src/lib/db/index.ts` now syncs **all** model collections (adds User, Restaurant, RestaurantSettings, Menu*, RestaurantTable, TableSection). Note: on an existing deployment with a legacy non-unique `ownerId_1` index, `syncIndexes` will rebuild it as unique; the operation fails loudly (non-fatal warn) if legacy data is non-conformant — the correct signal for a pre-launch data check.

---

## 3. Verify checklist (per module)

### Backend modules (server-side, DB-touching)

| Module | Verification | Status |
|---|---|---|
| DB connection & index management | `connectDB` reuse is safe; index sync list now complete; each test DB collided-with only by its own file | FIXED / PASS |
| Auth — sessions & cookies | JWT HS256 7d, httpOnly/lax, secure-in-prod; tampered token → 307 `/login` (HTTP-verified); expired/invalid => null (unit) | PASS |
| Auth — login | Schema validate → credentials → active-check → throttled, audit-logged; rate limit 5/15m | PASS |
| Auth — signup | Owner creation, hash, duplicate-email rejection, **now throttled per email+IP** | FIXED / PASS |
| Authz (roles) | 5 roles (OWNER/MANAGER/CASHIER/WAITER/SUPER_ADMIN); no write action missing a server-side role assert (static audit); `assertCanViewReports/Dashboard` unit-tested; hidden financials for non-owner roles | PASS |
| Admin console | Super-admin-only; non-super `/admin` → 307 `/dashboard` at the server layer (layout guard, HTTP-verified) | PASS |
| Onboarding | One restaurant per owner enforced (service + **now unique index**); existing-user redirects to own dashboard | FIXED / PASS |
| Tenant isolation | All module queries scoped by server-derived `restaurantId`; cross-tenant `createOrder/getOrder/updateOrder/holdOrder/cancelOrder/printKot/cancelKot/listOrderKots/generateBill` all blocked; identical table names in tenants A/B coexist; dashboard aggregates are per-tenant (HTTP+unit verified) | PASS |
| Orders | Create/index/claim/print/cancel flows; table one-active-order invariant; **order numbers now race-free** | FIXED / PASS |
| Kitchen tickets | `{restaurantId, claimKey}` and `{restaurantId, kotNumber}` unique; pending re-print idempotent (exactly one KOT doc on double-click; no new doc when nothing pending) | PASS |
| Billing & GST | Server recomputes totals from stored order items (client input carries only orderId + discount); discount bounds-validated; tax derived from settings; exclusive/inclusive GST, item variant tax overrides, legacy-discount fallback all exercised by the e2e billing suite | PASS |
| Payments | Idempotency: same key submitted concurrently → exactly one `Payment` row, bill `PAID`, charged once; key replay against a different bill rejected (`BillValidationError`); partial-unique `{restaurantId, idempotencyKey}` | PASS |
| Inventory / purchases / stock | Scoped; purchase number + item SKU unique; stock movement trail; purchase-idempotency vectors reviewed | PASS |
| Reports / dashboard | Per-tenant aggregates verified; CSV export, permissions-based tab/export visibility | PASS |
| Subscription & platform | Trial/active access gate, renewal in place, one-subscription-per-restaurant now DB-enforced; payment ref-id uniqueness | FIXED / PASS |
| Audit log | Every auth event + sensitive mutation logged (actor/role/ip/ua); tenant-scoped on reads | PASS |

### Frontend / workflow / UI / prerender

| Check | Result | Status |
|---|---|---|
| POS layout viewport fix (Task 3) | Root `lg:h-screen` win, internal panels `min-h-0 flex-1 overflow-y-auto`; no page-level scroll on desktop POS; stock/list views verified by tests | PASS |
| KOT life-cycle UX (Tasks 1–2) | Cancelled orders/quantities restore selling state; cancelled KOT shows badge; draft preserved on table reselect — regression tests green | PASS |
| SSR — unauthenticated | `/dashboard /pos /menu /tables /inventory /kot` → 307 `/login` (edge proxy); `/orders /billing /reports` render a streaming shell then redirect client-side — **no business data in the shell HTML** (verified by inspecting SSR output: no restaurant name, no ObjectIds, no order data) | PASS |
| SSR — authenticated owner | `/dashboard /pos /menu /tables /orders /billing /inventory /reports` → 200, no runtime errors in server log | PASS |
| SSR — admin guard | owner → `/admin` 307 `/dashboard`; owner with restaurant → `/onboarding/restaurant` 307 `/dashboard` | PASS |
| SSR — bad/tampered cookie | 307 → `/login` | PASS |
| Interactive browser (click-through, print preview, breakpoints) | Not executable in this environment | NOT VERIFIED |
| Full API-driver click coverage across all tabs | Covered indirectly by 453 tests; visual/on-screen verification pending real-browser run | PARTIAL |

---

## 4. Residual risks / recommended follow-ups

1. **Rate limiter is in-memory** (documented in code): correct for single-instance, must be swapped for a shared store (Redis) before horizontal scaling. Signup throttling inherits this.
2. **Signup throttling is per-email+IP** — mitigation, not a hard anti-abuse wall; consider a CAPTCHA/allowlist behind it for public deployments.
3. **In-memory limit resets on restart** — acceptable at this stage.
4. **Run a real-browser pass** (Playwright or manual) across POS → KOT print → pay → bill print → reports, plus responsive breakpoints, before booking revenue. Not verifiable here (no browser available); everything below that layer is verified.
5. **Deployment note for fix 3 (ownerId unique):** on an existing DB, `syncIndexes` will attempt to rebuild `ownerId_1` as unique. If any historic duplicate owners exist it will warn and fail — treat as a go/no-go data check. Fresh DBs are unaffected.

---

## 5. Defect ledger (summary)

| ID | Severity | Area | Status |
|---|---|---|---|
| QA-1 | P1 | Duplicate order numbers under concurrency | FIXED + regression tests |
| QA-2 | P2 | Missing signup rate limit | FIXED + regression tests |
| QA-3 | P2 | Non-unique `Restaurant.ownerId` (onboarding race) | FIXED + test |
| QA-4 | P2 | Non-unique `Subscription.restaurantId` | FIXED + test |
| QA-5 | P3 | Incomplete deployment index-sync list | FIXED |
| QA-6 | P2 (residual) | In-memory rate-limit store | Tracked; needs Redis for scale |

No P0 issues. Two P1-plausible vectors were investigated and are **not** defects: DINE_IN creation on an occupied table (correct “one active order per table” invariant) and `nextKotNumber` being non-atomic (safe because print already retries on the unique claim/ticket indexes).

---

## 6. Final recommendation

**GO for launch** once the residual items are accepted: rerun the full gate (`vitest`, typecheck, lint, build — all currently green at 453 tests), and complete one real-browser end-to-end of the sell-through path. All audit-era defects are fixed at the root with regression coverage; tenant isolation, billing integrity, and payment/KOT idempotency are verified with dedicated tests.