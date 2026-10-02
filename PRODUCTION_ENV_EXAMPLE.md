# PRODUCTION ENV EXAMPLE — ZYP POS

Copy this into your deployment platform's environment-variable settings (Vercel →
Project → Settings → Environment Variables) and replace every `<...>` placeholder.

**This file contains no real secrets. Do not commit a filled-in copy of this file.**

---

## Required

```bash
# ---------------------------------------------------------------------------
# DATABASE  (server-side only — never exposed to the browser)
# ---------------------------------------------------------------------------
# Use an Atlas SRV string in production. Do NOT use mongodb://127.0.0.1:...
# Atlas format:  mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_URI=<production-atlas-uri>

# Set this EXPLICITLY. If omitted the app defaults to "restopos", which can
# silently connect to the wrong database on a shared cluster.
#
# Name it so that it is unmistakably production, e.g. `restopos_prod`.
# The destructive-script guard blocks any name containing
# prod / production / prd / live, so this also gives you a second
# independent safety net (audit F3).
MONGODB_DB_NAME=restopos_prod

# ---------------------------------------------------------------------------
# AUTH  (server-side only — never exposed to the browser)
# ---------------------------------------------------------------------------
# Generate a NEW secret for production. Do not reuse the local development one.
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#   openssl rand -base64 32
# Changing this value invalidates every existing session (all users must log in again).
AUTH_SECRET=<strong-random-secret>
```

## Required for production safety

```bash
# ---------------------------------------------------------------------------
# FULL ACCESS MODE — MUST BE false (or simply unset) IN PRODUCTION
# ---------------------------------------------------------------------------
# When true, every authenticated restaurant user can open every implemented
# module regardless of their plan or subscription. This is a development/demo
# convenience ONLY.
#
# Leaving it UNSET is identical to false. Setting it to anything other than the
# exact string "true" also resolves to false, so a typo fails safe.
#
# Server-side only. There is no request header, query parameter, cookie or
# browser-side code path that can enable it.
FULL_ACCESS_MODE=false
```

## Optional (both are PUBLIC — `NEXT_PUBLIC_` values are inlined into the browser bundle)

```bash
# Currently not read by any application code; set for correctness/documentation.
NEXT_PUBLIC_APP_URL=https://<your-production-domain>
NEXT_PUBLIC_APP_NAME=ZYP POS
```

---

## Do NOT set these in production

| Variable | Why |
|---|---|
| `NODE_ENV` | Set automatically by `next build` / `next start` / Vercel. Overriding it can cause session cookies to be issued without the `Secure` flag. |
| `ADMIN_EMAIL` | Only read by `scripts/seed-admin.ts` (local bootstrap). |
| `ADMIN_PASSWORD` | Only read by `scripts/seed-admin.ts`. Never place a super-admin password in the deployment environment. |
| `ADMIN_NAME` | Only read by `scripts/seed-admin.ts`. |
| **`ALLOW_DESTRUCTIVE_PRODUCTION_DB`** | **Emergency-only.** The single override that lets `db:reset` / `db:seed:demo` / `db:seed:demo:reset` / `db:seed` run against a production target. Must be the exact lowercase string `true`. Setting it on Vercel or in `.env.local` permanently removes the only thing standing between a mistyped variable and a destroyed production dataset. There is no scenario in which this belongs in a deployment environment. |

## Not required — these integrations do not exist in this codebase

Payment gateway keys (Razorpay/Stripe/PayU/Cashfree), email/SMTP providers, SMS/OTP
providers, OAuth credentials, realtime/WebSocket keys, S3/Cloudinary credentials, and
analytics/error-reporting keys are **all absent by design**. `UPI` is a payment-method label
and a static QR image of a hand-entered UPI ID — **no payment is processed or verified by
any provider**. Do not add these variables until the corresponding integration is built and
audited.

---

## Production startup order

1. Set the four required variables above (or three, if you omit `FULL_ACCESS_MODE`).
2. Deploy.
3. **No database migration is required for a fresh production database.** On first connect
   the app creates its indexes automatically via `Model.syncIndexes()` for all 23 models.
4. Bootstrap the first super admin by running the seed script **locally against the
   production URI, once**, then delete the credentials from your shell history:
   ```bash
   MONGODB_URI=<production-atlas-uri> MONGODB_DB_NAME=<production-db> npm run db:seed:admin
   ```
   These commands are **refused by a built-in guard** if the target looks like
   production (`NODE_ENV=production`, or a database name containing
   prod / production / prd / live, or a non-local host with no dev/test marker).
   The check runs before the MongoDB connection is opened. See §15 and §17 (F3)
   of `FINAL_PRODUCTION_AUDIT.md`.

5. **If a destructive script ever refuses to start**, read the reason it printed. Do not
   "fix" it by setting `ALLOW_DESTRUCTIVE_PRODUCTION_DB=true`; almost always the actual fault
   is a stale `MONGODB_DB_NAME` or a URI still pointing at the wrong cluster.