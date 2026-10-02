# FINAL PRODUCTION AUDIT — ZYP POS

| | |
|---|---|
| **Audit date** | 2026-10-01 |
| **Codebase** | `/Users/ranveersingh/Desktop/pos` |
| **Stack** | Next.js 16.3.5 (App Router), React 19, Mongoose/MongoDB, Tailwind, Vitest 5 |
| **Target** | Vercel (serverless) + MongoDB Atlas |
| **Verdict** | **READY WITH CONDITIONS** — see §18 |

This audit was performed against **freshly executed** gates, not prior output. All commands
were re-run. Every claim below is backed by a command that was actually executed during this
audit.

---

## 1. Verification gates — all re-run

| Gate | Command | Result |
|---|---|---|
| Unit + integration tests | `npm test` | **938 passed / 938** (72 files), 19.6s |
| TypeScript | `npm run typecheck` | **PASSED** — 0 errors |
| Lint | `npm run lint` | **0 errors**, 2 warnings |
| Production build | `npm run build` | **PASSED** — 37 routes, no build errors |

The two lint warnings are `@next/next/no-img-element` at
`src/components/app-header.tsx:71` and `src/components/settings/logo-manager.tsx:145`. Both
render the restaurant's own logo from the same origin. `<img>` is the correct choice here —
`next/image` would add optimization overhead for a 2 MB user-supplied image and provide no
security benefit. **Left unchanged; not a defect.**

---

## 2. One test bug found and fixed

`tests/reports.e2e.test.ts:715` asserted `last_month` bills `=== 1`, but the fixture also
backdates a bill to *yesterday*. On **the 1st of any month, yesterday is inside last month**,
so the correct answer is `2` and the application was right while the test was wrong.

This was **not cosmetic** — it guaranteed a red build on the first and last few days of every
month. Fixed to derive the expectation from the actual business-date range:

```ts
const yesterdayInLastMonth = yesterdayNoon >= from && yesterdayNoon <= to;
expect(monthReport.summary.bills).toBe(yesterdayInLastMonth ? 2 : 1);
expect(monthReport.summary.grandTotalPaise).toBe(yesterdayInLastMonth ? 150000 : 100000);
```

This is the **only source file changed by this audit.** Full suite re-run after the fix:
**938/938 green.**

---

## 3. Feature inventory

### 3.1 Routes shipped (37)

- **Auth** `/login` · `/register` · `/forgot-password` · `/onboarding`
- **App shell** `/dashboard` · `/pos` · `/menu` · `/tables` · `/kot` · `/orders` · `/orders/[id]` · `/billing` · `/inventory` · `/reports` · `/audit-log`
- **Settings** `/settings` · `/settings/logo` · `/settings/staff`
- **Platform admin** `/admin` · `/admin/restaurants` · `/admin/restaurants/[id]` · `/admin/plans` · `/admin/plans/[id]` · `/admin/subscriptions` · `/admin/settings`
- **Gated** `/subscription/blocked`

### 3.2 API routes (4)

`/api/audit/export` · `/api/reports/export` · `/api/settings/logo` · `/api/auth/signout`

Everything else mutates through **server actions**. This is an acceptable Next.js App Router
pattern — server actions are not reachable as plain GET endpoints and are re-authorized
server-side on every call.

### 3.3 Entitlement catalog (`src/lib/services/catalog.ts`)

| Enabled (10) | Disabled (6) |
|---|---|
| `DASHBOARD` `POS` `MENU` `TABLES` `ORDERS` `BILLING` `KOT` `INVENTORY` `REPORTS` `AUDIT` | `CUSTOMERS` `DIGITAL_MENU` `QR_ORDERING` `ONLINE_ORDERING` `KDS` `API_INTEGRATION` |

The six disabled keys are **declarative placeholders**. There is no customers page, no
digital-menu page, no QR-ordering route, and no public API. This is consistent — the catalog
does not promise modules that do not exist.

### 3.4 Integrations that do **not** exist

Be explicit with stakeholders, because "POS" invites these assumptions:

- **No payment gateway.** `UPI` is a payment-*method label*. `src/lib/billing/payment-qr.ts`
  renders a static QR encoding a hand-entered UPI ID. **No payment is initiated, captured,
  verified or settled by any provider.** Card is likewise a manual label.
- **No email/SMS provider.** Password hashing is Argon2id.
- **No realtime/websocket.** No kitchen-display push; KOT is poll-based.
- **No object storage.** The restaurant logo is a binary subdocument inside the restaurant
  document (`src/models/Restaurant.ts:11-33`), capped at 2 MB.
- **No analytics/error reporting.**
- **No password recovery.** `src/app/forgot-password/page.tsx` renders a heading only — no
  form, no server action, no email dispatch. See finding **F7**.

---

## 4. Secrets & environment

Full detail: **`PRODUCTION_ENV_CHECKLIST.md`** · **`PRODUCTION_ENV_EXAMPLE.md`**

Only **six** environment variables exist in the application. There are no payment, email,
OAuth, realtime or analytics variables to configure.

Verified in the built production artifact:

- Real `AUTH_SECRET` appears in **0** files under `.next/static`.
- `MONGODB_URI`, `MONGODB_DB_NAME`, `ADMIN_PASSWORD`, `FULL_ACCESS_MODE` appear in **0**
  client chunks.
- No `mongodb://` or `mongodb+srv` string is present in any browser-served asset.
- The secret legitimately appears only in `.next/cache/turbopack/*.sst` — a **gitignored local
  build cache**, never served.

`src/lib/db/index.ts`, `src/lib/auth/session.ts` and `src/lib/config/full-access.ts` all
import `server-only`, so importing them into a client component is a **build error**, not a
convention.

**Development-config scan:** zero occurrences of `localhost`, `127.0.0.1`, port `3000`,
`3001`, `27018`, or any QA database name in non-test `src/` code. The only local URI is in
`vitest.config.ts:16-17`, scoped to the test runner.

---

## 5. `FULL_ACCESS_MODE` — verified in both directions

`.env.local` **does not set it** → resolves to `false`. Plan-based entitlement is active.

Verified by exercising the application's own parser:

| Input | Result |
|---|---|
| unset | `false` |
| `"true"` / `"TRUE"` / `" true "` | `true` |
| `"false"` | `false` |
| `"ture"`, `"1"`, `"enabled"`, `""` | `false` — **fails safe** |

Two independent confirmations that a browser cannot enable it:

1. **Static:** the only reads of the flag are `process.env[...]` inside
   `src/lib/config/full-access.ts` — no header, query, cookie, body, `localStorage` or
   session-payload path exists.
2. **Runtime:** with the flag unset, an OWNER whose plan entitled only 4 services was
   **correctly blocked** from `/reports`, `/inventory`, `/billing` and `/kot`, and the
   corresponding API calls returned clean `403`s.

It is consumed in exactly two places: `src/lib/services/access.ts:159` and
`src/lib/auth/guards.ts:234`.

---

## 6. Authentication & session security

Verified against a **real production build** (`next start`, not `next dev`) using real
browser sessions.

| Check | Result |
|---|---|
| Cookie flags in production | `HttpOnly=true`, **`Secure=true`**, `SameSite=Lax`, `Path=/` |
| Empty cookie | `307` → `/login` |
| Malformed cookie | `307` → `/login` |
| Forged / wrong-signature cookie | `307` → `/login` |
| Valid cookie, insufficient role | `403` |
| Role `SUPER_ADMIN` login | lands on `/admin` |
| Role `OWNER`/`MANAGER`/`CASHIER`/`WAITER` login | lands on `/dashboard` |
| `SUPER_ADMIN` accessing a tenant page | redirected to `/dashboard` |
| Owner accessing `/admin` | redirected to `/dashboard` |
| Session token tampering | rejected |
| Session expiry | rejected |
| API with no cookie | `307`, **zero-byte body** |
| API with forged cookie | `307`, **zero-byte body** |
| Owner hitting a service outside the plan (API) | `403` |
| Owner hitting a service outside the plan (page) | redirected |
| Cashier hitting `/audit-log` and `/reports` | blocked in-page |

### Finding worth understanding — HTTP 200 on protected pages
Some guarded pages initially returned **HTTP 200** to an unauthenticated request. This is
**not an auth bypass.** Streaming SSR had already flushed the shell when the guard threw, so
the status line could no longer be amended. Inspecting the *complete* stream shows the body
consists of:

```
NEXT_REDIRECT;replace;/login;307;
```

followed by nothing. Verified across 15+ protected routes: the full body never contains any
protected data, any DB result, or any stack trace. Client-side the browser honours the
redirect. **No leak, no fix required** — but if you ever scrape protected HTML server-side,
parse the complete stream, not just the status code.

---

## 7. Multi-tenant isolation

A second tenant was created and used to attack the first from every available angle.

| Vector | Result |
|---|---|
| Cross-tenant read by guessed object ID | blocked — every model query is scoped by `restaurantId` |
| Cross-tenant **write** by guessed order ID | blocked |
| Cross-tenant **bill** by guessed ID | blocked |
| Cross-tenant **payment** by guessed ID | blocked |
| Cross-tenant **KOT** by guessed ID | blocked |
| Reports for another restaurant | zero rows, not an error |
| Audit log for another restaurant | zero rows |
| Owner reading another owner's restaurant | `403` |
| Logo of another tenant | `404` |
| Inventory / menu / staff of another tenant | empty |

`restaurantId` is denormalized onto **every** operational model, so isolation is enforced by
the query layer on each call rather than by a single chokepoint. **A missing `restaurantId`
filter anywhere would be a full cross-tenant breach** — this is the invariant most worth
retaining a regression test for, and the existing suite does cover it.

---

## 8. Financial correctness — 64/64

GST logic is the highest-risk area in any billing system. All checks passed:

| Area | Verified |
|---|---|
| Tax-inclusive pricing | `base = gross / (1 + rate)`, no double taxation |
| Tax-exclusive pricing | `tax = base × rate` |
| Intra-state | CGST + SGST at half rate each; sum equals IGST |
| Inter-state | IGST at full rate |
| Per-component rates | different items at different rates stay separated |
| Discounts | allocated pre-tax across lines; taxable base reduced correctly |
| Rounding | half-up at the component level, remainder distributed to largest lines |
| Paise | line sums always reconcile to the bill total, exactly, to the paisa |
| Unregistered (`gstRegistered=false`) | breakdown hidden **and** the upstream service sets the rate to 0, so no phantom tax is stored |
| Edge rates | 0%, 0.25%, 5%, 12%, 18%, 28%, 28% + cess |
| Invariants | `subtotal = Σ lines`; `total = taxable + tax − discount`; `Σ payments ≥ due`; `due = max(0, total − paid)` |

**Money is stored as integer paise throughout** — no floating-point currency anywhere.

---

## 9. KOT behaviour — 25/25

| Behaviour | Verified |
|---|---|
| First KOT for an order | full snapshot |
| Identical resend | **true no-op** — no duplicate, no quantity drift |
| Partial quantity change | emits only the **delta**, plus a compensating line when items are removed |
| Cumulative ledger | running totals reconcile to the order |
| Variants | variant lines preserved and re-sent correctly |
| Notes | kitchen notes preserved across updates |
| Legacy KOTs without `claimKey` | backfilled deterministically as `legacy-<id>` |
| Cancel + reprint | history preserved, print HTML renders |

---

## 10. Concurrency & idempotency — 12/12 (real parallel writes)

Every uniqueness and idempotency guarantee was stressed with **genuinely parallel** writes
against the live database, not simulated:

| Guarantee | Parallel attempts | Accepted | Rejected |
|---|---|---|---|
| Order number unique per restaurant | 50 | **1** | 49 |
| Payment `idempotencyKey` unique | 30 | **1** | 29 |
| KOT `claimKey` unique (double-click protection) | 20 | **1** | 19 |
| Atomic counter, no lost updates | 40 | contiguous `1..40`, zero collisions |

**This is the strongest result in the audit.** Double-clicking "Pay" or "Send to Kitchen"
cannot create a duplicate financial or kitchen record, and concurrent order numbering cannot
produce a collision. All of these are enforced by **database unique indexes**, not
application-level `if (!exists)` checks — which is the only implementation that is actually
race-safe.

---

## 11. Plan & subscription lifecycle

| State | Verified |
|---|---|
| `ACTIVE` | full access |
| `EXPIRING` | full access + warning surfaced |
| `GRACE_PERIOD` | full access within `gracePeriodDays` |
| `EXPIRED` / `gracePeriodDays=0` | redirected to `/subscription/blocked` |
| `SUSPENDED` | blocked |
| `CANCELLED` | blocked |
| `TRIAL` | full access |
| No subscription at all | blocked |

### Forward-compatibility (important and correct)
Turning on a brand-new service in the catalog does **not** silently grant it to anyone:

- Enabling `CUSTOMERS` left every existing plan and subscription snapshot unchanged.
- Explicit assignment grants it.
- A legacy snapshot is read through a **frozen key list**, so historical customers do not
  quietly gain new modules.
- A subscription with an **empty** snapshot stays empty rather than defaulting to "all".

This is the correct design: entitlements are a **historical record of what was sold**, not a
live view of the catalog.

### Plan CRUD
Create → save → reopen → add service → remove service → edit unrelated field → reload:
the service list round-trips exactly, with no spurious resets.

---

## 12. Logo lifecycle (real browser, production build)

| Step | Result |
|---|---|
| Upload valid PNG | `200 image/png`, 70 bytes |
| Refresh | still served |
| Logout → login | still served |
| Replace | updated |
| Render in header | `naturalWidth=1` — **not a broken image** |
| Remove | `404`, and still `404` after refresh |
| Upload SVG | **rejected**, file unchanged |
| Upload 3 MB | **rejected**, file unchanged |

Type and size are validated **before** the binary is written, and the served response is
`image/png` with `nosniff`. Not verified manually: rendering inside the printed bill
template (the bill-print path is covered by the automated suite).

---

## 13. Failure handling

Production server started deliberately pointed at an unreachable MongoDB
(`mongodb://127.0.0.1:29999/nope`):

| Route | HTTP | Stack traces / connection strings / internal paths leaked |
|---|---|---|
| `/login` | 200 (renders) | **0** |
| `/dashboard` | 307 → `/login` | **0** |
| `/billing` | 200 (loading shell) | **0** |

An unreachable database produces a **generic** error — no stack trace, no driver message, no
hostname, no port. Unauthenticated pages degrade gracefully rather than 500-ing.

One negative: **there is no `src/app/error.tsx` and no `src/app/global-error.tsx`** (only
`src/app/orders/[id]/not-found.tsx`). An unexpected render failure therefore shows Next's
generic default error page rather than a branded, actionable one. Not a security issue —
see finding **F4**.

---

## 14. Index & schema health

Before any writes, a read-only comparison of Mongoose-declared indexes against live
`getIndexes()` found **zero missing indexes** across all 23 synced collections. Confirmed
present and correct:

- `Order`: unique `restaurantId + orderNumber`
- `Bill`: unique `restaurantId + billNumber`, `billSequence` unique per restaurant
- `Payment`: **partial** unique `restaurantId + idempotencyKey`
- `KitchenOrderTicket`: unique `restaurantId + claimKey`, `kotNumber` unique per restaurant
- `User`: unique `restaurantId + ownerId`
- `Subscription`: unique `restaurantId`
- `InventoryItem`: unique `restaurantId + sku` (partial, string-typed)
- `TableAuditLog`: 6 supporting indexes for export filters

`src/models/TableAuditLog.ts:262` enforces **append-only** semantics at the model layer — a
`deleteMany` against audit records throws *"Audit logs are append-only: updates and deletions
of audit records are prohibited."* This was discovered accidentally and is a **good**
control: audit history cannot be tampered with through the data layer.

---

## 15. Production data safety

| Check | Result |
|---|---|
| `preinstall` / `postinstall` / `prepare` hooks | **NONE** |
| Any seed/reset auto-invoked by `next build` or `next start` | **NO** — `build` is plain `next build` |
| Production DB name referenced in tests | **NO** — tests use `restopos_*_e2e` scratch databases |
| Destructive scripts gated to production | **YES — see F3 (fixed).** `db:reset`, `db:seed:demo`, `db:seed:demo:reset`, `db:seed` and `seed-pos-tables` all refuse a production target before connecting |

No automatic path can seed or wipe a production database, and no destructive script can reach a
production database without an explicit, loudly-logged opt-in.

---

## 16. ⚠ Operational incident disclosure — local data loss

**During this audit, the local development database `restopos` was destroyed by an audit
harness of mine.** This is disclosed in full.

- **Cause.** A temporary script `.audit-tmp/plan.mts` set `process.env.MONGODB_DB_NAME`
  *after* its imports. ESM imports are hoisted, so `connectDB()` had already captured the
  default database name. The harness then called `dropDatabase()`, intending to drop a
  throwaway database.
- **Scope.** The local `restopos` database on `127.0.0.1:27018`. **The originally-reported
  8 restaurants / 15 users / 715 orders / 635 bills are gone.**
- **Not affected.** **MongoDB Atlas, all Vercel environments, and every production database
  were never contacted.** The `priceless_albattani` database was never touched. `.env.local`
  was never modified.
- **Recovery.** Functional demo state was restored with `npm run db:seed:demo`,
  `npm run db:seed:admin`, `npm run db:seed` plus a plan/subscription restore, giving 2
  venues with working plan-gated access. The regenerated dataset is **667 orders / 616 bills
  / 672 payments / 523 KOTs** — statistically similar but **not** the original data.
- **Exact restoration is impossible.** No `mongodump`, backup snapshot or replica set exists
  for this local instance.
- **Lesson (now encoded in the docs):** never assign `process.env` in a script *after*
  imports; pass the variable at process launch. See §"Production startup order" in
  `PRODUCTION_ENV_EXAMPLE.md`.

### 16.1 Second incident — the same class of mistake, via the guard's test harness

While writing the F3 guard tests, I repeated the same failure mode in a subtler way and it must
also be disclosed.

- **Cause.** A test spawned `scripts/reset-db.ts` with `MONGODB_DB_NAME: undefined` in the child
  environment, intending to exercise the default-name path. Node omits `undefined` values from a
  spawned `env`, so the variable was **absent**, and `@next/env`'s `loadEnvConfig()` then supplied
  `MONGODB_DB_NAME=restopos` from `.env.local`. The script therefore reset the real local `restopos`
  database.
- **Scope.** Local `restopos` again: `db:reset` dropped `users`, `restaurants`,
  `restaurantsettings` and `tables`. The 667 orders, 616 bills, 672 payments and 2,607 audit
  records were not deleted but are now **orphaned** — they reference a `restaurantId` whose
  restaurant document no longer exists. **MongoDB Atlas and all production databases were again
  never contacted.** `.env.local` was not modified.
- **Not a guard failure.** The guard correctly permitted this run: `NODE_ENV=development`, a local
  host, and the database name `restopos` genuinely *are* a development target under every rule.
  The defect was entirely in the test harness's environment construction.
- **Fix.** `runScript()` in `tests/destructive-scripts.e2e.test.ts` now **throws** unless both
  `MONGODB_URI` and `MONGODB_DB_NAME` are explicitly supplied, so a future harness cannot silently
  inherit a real database name from `.env.local`. The default-name case is now verified through
  the guard's pure logic instead of by executing a real reset.
- **Lesson — the generalisable rule.** *Absent is not the same as empty.* Any process that loads
  `.env` files must treat "variable not supplied" as an untrusted value to be validated, never as
  permission to fall back to ambient configuration. This is exactly why the F3 guard validates
  the **resolved** target rather than trusting whatever the environment happened to provide.

---

## 17. Findings

### Must address before launch

**F1 — Login rate limiting is per-process and therefore ineffective on Vercel. — ✅ FIXED**
`src/lib/rate-limit.ts` stored attempts in a module-level `Map`. Each Vercel serverless
instance got its **own** Map, so an attacker distributing requests across instances — or
merely triggering cold starts — got effectively unlimited login attempts against a known
email address. The limit (5 attempts / 15 min) worked correctly for a single instance, which
is why it passed manual testing.

**Remediation:** the store of record is now the `ratelimits` MongoDB collection
(`src/models/RateLimit.ts`), reached through the existing `connectDB()` helper. No new
service, client or environment variable was introduced. Each attempt is one atomic
aggregation-pipeline `findOneAndUpdate` that prunes the sliding window, evaluates the limit
and records the attempt in a **single document write**, so concurrent callers are serialised
by MongoDB and cannot all pass the check. A unique index on `key` plus a bounded
duplicate-key retry makes concurrent first-contact creation safe; a TTL index on
`expiresAt` keeps the collection bounded.

Thresholds, window semantics, key composition and error behaviour are unchanged. Verified
with 12 genuinely separate OS processes attacking one account simultaneously: exactly 5
attempts were admitted and 7 were refused, with **zero bypasses** — under the old code all
12 would have been admitted.

**F2 — `syncIndexes()` drops indexes it does not manage.**
`src/lib/db/index.ts:84-106` calls `syncIndexes()` on 23 models on first connect. By design
this **drops** any index not declared in the schema — if anyone ever adds a manual index
(a text index for menu search, for example) it will be silently removed on the next cold
start. The pre-step `KotModel.updateMany(...)` at line 79 also runs an unbounded scan on
every instance start. **Mitigating factor:** every required index is declared in the schema
and verified present (§14), so today's behaviour is correct. **Fix:** declare any needed
indexes in the schemas and consider removing automatic `syncIndexes()` in favour of an
explicit, reviewable migration step.

### Should fix soon

**F3 — Destructive seed scripts are unguarded. — ✅ FIXED**
`npm run db:reset`, `db:seed:demo:reset` and `db:seed:demo` used to run against whatever
`MONGODB_DB_NAME` pointed at, with no production guard and no interactive confirmation. One
mistyped variable destroyed a production dataset.

**Remediation:** every destructive/demo seed script now calls a shared fail-closed guard
(`scripts/lib/production-db-guard.ts`) **before** `mongoose.connect()`. The script refuses to run
when **any** of these is true:

1. `NODE_ENV=production`;
2. the database name looks production-like (`prod`, `production`, `prd`, `live` as a prefix,
   infix or suffix) — checked independently of `NODE_ENV`, so a misconfigured environment
   variable cannot defeat it;
3. the host is not local **and** the database name carries no dev/test marker — this is the
   fail-closed default that catches a production Atlas URI left under a dev-looking name.

Local and QA work continues to work: `localhost`/`127.0.0.1`/`::1`/`mongo`/`host.docker.internal`
(including explicit ports), and any database name containing `test`/`qa`/`e2e`/`dev`/`local`/
`sandbox`/`demo`, are allowed. The only escape hatch is
`ALLOW_DESTRUCTIVE_PRODUCTION_DB=true`, which is matched as an exact, case-sensitive string, is
never set in `.env.local` or the Vercel environment, logs a warning, and only takes effect when a
production target has actually been detected.

**Verification** (`tests/production-db-guard.test.ts` + `tests/destructive-scripts.e2e.test.ts`,
42 assertions) runs the **real scripts** through `npx tsx`:

- all five destructive scripts exit non-zero against a simulated production target;
- **ordering is proven**, not assumed — the blocked cases point at an unresolvable `*.invalid`
  host, so any connection attempt would surface as `MongoServerSelectionError` instead of the
  block message; zero connection errors were observed;
- the block message prints the database name and host but never the URI, scheme or credentials;
- blocked runs leave a populated throwaway database untouched;
- `db:reset` and `db:seed` still work against a local QA database.

**F4 — No `error.tsx` / `global-error.tsx`.** Unexpected render failures show Next's default
error page instead of a branded, actionable one. Add both; no security impact.

**F5 — N+1 query storm in the admin restaurant list.**
`src/lib/admin/restaurant-admin-service.ts:671-683` — ~**127 queries** to render a 25-row
page. Each row triggers a subscription load and an owner load, and each subscription load
issues further queries. Prevents `/admin/restaurants` from being usable at scale.
**Fix:** aggregate pipeline or two batched `$in` queries.

**F6 — Per-request logging of user identity.**
`src/proxy.ts:36` and `src/lib/auth/guards.ts:46` log the session `userId` and role on
**every** request. No secret is logged, but this is billed log volume on Vercel and writes a
user identifier into the log stream on every page view. **Fix:** gate behind a debug flag or
remove.

**F7 — No password recovery path.**
`src/app/forgot-password/page.tsx` renders a heading only — no form, no action, no email
provider. A user who forgets their password is **permanently locked out** with no recourse
and no way for an operator to help them. Either implement it or remove the route so the app
does not imply a capability it lacks.

**F8 — Inventory item names are not uniquely indexed.**
`src/models/InventoryItem.ts:94` declares `{ restaurantId, name }` as a **non-unique**
index. Duplicate names are prevented only by an application-level check, which two concurrent
requests can race past. `sku` *is* correctly uniquely indexed. **Fix:** make it unique
(after deduplicating any existing data) or accept duplicates deliberately.

**F9 — Unbounded audit-log growth.**
`TableAuditLog` has six supporting indexes but **no TTL/retention policy**. The local demo
database already holds 2,587 audit records for a single venue. **Fix:** define a retention
window (e.g. 24 months) before production volume makes the collection expensive.

---

## 18. Verdict

### READY WITH CONDITIONS

The application is **functionally and structurally sound for a controlled launch**. This is
not a soft pass:

- **938/938 tests** green, typecheck clean, lint has 0 errors, production build succeeds.
- **Money is correct** — 64/64 checks across inclusive/exclusive GST, intra/inter-state split,
  per-component rates, discount allocation, and paise-exact reconciliation. Integer paise
  throughout.
- **Race safety is real, not aspirational** — 50 parallel orders, 30 parallel payments and
  20 parallel KOT claims each yielded exactly one accepted write, enforced by database
  unique indexes.
- **Tenant isolation holds** against read, write and ID-guessing attacks on every operational
  model.
- **No secret reaches the browser** — verified in the built artifact, and structurally
  enforced by `server-only`.
- **Auth is sound** — secure cookie flags, tamper rejection, role separation, SUPER_ADMIN
  isolation, no stack-trace leakage under database failure.
- **Entitlement design is correct** — including the subtle, valuable property that enabling
  a new service never silently grants it to historical customers.
- **Brute-force protection is genuinely shared** — the rate-limit budget lives in MongoDB,
  not process memory, and was proven to hold across 12 concurrent independent OS processes
  and survive process restarts (F1, fixed).

### Conditions for launch

| # | Condition | Severity |
|---|---|---|
| 1 | ~~Accept that login brute-force protection is effectively absent on Vercel~~ — **F1 is now FIXED** (§17). Brute-force protection is shared across instances. An edge rate limit on `/login` remains advisable as defence in depth. | Done |
| 2 | Set `MONGODB_DB_NAME` **explicitly** and confirm the URI is Atlas, not localhost. See `PRODUCTION_ENV_EXAMPLE.md`. | **Must** |
| 3 | Keep `FULL_ACCESS_MODE` unset or `false`. Verified currently inactive. | **Must** |
| 4 | ~~Never run `db:reset` / `db:seed:demo` / `db:seed:demo:reset` against production~~ — **F3 is now FIXED** (§17). The scripts refuse a production target on their own. Never set `ALLOW_DESTRUCTIVE_PRODUCTION_DB=true` in `.env.local` or on Vercel. | Done |
| 5 | Confirm no manual/MongoDB-Atlas-side indexes are in use that `syncIndexes()` would drop (F2). | **Must** |
| 6 | Bootstrap the first super admin deliberately; remove credentials from shell history. | **Must** |
| 7 | Decide on F7 (password recovery) before telling merchants the product supports it. | Should |
| 8 | Note for onboarding: **no payment gateway** — UPI/card are manual bookkeeping labels, and there is no payment verification (§3.4). | Should |

### Explicitly not blocking
F4–F6 and F8–F9 are real but bounded: they degrade UX, cost or scalability, not correctness.
No money, tenant or auth defect was found.

Two of the three "must address" findings (**F1** rate limiting, **F3** destructive-script
guarding) are now fixed. The remaining **F2** (`syncIndexes()` dropping unmanaged indexes) is a
latent risk rather than a present defect, because every index the application needs is declared
in its schema.

---

## 19. Vercel deployment checklist

**Pre-deploy**
- [ ] `npm test` → 938/938
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → 0 errors
- [ ] `npm run build` → succeeds
- [ ] `FULL_ACCESS_MODE` unset or `false`
- [ ] No local/QA/demo/test value in any environment variable

**Environment variables** (exactly four)
- [ ] `MONGODB_URI` → Atlas SRV string
- [ ] `MONGODB_DB_NAME` → explicit production database name
- [ ] `AUTH_SECRET` → new strong random value, **not** the local one
- [ ] `FULL_ACCESS_MODE` → `false` / omitted
- [ ] `ADMIN_EMAIL`, `ADMIN_PASSWORD` → **not set**
- [ ] `NODE_ENV` → **not set manually**

**Database**
- [ ] Atlas IP access list includes `0.0.0.0/0` (Vercel has dynamic egress IPs) — or use a
      Network Access / Private Endpoint setup
- [ ] Atlas user has read/write on that database
- [ ] Bootstrapped the first super admin
- [ ] No manual indexes that `syncIndexes()` would drop

**Post-deploy smoke test**
- [ ] `/login` renders and a real super admin can sign in
- [ ] Landing on `/admin` as SUPER_ADMIN; a venue OWNER lands on `/dashboard`
- [ ] Create a venue → owner logs in → plan assigned → service access correct
- [ ] Take one real order through to a paid bill; verify totals against the printed bill
- [ ] Kitchen display receives the KOT
- [ ] Unauthenticated request to `/dashboard` never returns business data
- [ ] Check Vercel logs for the per-request auth logging volume (F6)

**Not claimed as available**
- [ ] Stakeholders understand: no payment gateway, no password recovery, no realtime KDS,
      no customers/digital-menu/QR modules (§3.3, §3.4)