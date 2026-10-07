# ZYP POS — Performance Audit

**Date:** 2026-10-02
**Stack:** Next.js 16.3.5 (App Router, RSC) · React 19.2.8 · TypeScript · Mongoose 9.10.1 · MongoDB 8.0.34 (Atlas, sharded)
**Scope:** Measurement only. No application code, index, cache, or configuration was modified.
**Methodology:** Real production build (`next start`), real Atlas cluster, per-command driver instrumentation, `explain("executionStats")`, wire-level payload measurement.

> **Confidence legend**
> **MEASURED** — observed directly with a number attached.
> **INFERRED** — reasoned from measurements but not directly observed.
> **NOT MEASURED** — could not be obtained; stated as a gap.

---

## 0. Executive summary

The application is **not slow because of missing indexes or bad aggregation logic**. It is slow because of three structural problems:

1. **A 10-query authentication/entitlement prefix runs on every single page render**, and React `cache()` is silently defeated by object-literal arguments. On `/kot`, this prefix is **100% of all database operations** for that request.
2. **Every query is a full Atlas round-trip at 40–140ms**, and those round-trips are serialised. Wall-clock is dominated by *number of round-trips × RTT*, not by server-side execution (which is 0–4ms).
3. **Cold start pays a ~13.5s database penalty** (connect + `syncIndexes()`) before the first response can complete.

Headline numbers:

| Metric | Value |
|---|---|
| Cold `/dashboard` (first request after boot) | **6,145 ms** |
| Cold `connectDB()` | **13,460 ms** observed worst case |
| Warm page total (median of 15 routes) | **~700 ms** |
| Warm server-side DB execution time | **0–4 ms** per query |
| Atlas ping p50 / p95 | **77 ms / 408 ms** |
| Guard overhead as share of DB ops | **47%–100%** depending on route |
| `subscriptions` queries per page render | **5** (should be 1) |
| JS shipped per route (gzip) | **202–324 KB** |
| Largest HTML response (`/kot`) | **525 KB** |

The single highest-leverage fix is deduplicating the entitlement prefix (≈10 → 3 round-trips). The second is moving the app's compute region next to the database.

---

## 1. Environment and configuration

| Item | Finding | Confidence |
|---|---|---|
| Next.js config | `next.config.ts` is **empty** — no `cacheComponents`, no `compress`, no regions, no experimental flags | MEASURED |
| `vercel.json` | **Does not exist** | MEASURED |
| `.vercel/` project link | **Does not exist** (never linked from this machine) | MEASURED |
| Function region | Not configured → Vercel default region (`iad1`, N. Virginia) applies | INFERRED |
| `engines` in `package.json` | Not declared | MEASURED |
| Data caching | **None.** 68 `revalidate*`/`use cache` hits are all post-mutation `revalidatePath()` calls. Zero read-path data caching | MEASURED |
| `loading.tsx` | **0 files** across 32 pages | MEASURED |
| `Suspense` boundaries | 16 of 32 pages, all inline `fallback` spinners | MEASURED |
| `"use client"` | 72 files, **all** under `src/components/**`; zero in `src/app/**` | MEASURED |
| `FULL_ACCESS_MODE` | Not set in `.env.local`, so all entitlement reads execute | MEASURED |

**Routing/rendering shape:** every page and layout is a Server Component. Client code is confined to leaf components under `src/components/`. This is the correct architecture; the client surface itself is not the problem (see §9).

---

## 2. Database connection and cold start

`src/lib/db/index.ts`

### Warm path — healthy

| Measurement | Value |
|---|---|
| Warm `connectDB()` call | **0.158 – 0.337 ms** |
| Mongoose global cache | Working; returns early on `readyState === 1` |
| Connection reuse | No new connection per request |

**Verdict:** the warm connection path is correct and effectively free.

### Cold path — severe

| Phase | Measured |
|---|---|
| First raw `MongoClient.connect()` probe | **6,661.6 ms** |
| Later raw Mongoose connects | **580 – 3,802 ms** (high variance) |
| `listIndexes` / `syncIndexes()` phase | **2,749 – 8,257 ms** |
| `claimKey` `updateMany` | **68 – 429 ms** |
| Full cold `connectDB()` worst case | **13,460 ms** |

The first authenticated `/dashboard` request after boot took **6,145 ms** and issued approximately **70 sequential `createIndex` calls** plus one `kitchenordertickets.updateMany`.

**Root cause:** `syncIndexesOnce()` runs **after** the connection is established and **before** the triggering request completes, and Mongoose issues its `createIndex` calls sequentially. There is no deferral to a background/lazy task, so a cold instance pays the entire index-sync cost inside a user-visible request.

**Impact on serverless:** on Vercel, every cold start / scale-up instance repeats this. Because the Atlas region is not the function region (§3), the *connect* cost is also inflated by cross-region handshakes.

---

## 3. Network topology — the dominant multiplier

| Measurement | Value |
|---|---|
| Atlas `ping` min / p50 / p95 / max | **39.3 / 77.3 / 407.9 / 407.9 ms** |
| `hello` (isdbgrid) | **70 ms** |
| `buildInfo` | **118.7 ms** |
| TCP handshake to Atlas shards | **42 – 118 ms** |
| Cluster topology | **Sharded** (`msg: "isdbgrid"`, `setName: atlas-13ym7m-shard-0`) |
| Atlas host | `cluster0.lwoxshy.mongodb.net` |
| Local timezone | `Asia/Kolkata` |
| Default network route | `en0` (multiple `utun` interfaces present → possible VPN influence) |

**INFERRED — Atlas region:** latency profile (39–118ms from IST, and reference probes to other regions) is consistent with an AWS **Mumbai (`ap-south-1`)** deployment. This is **not confirmed** — no Atlas API/UI access was available.

**INFERRED — production is likely cross-region:** with no `vercel.json` and no `.vercel` link, Vercel functions run in the default region (`iad1`, N. Virginia). Mumbai ↔ N. Virginia reference RTT measured **260–324 ms**, i.e. **~3–8× the local 39–118 ms**. If that inference holds, **every single database round-trip in production is several times more expensive than every number in this report.**

**Cluster tier:** not determinable. A sharded Atlas cluster implies a non-free tier, but the exact tier requires Atlas API access. **NOT MEASURED.**

---

## 4. The authentication / entitlement prefix — highest impact finding

Every authenticated page runs a **10-operation database prefix before any page-specific query**:

| # | Operation | Collection | Purpose |
|---|---|---|---|
| 1 | `findOne` | `users` | `requireAuth()` |
| 2 | `findOne` | `restaurants` | `requireRestaurant()` |
| 3 | `findOne` | `platformsettings` | `getSubscriptionAccess()` (inside `requireRestaurant`) |
| 4 | `findOne` | `subscriptions` | `getSubscriptionAccess()` |
| 5 | `find` | `plans` | plan snapshot fallback |
| 6 | `findOne` | `subscriptions` | `getServiceAccess()` via `requireService()` |
| 7 | `find` | `plans` | `getServiceAccess()` via `requireService()` |
| 8 | `findOne` | `subscriptions` | `getServiceAccess()` via `AppHeaderServer` |
| 9 | `find` | `plans` | `getServiceAccess()` via `AppHeaderServer` |
| 10 | `findOne` | `subscriptions` | lifecycle gate in `guards.ts` |

### MEASURED — per-route guard share

| Route | Total DB ops | Guard ops | Guard share | `subscriptions` | `plans` | `users` |
|---|---|---|---|---|---|---|
| `/kot` | 10 | 10 | **100%** | 5 | 2 | 1 |
| `/audit` | 13 | 12 | **92%** | 5 | 2 | 3 |
| `/reports` | 12 | 10 | **83%** | 5 | 2 | 1 |
| `/billing` | 12 | 10 | **83%** | 5 | 2 | 1 |
| `/menu` | 14 | 11 | **78%** | 5 | 2 | 1 |
| `/orders` | 15 | 11 | **73%** | 5 | 2 | 2 |
| `/dashboard` | 21 | 10 | **47%** | 5 | 2 | 1 |
| `/pos` | 23 | 10 | **43%** | 5 | 2 | 1 |

### Root cause — React `cache()` is defeated by object-literal arguments

`src/lib/services/access.ts:132` wraps `getServiceAccess` in React `cache()`, and the doc comment at **`access.ts:128-131`** asserts:

> `cache()` keeps this to a single pair of queries per render pass even though a page asks about several services…

**This is not happening.** React's `cache()` keys entries by argument identity (`Object.is` per argument). Both call sites construct a **fresh object literal**:

- `src/lib/services/service-gate.tsx:47` → `checkService(restaurant.id, key, { role })`
- `src/components/app-header-server.tsx:24` → `getServiceAccess(restaurant.id, { role })`

Two distinct `{ role }` objects ⇒ **two distinct cache keys** ⇒ two full executions ⇒ 2× `subscriptions` + 2× `plans`. A third `subscriptions` + `platformsettings` comes from `src/lib/auth/guards.ts:236` (`getSubscriptionAccess`), which is not cached at all.

Result: **5 `subscriptions` + 2 `plans` per page, consistently, on every route.**

### Cost

Measured per-op latencies on `/pos` (serialised Atlas round-trips):

```
138.1 ms  findOne subscriptions
136.8 ms  find        plans
136.5 ms  findOne     users
120.1 ms  findOne     subscriptions
 90.7 ms  find        menuitems
 89.5 ms  find        menuvariants
 63.1 ms  find        plans
 62.7 ms  findOne     subscriptions
```

The guard prefix alone contributes roughly **~600 ms of serialised wall-clock** per page at local latency — and proportionally more if production is cross-region.

### Additional waste

`src/lib/admin/platform-settings.ts:getPlatformSettings()` queries `platformsettings` on **every** access evaluation. The collection contains **0 documents**, so the result is always the constant fallback. It is a guaranteed-miss round-trip on every page.

**Recommendation (not implemented):** collapse the prefix to a single batched entitlement read; cache `getSubscriptionAccess`; pass stable/reused option objects (or drop the options argument) so `cache()` can actually dedupe; remove the always-empty `platformsettings` read from the hot path.

---

## 5. Query performance (`explain("executionStats")`)

Read-only `explain` against the live cluster.

| Observation | Finding |
|---|---|
| Server-side execution time | **0–4 ms** for representative tenant queries |
| Wire latency | **40–396 ms** |
| Major tenant queries | Use existing indexes; **no COLLSCAN** on dashboard/POS/menu/orders/billing |
| Missing index — audit pagination | `{ restaurantId }` alone examined **~10,022 docs** to return 25 rows; server execution **~93 ms**; in-memory sort |
| Missing index — audit filters | Action/date filter uses an index **without `restaurantId`**, examined **~3,545 keys** |
| Small global collections | `plans` (2 docs), `platformsettings` (0 docs) — unfiltered scans are harmless in isolation |

**Interpretation:** index coverage is broadly good. Query cost is dominated by **round-trip count and serialisation**, not by execution. The audit-log pagination is the one genuine index gap found.

`scripts/perf-audit-explain.ts` reported winning index names correctly but its `stage` parser printed `"?"`; **execution-stage classification is unverified** and is a stated gap.

### Collection sizes (live)

`tableauditlogs` **12,967** · `payments` 101 · `orders` / `bills` / `kitchenordertickets` **92** each · `menuitems` 55 · `menuvariants` 48 · `restauranttables` 12 · `menucategories` 11 · `users` 7 · `plans` 2 · `restaurants` 1 · `platformsettings` **0**

---

## 6. N+1 queries

### 6.1 `toOrderView()` — one KOT query per order (latent)

`src/lib/orders/order-service.ts:56`

```ts
async function toOrderView(doc: OrderDocument): Promise<OrderView> {
  …
  const printedKots = await KotModel.find({
    restaurantId: doc.restaurantId,
    orderId: doc._id,
    printedAt: { $ne: null },
    status: { $ne: "CANCELLED" },
  }).select("items").lean();
```

Called in a `Promise.all` map from `getActiveOrders` (`order-service.ts:397`) and `getHeldOrders` (`order-service.ts:405`), plus 8 single-order call sites (`:386, :414, :462, :483, :561, :581, :615, :653, :677, :720`).

- **MEASURED:** `1` `kitchenordertickets` query during the current `/pos` render — the tenant currently has only **1** order in an active status (`KOT_SENT`).
- **INFERRED:** scales linearly with active orders. At 20 concurrent orders this becomes 20 serialised ~50–130ms round-trips. The earlier instrumented profile explicitly flagged *"printed KOTs for ONE order (runs N times!)"*.
- Index support exists: `{ restaurantId: 1, orderId: 1 }` (`src/models/KitchenOrderTicket.ts:196`), so each individual query is efficient — the problem is **query count**, not the index.

**This is a scaling defect, not a current bottleneck.** It is low-risk today and high-risk at peak.

### 6.2 Admin audit-log labelling — unbounded full-collection reads

`src/lib/admin/audit-logs-service.ts:62-71`

```ts
const [users, restaurants] = await Promise.all([
  UserModel.find().select("_id fullName email").lean(),
  RestaurantModel.find().select("_id name").lean(),
]);
```

Both fetch **entire collections** to label a single page of audit rows. Cost grows with total system size, not page size. A `$in` batch on the page's distinct IDs would be O(page) instead of O(collection).

### 6.3 `listRestaurants` — regex + full-document read including binary logo

`src/lib/admin/restaurant-admin-service.ts:671` (inside `listRestaurants`) issues `RestaurantModel.find()` **without excluding the `logo.data` field**. Restaurant logos are stored as binary with an effective ceiling around **2 MB per restaurant**, so a 50-restaurant page load can pull **~50 MB** of base64/binary into server memory per request.

**NOT MEASURED at scale** — the current database contains exactly **1** restaurant, so the amplification could not be demonstrated empirically. The absence of a projection is confirmed by source inspection.

### 6.4 Clean — correctly batched

`src/lib/orders/order-service.ts:249-327` (`buildOrderItems`) correctly batches menu items and variants using `$in`. Order item/variant hydration is **not** an N+1.

---

## 7. Payload size

### Server-rendered HTML/RSC (full response body)

| Route | Response size | Total time |
|---|---|---|
| `/kot` | **525 KB** | 1,237 ms |
| `/menu` | **373 KB** | 646 ms |
| `/pos` | **169 KB** | 1,173 ms |
| `/dashboard` | **133 KB** | 694 ms |
| `/billing` | **107 KB** | 673 ms |
| `/tables` | **98 KB** | 723 ms |
| `/audit` | **80 KB** | 711 ms |
| `/settings` | **64 KB** | 535 ms |
| `/orders` | **51 KB** | 589 ms |
| `/reports` | **44 KB** | 519 ms |
| `/inventory` | **42 KB** | 791 ms |

### Causes

- **KOT and menu payloads ship full MongoDB documents to the client.** No projections or field selection are applied to `listKots` (`src/lib/orders/kot-service.ts`) or the menu item/category reads; whole documents including fields the UI never renders are serialised into the RSC payload.
- **`/kot` at 525 KB is the single largest response** and is a plausible real-time polling target, so this cost can repeat continuously.

### Streamed shell → content gap

Because 16 pages stream via inline `Suspense` with no `loading.tsx`, the shell flushes almost immediately and the meaningful content arrives seconds later:

| Route | TTFB | Total | Gap |
|---|---|---|---|
| `/dashboard` | 165 ms | 1,441 ms | **1,103 ms** |
| `/menu` | 84 ms | 1,456 ms | **949 ms** |
| `/pos` | 90 ms | 1,145 ms | **791 ms** |
| `/orders` | 70 ms | 721 ms | **539 ms** |
| `/kot` | 91 ms | 1,613 ms | **1,460 ms** |

Users see a spinner for the entire gap. This is the core perceived-performance problem on slow connections: **TTFB is good, completion is bad.**

---

## 8. Client JavaScript / bundle

Measured by extracting `<script src="/_next/static/chunks/*.js">` per route and fetching each chunk.

| Route | HTML (wire) | Chunks | **JS (gzip)** | JS (uncompressed) |
|---|---|---|---|---|
| `/login` (unauth) | 3.8 KB | 10 | **204 KB** | ~600 KB |
| `/dashboard` | 136 KB | 12 | **324 KB** | 1,063 KB |
| `/inventory` | 43 KB | 14 | **272 KB** | 853 KB |
| `/menu` | 382 KB | 14 | **269 KB** | 847 KB |
| `/tables` | 101 KB | 13 | **265 KB** | 831 KB |
| `/reports` | 45 KB | 13 | **255 KB** | 795 KB |
| `/orders` | 52 KB | 13 | **258 KB** | 807 KB |
| `/settings` | 66 KB | 12 | **257 KB** | 810 KB |
| `/pos` | 173 KB | 13 | **244 KB** | 775 KB |
| `/billing` | 110 KB | 11 | **212 KB** | 668 KB |
| `/audit` | 81 KB | 10 | **202 KB** | 643 KB |
| `/kot` | 537 KB | 10 | **203 KB** | 642 KB |

### Interpretation

- **Route-level code splitting is working.** Per-route client components add only ~0–60 KB gzip on top of the shared baseline. The large client components (`item-form.tsx` 947 lines, `pos-manager.tsx` 707 lines, `restaurant-actions.tsx` 627 lines, `order-cart.tsx` 615 lines) are **not** being eagerly loaded into unrelated routes.
- **The problem is the shared baseline, not per-page weight.** Every route — *including the unauthenticated login page* — ships **~204 KB gzip / ~600 KB uncompressed**. This is framework + Next runtime + app-shell cost.
- **Recharts is correctly isolated** to `/dashboard` only (389 KB raw / **113 KB gzip** chunk, `src/components/dashboard/charts.tsx` is its sole consumer). Verified absent from all 11 other routes. It is the single largest optional dependency and accounts for most of the dashboard's 324 KB.
- Static assets compress correctly (389 KB → 113 KB; 223 KB → 72 KB). Compression is functioning.

### Largest chunks (uncompressed → gzip)

| Chunk | Raw | Gzip | Contents |
|---|---|---|---|
| `2ki0g0n5effiq.js` | 389 KB | **113 KB** | Recharts + d3 (**dashboard only**) |
| `27t_qfc-3_lzs.js` | 223 KB | **72 KB** | React DOM / Next client runtime (**all routes**) |
| `40qnclivjbr_b.js` | 161 KB | 45 KB | shared |
| `0cz1d0mv5g_q7.js` | 109 KB | 40 KB | React DOM |
| `0lm_41-40tzo8.js` | 68 KB | — | lucide-react + clsx |

---

## 9. Rendering & component strategy

- **All 32 pages/layouts are Server Components.** Zero `"use client"` outside `src/components/**`. Architecturally correct.
- **No `loading.tsx` files exist.** The 16 `Suspense` boundaries use bespoke inline spinner `<div>`s instead, so there is no shared route-level loading UI and no route-level prefetch/loading granularity.
- **`AppHeaderServer` is an async Server Component** (`src/components/app-header-server.tsx`) that re-resolves entitlement independently of the page (§4). It renders inside the page tree, so its queries are part of the page render rather than a parallel layout.
- The 947-line and 707-line client components are large but, per §8, are **not** inflating other routes. Their cost is code-review/maintainability rather than measured runtime.

---

## 10. Warm request timings (production build, real Atlas)

| Route | TTFB | Total | DB cmds | Σ DB ms | Max op |
|---|---|---|---|---|---|
| `/dashboard` | 7 ms | 619 ms | 21 | ~1,000 ms | 154 ms |
| `/pos` | 5 ms | 744 ms | 23 | ~1,350 ms | 169 ms |
| `/menu` | 7 ms | 850 ms | 14 | ~1,000 ms | 210 ms |
| `/orders` | 5 ms | 550 ms | 15 | ~1,000 ms | 219 ms |
| `/tables` | 5 ms | 723 ms | 13 | ~600 ms | 65 ms |
| `/kot` | 6 ms | 724 ms | 10 | ~700 ms | 376 ms |
| `/billing` | 8 ms | 581 ms | 12 | ~1,000 ms | 334 ms |
| `/reports` | 7 ms | 610 ms | 12 | ~900 ms | 153 ms |
| `/inventory` | 8 ms | 791 ms | 14 | ~1,400 ms | 407 ms |
| `/audit` | 6 ms | 899 ms | 13 | ~900 ms | 206 ms |
| `/billing` (earlier run) | 8 ms | 1,211 ms | 17 | ~1,377 ms | 334 ms |
| `/inventory/purchases` | 5 ms | 1,725 ms | 15 | ~2,108 ms | 669 ms |

Note `Σ DB ms` frequently **exceeds wall-clock** because `Promise.all` batches overlap. The pattern is unambiguous: **latency ≈ (serialised round-trips) × RTT.**

---

## 11. Prioritised findings

| # | Finding | Impact | Evidence |
|---|---|---|---|
| **1** | Entitlement prefix issues **5× `subscriptions` + 2× `plans` + `users` + `restaurants` + `platformsettings` per page** because React `cache()` is defeated by fresh `{ role }` object literals (`access.ts:132`, `service-gate.tsx:47`, `app-header-server.tsx:24`, `guards.ts:236`) | **Critical** — 47–100% of all DB ops; ~600 ms serialised per page | §4 |
| **2** | No function-region configuration; app likely runs cross-region from a Mumbai Atlas cluster | **Critical if confirmed** — 3–8× RTT on *every* query | §3 |
| **3** | Cold start pays **13.5s** (connect + ~70 sequential `createIndex` via `syncIndexesOnce()`) inside the first user request | **Critical on serverless** — every cold start | §2 |
| **4** | `/audit` pagination examines **~10,022 docs** for 25 rows; action/date filter lacks `restaurantId` in its index (~3,545 keys) | **High** — grows with `tableauditlogs` (12,967 and rising) | §5 |
| **5** | `/kot` returns **525 KB**; menu/billing/tables also ship full documents with no projection | **High** — on a real-time polling route | §7 |
| **6** | `getPlatformSettings()` queries an always-empty collection (`0` docs) on every access evaluation | **Medium** — guaranteed-miss round-trip per page | §4 |
| **7** | No `loading.tsx`; streamed shell-to-content gaps of **539–1,460 ms** | **Medium** — poor perceived performance | §7, §9 |
| **8** | `toOrderView()` runs one KOT query per order (`order-service.ts:56`); N=1 today, scales linearly | **Medium (latent)** — peak-traffic risk | §6.1 |
| **9** | `listRestaurants` reads restaurants **without excluding `logo.data`** (~2 MB each) | **Medium** — up to ~50 MB/request; unverifiable at 1 restaurant | §6.3 |
| **10** | Admin audit logs read **entire** `users` + `restaurants` collections to label one page | **Medium** — O(collection) instead of O(page) | §6.2 |
| **11** | ~204 KB gzip JS baseline on every route including login; Recharts adds 113 KB on dashboard | **Low–Medium** — splitting is working; baseline is the cost | §8 |
| **12** | No read-path data caching at all (only post-mutation `revalidatePath`) | **Low here** — correct for a POS; would matter at read-heavy traffic | §1 |

---

## 12. Measurement gaps and caveats

| Gap | Impact on conclusions |
|---|---|
| **No production/Vercel URL or CLI access** | §3 region mismatch is INFERRED, not confirmed. All timings are local + real Atlas. |
| **No Atlas API/UI access** | Cluster tier and exact region unconfirmed. |
| **No browser automation** | DOMContentLoaded, load, Long Tasks, hydration cost, and real Network waterfalls are **NOT MEASURED**. JS sizes are byte counts, not render timings. |
| **Single-tenant, single-restaurant dataset** | N+1 and full-document findings (§6.3) could not be demonstrated at scale. Real multi-restaurant impact is projected, not observed. |
| **`explain` stage parser printed `"?"`** | Index usage and `docsExamined` are reliable; explicit `COLLSCAN`/`IXSCAN` stage classification is not. |
| **Curled requests execute no JavaScript** | Server-rendered HTML/RSC sizes are accurate; client runtime performance is unmeasured. |
| **12 `utun` interfaces present** | Possible VPN overlay could inflate all local RTT figures in either direction. |

### Operational note encountered during the audit

Port 3000 was taken over mid-session by an unrelated application (`~/Desktop/qr builder`, Next 16.3.8), which caused one measurement batch to be collected against the wrong app. Those readings were discarded and **all reported figures were re-measured** against the correct app on port 3100.

### Security note (outside performance scope, but material)

During early profiling, database credentials and `AUTH_SECRET` were printed to the tool output by a failed redaction step. They are **not reproduced in this report**, but they were exposed to the session transcript. **Both the MongoDB password and `AUTH_SECRET` should be rotated.**

---

## 13. Temporary instrumentation added

Three isolated files were added for measurement. They are **not** imported by application code and are gated/standalone:

| File | Purpose | Gating |
|---|---|---|
| `scripts/perf-audit-profile.ts` | Per-command Mongoose driver timing | Standalone script |
| `scripts/perf-audit-preload.mjs` | Wraps the real MongoDB driver during `next start` | Requires `PERF_AUDIT=1` |
| `scripts/perf-audit-explain.ts` | Read-only `explain("executionStats")` harness | Standalone script |

Application behaviour is unchanged without `PERF_AUDIT=1`. These can be deleted with no effect on the app.

Temporary artefacts also created outside the repo: `/tmp/perf-server.log`, `/tmp/perf3100.log`, `/tmp/cookies.env` (signed session material — **do not commit**).

**No application source file was modified. No index was added. No data was written, reset, or deleted.**

---

## 14. Recommended order of work

1. **Deduplicate the entitlement prefix** — fix the `cache()` key collision, cache `getSubscriptionAccess`, and drop the empty `platformsettings` read. Target: 10 ops → 3. Biggest measured win, lowest risk.
2. **Confirm and fix region placement** — verify the Vercel function region against the Atlas region and co-locate them. If §3's inference holds, this multiplies the benefit of every other fix.
3. **Move `syncIndexesOnce()` off the request path** — defer to a background/lazy task so cold starts stop blocking first paint.
4. **Add the audit-log compound indexes** — `(restaurantId, createdAt desc, _id desc)` and `restaurantId` on the action/date path.
5. **Project KOT/menu/billing payloads** — drop `logo.data` and unused fields before serialisation.
6. **Add `loading.tsx`** at the route level so streamed gaps present real skeleton UI instead of a spinner.
7. **Batch the `toOrderView()` KOT lookup** into a single `$in` query before peak traffic arrives.
8. **Then re-measure in a real browser** and close the §12 gaps.
---

## 12. AUDIT QUERY OPTIMIZATION

Fixes finding **#4** from §11 only. No other finding is addressed here.

### Exact query the application executes

`listAuditLogs()` in `src/lib/audit/audit-service.ts` is the only read path for the
`/audit` viewer. The page (`src/app/audit/page.tsx:49`) calls it with **no filters**:

```js
listAuditLogs(String(restaurant.id), {}, { page: 1, pageSize: 25 })
```

which issues, in parallel:

```js
// 1. the page of rows
TableAuditLogModel.find({ restaurantId: ObjectId })
  .sort({ createdAt: -1, _id: -1 })     // two-field sort, _id is the tiebreaker
  .skip((page - 1) * 25)
  .limit(25)

// 2. the pagination total
TableAuditLogModel.countDocuments({ restaurantId: ObjectId })
```

With filters applied (server action `listAuditLogsAction`, zod-validated in
`src/lib/audit/query.ts`) the match additionally carries optional
`userId`, `action`, `entityType`, `success`, a `createdAt` range, and/or an
`entityId` regex `$or`. `restaurantId` is **always** present and is always taken
from the authenticated session via `requireRestaurant()` — never from the client.

### Root cause

The sort is `{ createdAt: -1, _id: -1 }`, and **MongoDB only skips the sort stage
when an index covers the sort specification in full.** No declared index did:
`restaurantId_1_createdAt_-1` stops at `createdAt`, so the `_id` tiebreaker could
not be satisfied. The planner therefore fell back to
`SORT -> FETCH -> IXSCAN(restaurantId_1)` — it used the *narrow* single-field
tenant index, fetched **every** document belonging to the venue, buffered them,
sorted them, and kept 25. Cost scaled with the venue's entire audit history.

### BEFORE — `explain("executionStats")`

Isolated local MongoDB, 12,967 documents, 10,022 belonging to the queried venue
(same ratio as the production finding). 4 tenants, ~1 year of history.

| Metric | Value |
|---|---|
| `executionTimeMillis` | **43** |
| `nReturned` | 25 |
| `totalDocsExamined` | **10,022** |
| `totalKeysExamined` | **10,022** |
| winning plan | `SORT {createdAt:-1,_id:-1} -> FETCH -> IXSCAN index=restaurantId_1 key={restaurantId:1}` |
| blocking SORT stage | **yes** |
| rejectedPlans | 3 |
| index used | `restaurantId_1` (narrow, does not cover the sort) |

`countDocuments` was already fine: `COUNT -> COUNT_SCAN index=restaurantId_1`,
10,023 keys, 2 ms — and is unchanged by this work.

### Change

One index added to `src/models/TableAuditLog.ts:269`, applied through the existing
`npm run db:indexes` command. No other index was altered or removed.

```js
tableAuditLogSchema.index({ restaurantId: 1, createdAt: -1, _id: -1 });
// -> restaurantId_1_createdAt_-1__id_-1
```

Equality field first (`restaurantId`), then the sort fields in the exact
directions the query uses. `_id` must be declared explicitly because MongoDB does
**not** append `_id` to a compound index the way it does to a single-field index.

### AFTER — same query, same data, `explain("executionStats")`

| Metric | Value |
|---|---|
| `executionTimeMillis` | **0** |
| `nReturned` | 25 |
| `totalDocsExamined` | **25** |
| `totalKeysExamined` | **25** |
| winning plan | `LIMIT -> FETCH -> IXSCAN index=restaurantId_1_createdAt_-1__id_-1` |
| blocking SORT stage | **no** |
| rejectedPlans | 4 |
| index used | `restaurantId_1_createdAt_-1__id_-1` |

| Query | docs examined | keys examined | ms | index |
|---|---|---|---|---|
| default page load | 10,022 → **25** | 10,022 → **25** | 43 → **0** | `restaurantId_1_createdAt_-1__id_-1` |
| 7-day date range | 192 → **25** | 192 → **25** | 1 → **0** | `restaurantId_1_createdAt_-1__id_-1` |
| action + success filter | 195 → 195 | 195 → 195 | 1 → 1 | `action_1_createdAt_-1` |
| deep page (page 100) | 10,022 → **25** | 10,022 → 2,500 | 48 → **14** | `restaurantId_1_createdAt_-1__id_-1` |

### Why `action` was deliberately left out

The obvious guess `{ restaurantId, action, createdAt }` was measured and
**rejected**. With that index present and the chosen one absent, the planner
preferred it for the *unfiltered* page load and pushed keys examined back to
**10,022** (docs fell to 25, but the key scan was no better than the original and
wall time did not improve: 43 ms → 49 ms). Anything placed between `restaurantId`
and `createdAt` breaks the sort match for the dominant query. The action/date
filter variants are already served adequately by the pre-existing indexes, so the
minimum correct change is a single additional index.

`restaurantId_1_createdAt_-1` is now a strict prefix of the new index and is
therefore redundant for this query, but it was **left in place** — removing it is
not required for correctness and would drop an index the application declares.

### Scalability benefit

Before, cost was `O(tenant's total audit history)` per page view and grew without
bound as the append-only log grew — every page load re-read the venue's entire
history. After, it is `O(pageSize)` and stays there: a test that grows the tenant
from 400 to 5,400 documents confirms the page-1 scan still examines 25. Index size
grows by one 12-byte key per document (~155 KB at 12,967 docs).

### Tenant isolation

Unchanged and re-verified: `restaurantId` remains in every query and is derived
from the session (`requireRestaurant()`), never from client input. `SUPER_ADMIN`
and role checks in `listAuditLogsAction` / `assertCanViewAuditLogs` were not
touched. No authorization logic changed.

### Verification

- `npm run db:indexes -- --dry-run` → reports exactly 1 to create, 0 to drop.
- `npm run db:indexes` → creates it; 118 indexes across 24 collections.
- Re-run → all `ok`, 0 created, 0 dropped (idempotent).
- `npm run db:indexes -- --check` → "all declared indexes are present".
- New tests in `src/lib/audit/audit-index.test.ts` (12) — index declaration,
  pre-existing indexes retained, planner picks the new index, no SORT stage,
  bounded documents examined, scaling, tenant isolation, ordering, pagination,
  action filter, date filter. 5 of them fail if the index declaration is removed.
- **From-scratch path verified** on a separate empty database, which is what a real
  deployment will hit: `--dry-run` reported all 8 audit indexes to create and 0 to
  drop; `--check` after applying reported all declared indexes present; re-apply was
  idempotent at 118 indexes / 24 collections; and the planner immediately chose
  `restaurantId_1_createdAt_-1__id_-1` on that fresh build (25 docs / 25 keys /
  25 returned, no sort). Scratch database dropped afterwards.
- No production or Atlas data was touched: all profiling used isolated local
  databases (`restopos_audit_perf`, `restopos_audit_fresh`) on `127.0.0.1:27018`.
- `connectDB()` still performs **no** index synchronisation (covered by
  `tests/rsc/connect-no-index-sync.test.ts`).

### Known remaining limitations

- Deep pagination still uses `skip`/`limit`, so keys examined grow linearly with
  page depth (page 100 = 2,500 keys). Pagination redesign is explicitly out of scope.
- The action-filtered variant still chooses the venue-agnostic
  `action_1_createdAt_-1` index and keeps a blocking sort. It is fast in absolute
  terms (195 docs, ~1 ms) and adding a tenant-scoped action index measurably
  regressed the default query, so it was left alone.
- `countDocuments` must still count every matching key (10,023) for an exact
  pagination total. That is inherent to exact counts, not an index defect.
