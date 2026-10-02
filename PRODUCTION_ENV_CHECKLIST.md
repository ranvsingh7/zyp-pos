# PRODUCTION ENV CHECKLIST — ZYP POS

Audit date: 2026-10-01
Scope: every `process.env.*` reference in `src/`, `scripts/`, and build config.
Method: exhaustive grep of `src/`, `scripts/`, `vitest.config.ts`, `next.config.ts`, `package.json`.

**This document contains no real secret values.**

---

## 1. Complete variable inventory

There are **six** environment variables referenced by the application, plus three that
exist only in seed scripts. There are **no** payment-gateway, email, SMS, realtime,
WebSocket, OAuth or analytics variables — the application has no such integrations yet.

| # | Variable | Required | Server/Client | Sensitive | Used in | If missing |
|---|---|---|---|---|---|---|
| 1 | `MONGODB_URI` | **YES** | Server only | **YES** | `src/lib/db/index.ts:29` | **Hard failure.** Module throws `MONGODB_URI is not defined. Please set it in your .env.local file.` on import. Every DB-backed page 500s. The message leaks the expected filename, which is why the production value must be a real SRV/Atlas string, not a local one. |
| 2 | `MONGODB_DB_NAME` | **YES in production** | Server only | No | `src/lib/db/index.ts:30`, plus `scripts/lib/production-db-guard.ts` | Falls back to `"restopos"`. **Dangerous in production:** if Atlas has several databases and this is unset, the app silently connects to the wrong one. **Set it explicitly to a production-looking name such as `restopos_prod`** — the destructive-script guard blocks names containing prod/production/prd/live, so the name itself becomes a safety net (§7). |
| 3 | `AUTH_SECRET` | **YES** | Server only | **YES** | `src/lib/auth/session.ts:11` (read via `getSecretKey()`), used by `encryptSession`/`decryptSession` | **Hard failure** the moment a session is created or read: `AUTH_SECRET is not set.` Login, logout and every authenticated request throw. The login page itself still renders, so this can look like a partial outage. |
| 4 | `FULL_ACCESS_MODE` | Optional | Server only | No (but security-relevant) | `src/lib/config/full-access.ts` — consulted only from `src/lib/services/access.ts:159` and `src/lib/auth/guards.ts:234` | Unset is **identical to `false`** → normal plan-based entitlement enforcement. **MUST be `false` in production** (see §4). |
| 5 | `NODE_ENV` | Set by platform | Server only | No | `src/lib/auth/session.ts:69`, `src/app/api/auth/signout/route.ts:18` — sets the cookie `secure` flag | Set automatically by `next build`/`next start` and by Vercel. **Never set it manually.** If it were ever `development` in production, session cookies would be issued **without** the `Secure` flag. |
| 6 | `NEXT_PUBLIC_APP_URL` | Optional | **Client (inlined into the bundle)** | No | `NEXT_PUBLIC_*` is inlined at build time. Grep of `src/` shows **no code reads it** — it is currently documentation-only. | Nothing breaks. Set it for correctness/documentation. Note: because it is `NEXT_PUBLIC_`, its value is **public**. Do not put a secret here. |
| 7 | `NEXT_PUBLIC_APP_NAME` | Optional | **Client (inlined)** | No | Same as above — **not read anywhere in `src/`**. Branding is currently hardcoded as `ZYP POS` in components. | Nothing breaks. **Public.** Do not put a secret here. |

### Seed-script-only variables (never read by the running application)

| Variable | Used in | Note |
|---|---|---|
| `ADMIN_EMAIL` | `scripts/seed-admin.ts:17` | Defaults `admin@restopos.local`. **Not** required at runtime. |
| `ADMIN_PASSWORD` | `scripts/seed-admin.ts:18` | Defaults `Admin@1234`. **Never set this in the Vercel environment** — it is only a local bootstrap convenience. |
| `ADMIN_NAME` | `scripts/seed-admin.ts:19` | Defaults `Platform Admin`. |
| **`ALLOW_DESTRUCTIVE_PRODUCTION_DB`** | `scripts/lib/production-db-guard.ts` | **Emergency-only and must be absent from every deployment environment.** Exact lowercase `"true"` is the only value that enables it. It exists so a deliberate production maintenance operation is possible without editing code — it is *not* a configuration option. Never place it in `.env.local`, Vercel, CI, or a `.env` file that is loaded automatically. Verified absent from `.env.local` and `.env.example` by test. |

---

## 2. Secret-exposure verification (performed)

| Check | Result |
|---|---|
| Real `AUTH_SECRET` present in `.next/static/**` (browser-served)? | **NO — 0 files** |
| Real `AUTH_SECRET` present in any `.next/static` chunk actually fetched over HTTP? | **NO** |
| `MONGODB_URI` / `MONGODB_DB_NAME` in client chunks? | **NO — 0 files** |
| `ADMIN_PASSWORD`, `FULL_ACCESS_MODE` in client chunks? | **NO — 0 files** |
| `mongodb://` / `mongodb+srv` anywhere in `.next/static`? | **NO** |
| Where the secret *does* legitimately appear | `.next/cache/turbopack/*.sst` — the **local build cache**, which is gitignored (`.gitignore:17 /.next/`) and never served to a browser. Expected and not a leak. |

The `server-only` package is imported by `src/lib/db/index.ts`, `src/lib/auth/session.ts`
and `src/lib/config/full-access.ts`, which makes importing them from a client component a
**build error** rather than a convention.

---

## 3. Development-only configuration found

| Item | Location | Production risk |
|---|---|---|
| `MONGODB_URI: "mongodb://127.0.0.1:27017/restopos_test"` and `MONGODB_DB_NAME: "restopos_test"` | `vitest.config.ts:16-17` | **None.** Test-only, scoped to the vitest `env` block. The test suite cannot touch a production database as long as `npm test` is not run against production credentials. |
| `localhost` / `127.0.0.1` / `:3000` / `:3001` / `27017` / `27018` in `src/**` (excluding tests) | — | **NONE FOUND.** Zero occurrences. No production code path contains a hardcoded host or port. |
| `restopos_qa`, `restopos_qa_race`, other `*_e2e` / `*_qa*` database names in `src/` or `scripts/` | — | **NONE.** These exist only as runtime-created database names inside `tests/`. |
| `console.log` in production code | `src/proxy.ts:36`, `src/lib/auth/guards.ts:46`, `src/app/api/auth/signout/route.ts:8` | **Low.** These log routing decisions and the session `userId`/role on **every request**, including the per-request auth-guard trace. On Vercel this is billed log volume and writes a user identifier into the log stream on every page view. No secret or token is logged. Recommend gating behind an env flag or removing before launch. |
| `console.log` / `debugger` in `src/**` (excluding tests) | 3 sites, listed above | No `debugger` statements found. |

---

## 4. `FULL_ACCESS_MODE` — current state

**Current value: UNSET → resolves to `false`. Plan-based entitlement enforcement is ACTIVE.**

`.env.local` does not contain the variable. Verified by calling the application's own
parser (`isFullAccessMode()`), which is the single definition in the codebase:

| Value | Resolves to |
|---|---|
| *unset* | `false` |
| `true` / `TRUE` / ` true ` | `true` |
| `false` | `false` |
| `ture` (typo) | `false` — fails safe |
| `1` | `false` — fails safe |
| `enabled` | `false` — fails safe |

Only the exact string `true` (any case, whitespace-trimmed) enables it. A typo degrades to
the **safe** direction.

**It is read from `process.env` only.** Verified by stripping comments from
`src/lib/config/full-access.ts` and confirming the only reads are
`process.env as Record<string, string|undefined>` and `env[FLAG_NAME]`. There is no code path
that reads the flag from a header, query string, request body, cookie, `localStorage` or the
session payload — a browser cannot turn it on for itself. It is consulted in exactly two
places (`src/lib/services/access.ts:159`, `src/lib/auth/guards.ts:234`) and by no page or
component directly.

> **Do not set `FULL_ACCESS_MODE` in the Vercel production environment.** Leaving it unset
> is equivalent to `false`. See §7 of `FINAL_PRODUCTION_AUDIT.md`.

---

## 5. Variables deliberately NOT present

The following are commonly required and are **not** used anywhere in this codebase. Do not
add them speculatively, and do not assume a missing integration is a bug:

- Payment gateways (Razorpay, Stripe, PayU, Cashfree) — `UPI` is recorded as a **payment
  method label only**; `src/lib/billing/payment-qr.ts` renders a **static, hand-entered UPI
  ID** as a QR image. **No payment is initiated, captured, or verified by any provider.**
- Email / SMTP / Resend / SendGrid — no email is sent; `forgot-password` exists as a page.
- SMS / OTP providers — none.
- OAuth / social login — none; email + password with Argon2id only.
- Realtime / WebSocket / Pusher / Ably / Supabase — none.
- Object storage / S3 / Cloudinary — the restaurant logo is stored as a **binary subdocument
  inside the restaurant document in MongoDB** (`src/models/Restaurant.ts:11-33`), capped at
  2 MB.
- Analytics / error reporting (Sentry, Datadog) — none.

---

## 6. Collections created automatically (no configuration needed)

| Collection | Created by | Notes |
|---|---|---|
| `ratelimits` | `RateLimitModel.syncIndexes()` in `src/lib/db/index.ts:108` | **Shared login / sign-up throttle buckets.** Created and indexed on first connection — no migration step. Holds a composite `key`, a sliding window of attempt timestamps, and a TTL anchor. Contains **no passwords, hashes or tokens**: only an email and an IP, which is all the limiter needs to identify the bucket. |

No new environment variable was introduced by the shared rate-limiter change.

---

## 7. Minimum Vercel configuration

Set **exactly these four** project environment variables:

| Key | Value |
|---|---|
| `MONGODB_URI` | Your Atlas SRV connection string |
| `MONGODB_DB_NAME` | Your production database name (**explicitly**, do not rely on the default). Use a production-looking name such as `restopos_prod`. |
| `AUTH_SECRET` | A new, strong random secret, **different from the local one** |
| `FULL_ACCESS_MODE` | `false` (or simply omit it — see §4) |

Optional: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME` (both public, both currently unread).

**Never set** `ADMIN_PASSWORD` / `ADMIN_EMAIL` in production.
**Never set** `NODE_ENV` manually.
**Never set** `ALLOW_DESTRUCTIVE_PRODUCTION_DB` anywhere (§1).

---

## 8. Destructive-script production guard

`scripts/lib/production-db-guard.ts` is called by `db:reset`, `db:seed`, `db:seed:demo`,
`db:seed:demo:reset` and `seed-pos-tables`, **before** `mongoose.connect()`. It refuses to start
when any of these hold:

| # | Signal | Why it is checked independently |
|---|---|---|
| 1 | `NODE_ENV=production` | The platform always sets this in production. |
| 2 | Database name contains `prod` / `production` / `prd` / `live` | Works even if `NODE_ENV` is wrong, so one bad variable cannot defeat the guard. |
| 3 | Host is not local **and** the name has no dev/test marker | Fail-closed default: catches a real Atlas URI under a dev-looking name. |

Local development and QA are unaffected: local hosts (`localhost`, `127.0.0.1`, `::1`, `mongo`,
`host.docker.internal`, with or without a port) and names containing
`test` / `qa` / `e2e` / `dev` / `local` / `sandbox` / `demo` are allowed.

The refusal message prints the database name and the redacted host, and states that no connection
was opened. It never prints the URI, scheme, or credentials.

Verification lives in `tests/production-db-guard.test.ts` and
`tests/destructive-scripts.e2e.test.ts`. The e2e suite runs the **real scripts** and proves the
guard runs *before* any connection by pointing blocked runs at an unresolvable `*.invalid` host —
a connection attempt would surface as `MongoServerSelectionError` instead of the block message.