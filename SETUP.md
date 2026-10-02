# ZYP POS — Manual Setup & Deployment Guide

Phase 1 delivers: landing page, signup/login with `argon2id` password hashing and
`jose` (HS256) session cookies, restaurant onboarding, and a logged-in dashboard,
all on Next.js 16 App Router with MongoDB via Mongoose.

This guide assumes YOU are the operator doing everything manually. Every step is
written so you never have to guess. Steps done inside the MongoDB Atlas or Vercel
web dashboards are explicitly marked **MANUAL STEP REQUIRED**.

---

## 1. LOCAL DEVELOPMENT SETUP

### 1.1 Required Node.js version

- **Minimum:** Node.js `20.9.0` (Next.js 16 requirement).
- **Recommended:** Node.js `22.x` LTS (verified working — v22.22.1).
- npm `10.x`.

Check yours:

```bash
node -v
npm -v
```

Install Node 22 via nvm if needed:

```bash
nvm install 22
nvm alias default 22
```

### 1.2 Install dependencies

From the project root:

```bash
npm install
```

This installs mongoose, argon2, jose, zod, shadcn/ui (base-nova), plus vitest and
`mongodb-memory-server` (dev).

### 1.3 Create `.env.local`

1. Copy the template:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` and fill in every value (see next section).
3. `.env.local` is git-ignored — it will NEVER be committed or pushed.

### 1.4 Required environment variables

| Variable                | Where it comes from                          | Server/Client | Notes |
| ----------------------- | -------------------------------------------- | ------------- | ----- |
| `MONGODB_URI`           | MongoDB Atlas connection string (see §2)     | Server-only   | `mongodb+srv://` string with your DB user/password in it |
| `MONGODB_DB_NAME`       | You choose (recommend `restopos`)            | Server-only   | Database the app connects to |
| `AUTH_SECRET`           | You generate (command below)                 | Server-only   | Used by jose to sign/verify session JWTs |
| `NEXT_PUBLIC_APP_URL`   | Your app URL                                 | Public        | `http://localhost:3000` in dev; production URL in prod (see §9) |
| `NEXT_PUBLIC_APP_NAME`  | You choose (recommend `ZYP POS`)            | Public        | Currently reserved/forward-compatible; set it anyway |

> `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_NAME` are not yet read by any code in
> Phase 1 — they are reserved for upcoming features (email links, OpenGraph, etc.).
> Still set them so deployments stay forward-compatible.

There is also one **optional, temporary** variable:

| Variable            | Server/Client | Notes |
| ------------------- | ------------- | ----- |
| `FULL_ACCESS_MODE`  | Server-only   | Dev/demo only. `true` lets restaurant roles open every module regardless of plan, so the app can be tested end to end. Does not bypass RBAC and changes no plan/subscription data. Leave `false` in production. See [docs/full-access-mode.md](docs/full-access-mode.md) |

Generate `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 1.5 Example `.env.local`

```ini
# MongoDB (server-side only - never exposed to browser)
MONGODB_URI=mongodb+srv://restopos_app:YOUR_DB_PASSWORD@cluster0.xxxxx.mongodb.net
MONGODB_DB_NAME=restopos

# Auth
AUTH_SECRET=gQ7v...32-random-base64-chars...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=ZYP POS

# Temporary dev/demo only — see docs/full-access-mode.md
FULL_ACCESS_MODE=false
```

### 1.6 Start the development server

```bash
npm run dev
```

Open http://localhost:3000. The landing page loads instantly (static). Go to
`http://localhost:3000/signup` to create an account.

What the server needs BEFORE a successful signup:
- A Mongo DB is reachable at `MONGODB_URI`. Signup **will fail** with a 500 /
  "Unable to connect to the database" if MongoDB is down. Use the Docker option
  below or Atlas (§2).
- `AUTH_SECRET` is present (session signing).

#### Option A: run MongoDB locally with Docker (fastest)

```bash
docker run -d --name restopos-mongo -p 27018:27017 mongo:7
```

Then set in `.env.local`:

```ini
MONGODB_URI=mongodb://127.0.0.1:27018
MONGODB_DB_NAME=restopos
```

#### Option B: use MongoDB Atlas directly for dev (recommended for consistency with prod)

Follow §2 and paste the Atlas connection string into `.env.local`.

---

## 2. MONGODB ATLAS SETUP

**MANUAL STEP REQUIRED** — all of §2 happens in the Atlas web dashboard
(`https://cloud.mongodb.com`).

### 2.1 Create an Atlas account

1. Go to https://www.mongodb.com/cloud/atlas/register.
2. Sign up with email (or Google/GitHub OAuth) and complete onboarding.
3. Choose the **FREE (M0)** shared cluster when asked.

### 2.2 Create a project

1. Create organization (name e.g. `ZYP POS Org`) if prompted.
2. Create a project.
3. **Project Name:** `restopos` (or anything).
4. Add members if you have a team — not required.

### 2.3 Create a free cluster

1. Click **Build a Database**.
2. Select **M0 Free** tier (shared, 512 MB storage).
3. Pick a cloud provider + region near your users (e.g. `AWS / ap-south-1` Mumbai
   for India).
4. Name your cluster (e.g. `Cluster0`).
5. Click **Create** — takes ~1–3 minutes.

### 2.4 Create a database user

1. While creating the cluster (or later under **Database Access**), click
   **Add New Database User**.
2. **Authentication Method:** Password.
3. **Username:** `restopos_app` (recommend a dedicated app user, not your admin).
4. **Password:** use **Autogenerate Secure Password** or set a strong one.
   Save it somewhere safe — you will paste it into `.env.local`.
5. **Database User Privileges:** `Atlas admin` is easiest for dev. For production
   best practice, create a second, restricted user — see §8.2.
6. Click **Add User**.

### 2.5 Configure Network Access

1. Open **Network Access** in the left menu.
2. Click **Add IP Address**.

Recommendation — use **two rules**:

- For your machine (dev): click **Add Current IP Address** (this auto-adds your
  public IP at build/dev time). If your IP changes (common for home broadband),
  update it in this screen.
- Only add other IPs if you specifically deploy from a fixed IP location.

> **Why IP allowlist and not "Allow access from anywhere"?** User/password in the
> connection string can be stolen from logs or leaked files. An IP allowlist keeps
> a leaked or brute-forced credential from being usable from other locations.
> For phase-1 convenience you *may* use **Allow access from anywhere**
> (`0.0.0.0/0`) — but for production use an allowlist (§8.1).

### 2.6 Get the connection string

1. In the cluster screen click **Connect** → **Drivers**.
2. Choose **Node.js**.
3. Copy the URI. It looks like:
   ```
   mongodb+srv://restopos_app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<password>` with the user password from §2.4. Atlas lets you paste the
   password into the field directly.

### 2.7 Put the connection string into `.env.local`

```ini
MONGODB_URI=mongodb+srv://restopos_app:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=restopos
```

> The database name in the URI is optional — the app uses `MONGODB_DB_NAME`
> (`restopos`) explicitly, creating it if it does not exist.

### 2.8 Creating databases and collections

- **No manual database creation is required.** On first successful write, Mongoose
  auto-creates the database and the three collections:
  - `users`
  - `restaurants`
  - `restaurantsettings`
- **Indexes** are also auto-built by Mongoose (`autoIndex` is on by default),
  including the **unique index on `users.email`**. You can verify after the first
  signup under Atlas **Database → Collections → (db) → collection → Indexes**.
- Optional but recommended once you have data: confirm the exact indexes match
  §4.3.

You can also verify things work before writing the first user by opening
Atlas **Data Explorer** → your cluster → `restopos` db.

---

## 3. AUTHENTICATION SETUP

ZYP POS does **not** use NextAuth. It has its own small auth stack:

- **Storage:** `users` collection. Column `passwordHash` stores an **argon2id**
  hash (memory cost 19456 KiB, 2 iterations, 1 lane). The hash is MongoDB-
  schematized with `select: false`, so it is never returned by default queries.
- **Session:** after login, the server issues a JWT signed with `jose` HS256 using
  `AUTH_SECRET`, and sets an **httpOnly, sameSite=lax** cookie named
  `restopos_session` (7-day expiry). The token carries `{ userId, restaurantId }`.
- **Routing:** `src/proxy.ts` decrypts the cookie and routes optimistically
  (dashboard vs. onboarding vs. login) without touching the DB.
- **Source of truth:** pages still verify against MongoDB with
  `getCurrentUser` / `getCurrentRestaurant` (cached per request). An expired or
  tampered cookie, or a token for a deleted user, is treated as logged-out.

### 3.1 How `AUTH_SECRET` is generated

```bash
openssl rand -base64 32
```

Paste the output into `AUTH_SECRET` in `.env.local` (and later in Vercel §7).

### 3.2 How users are created

- **Normal path:** the signup form (`/signup`) → `src/actions/auth/signup.ts`
  (server action). It validates with Zod, **checks for a duplicate email**, hashes
  the password with argon2, inserts the user (default role `OWNER`,
  `isActive: true`), sets the session cookie, and redirects to `/onboarding/restaurant`.
- **Seed path:** `npm run db:seed` (see §5).
- **Manual path (dev only):** insert directly with `mongosh` — see §4.6.

### 3.3 How the first OWNER account is created

1. User signs up at `/signup`.
2. They are redirected to `/onboarding/restaurant`.
3. They fill the restaurant form (name, business type, address, GST, etc.).
4. `src/actions/onboarding.ts` → `createRestaurantForUser` (§3.4) creates the
   restaurant + settings and sets the user to `role: "OWNER"` with a
   `restaurantId`.
5. Redirect to `/dashboard`.

### 3.4 How signup creates a restaurant

`src/lib/restaurant-service.ts` `createRestaurantForUser`:

1. Loads the user; returns errors if the user is missing or deactivated.
2. **Idempotent:** if the user already owns a restaurant, it returns the existing
   id instead of duplicating.
3. **Preferred path:** a multi-document MongoDB **transaction** (atomic across
   `restaurants`, `restaurantsettings`, and the `users` update) when the deployment
   supports it.
4. **Fallback:** MongoDB transactions require a replica set. Standalone mongod and
   Atlas **M0 free tier** do not reliably support them, so the app detects the
   topology and falls back to **sequential writes** (restaurant → settings →
   user update), logging a warning if it had to fall back mid-flight.

### 3.5 How login works

1. `/login` form → `src/actions/auth/login.ts`.
2. Looks up the user by **email** (lowercased), selecting the password hash.
3. Verifies the submitted password with argon2 (`verifyPassword`).
4. On success: sets `restopos_session` cookie (now including `restaurantId`) and
   redirects to `/dashboard`.
5. On failure: returns a generic "Invalid email or password" (no user enumeration).

Deactivated users (`isActive: false`) are rejected.

### 3.6 Password reset

**Not implemented in Phase 1.** `/forgot-password` is a placeholder that explains
this and points users to their admin. A real reset (email link + token rotation)
is planned for a later phase. Verify the placeholder renders with:

```bash
curl -s http://localhost:3000/forgot-password | grep -o "Forgot password"
```

---

## 4. DATABASE SETUP

### 4.1 Collections

Mongoose creates lowercased plural collection names:

| Collection           | Purpose |
| -------------------- | ------- |
| `users`              | App users: `fullName`, `email` (unique), `passwordHash`, `phone`, `role`, `restaurantId`, `isActive`. Roles: `OWNER`, `MANAGER`, `CASHIER`, `WAITER`. |
| `restaurants`        | One document per restaurant tenant: `name`, `ownerId`, contact/address, GST (`gstRegistered`, `gstin`), `businessType`, `logoUrl`, `isActive`. |
| `restaurantsettings` | Tenant configuration, one per restaurant: `currency` (`INR`), `defaultTaxRate`, `taxInclusive`, `serviceChargeEnabled/Rate`, `roundOffEnabled`, `billPrefix` (`BILL`), `kotPrefix` (`KOT`). |

All three have `createdAt`/`updatedAt` timestamps.

### 4.2 Why three collections

- `users` — authentication + identity, shared between employees and owners.
- `restaurants` — the **tenant**. Everything that belongs to "Restaurant A" hangs
  off its `_id` via `restaurantId`/`ownerId` fields.
- `restaurantsettings` — per-tenant billing/behavior defaults isolated from other
  tenants' data.

### 4.3 Important indexes (auto-created by Mongoose)

| Collection          | Index                      | Type | Why |
| ------------------- | -------------------------- | ---- | --- |
| `users`             | `email`                    | **unique** | Prevents duplicate accounts; login lookup |
| `users`             | `restaurantId`             | normal | Fast per-restaurant user queries |
| `restaurants`       | `ownerId`                  | normal | Find a user's restaurant quickly |
| `restaurants`       | `name`                     | normal | Demo/duplicate-name lookup |
| `restaurantsettings`| `restaurantId`             | **unique** | One settings doc per tenant |

Verify in Atlas: **Database → Collections → *collection* → Indexes**.

### 4.4 Seed script

A demo seed ships with the repo: `scripts/seed-demo.ts`.

```bash
npm run db:seed
```

Requirements: `.env.local` present with `MONGODB_URI` (+ optional
`MONGODB_DB_NAME`). The script reads `.env.local` via `@next/env` automatically.
It is **idempotent** — safe to run repeatedly.

What it creates (§5).

### 4.5 Reset the development database

Dropping all three collections gives you a clean slate; the app re-creates them
automatically on next use:

```bash
npm run db:reset
```

> **DANGER:** deploys a `drop()` on `users`, `restaurants`, `restaurantsettings`.
> Never run against a production database.

Manual alternative with mongosh:

```bash
mongosh "MONGODB_URI/restopos" --eval "db.dropDatabase()"
```

### 4.6 Manual user insert (dev shortcut)

If you want a user without the app UI (hash a password with argon2 first):

```bash
mongosh "mongodb://127.0.0.1:27018/restopos" --quiet --eval '
db.users.insertOne({
  fullName: "Manual Owner",
  email: "manual@example.com",
  passwordHash: "<argon2 hash>",
  role: "OWNER",
  isActive: true,
  createdAt: new Date(), updatedAt: new Date(),
})
'
```

---

## 5. DEMO DATA

Run once after MongoDB is reachable:

```bash
npm run db:seed
```

Creates in the configured database:

| Type     | Login                              | Password   | Role    | Restaurant |
| -------- | ---------------------------------- | ---------- | ------- | ---------- |
| Owner    | `demo@restopos.local`              | `Demo@1234`| OWNER   | Demo Spice Kitchen |
| Cashier  | `cashier@restopos.local`           | `Demo@1234`| CASHIER | Demo Spice Kitchen |

Also creates the **Demo Spice Kitchen** restaurant (GST-registered, GSTIN
`27AABCD0123A1Z5`) and its default `restaurantsettings` document.

Log in with `demo@restopos.local / Demo@1234` at http://localhost:3000/login → you
land on `/dashboard`.

### 5.1 Removing demo data

- Everything incl. real users: `npm run db:reset`.
- Only the demo documents:
  ```bash
  mongosh "MONGODB_URI/restopos" --quiet --eval '
  db.users.deleteMany({ email: { $in: ["demo@restopos.local", "cashier@restopos.local"] } });
  db.restaurants.deleteMany({ name: "Demo Spice Kitchen" });
  db.restaurantsettings.deleteOne({ /* restaurantId of the demo restaurant */ });
  '
  ```
  (Delete `restaurantsettings` by the demo restaurant's `_id` — grab it from
  `db.restaurants.findOne({ name: "Demo Spice Kitchen" })._id` first.)

---

## 6. LOCAL TESTING

All commands run from the project root:

| Task          | Command             |
| ------------- | ------------------- |
| Lint          | `npm run lint`      |
| Type check    | `npm run typecheck` |
| Unit + integration tests | `npm test`    |
| Production build | `npm run build`  |
| Run production build locally | `npm run start` |

End-to-end MongoDB test (uses a real mongod binary from `mongodb-memory-server`,
no external install needed):

```bash
npm test
```

Optional: run the E2E suite against an external MongoDB (e.g. Docker or Atlas):

```bash
MONGODB_E2E_URI="mongodb://127.0.0.1:27018/restopos_e2e" npx vitest run tests/e2e.test.ts
```

Expected green state (Phase 1):

- `npm run lint` → no errors
- `npm run typecheck` → exit 0
- `npm test` → **5 files, 51 tests passing**
- `npm run build` → succeeds; routes include `/dashboard` (ƒ dynamic), all other
  pages static, and `ƒ Proxy (Middleware)` listed.

---

## 7. VERCEL DEPLOYMENT

### 7.1 Prerequisites

- Code is in a GitHub repo (create one and push — §13).
- MongoDB Atlas reachable **from the internet**: your Atlas allowlist must permit
  Vercel traffic or `0.0.0.0/0` (see §8.1).
- `vercel` CLI (optional): `npm i -g vercel`.

### 7.2 Create the Vercel project

**MANUAL STEP REQUIRED** — dashboard interactions:

1. Go to https://vercel.com and sign in (GitHub OAuth recommended).
2. **Add New… → Project**.
3. **Import Git Repository** → pick your ZYP POS GitHub repo (authorize Vercel
   to read your repos if asked).
4. **Framework Preset:** Next.js → auto-detected (build command `next build`,
   output `.next`). Leave defaults.
5. **Node.js Version:** set to **22.x** in Project → Settings → General → Node.js.
6. Click **Deploy**. Your project URL is `https://<project-name>-<hash>.vercel.app`.

> Do **not** rely on the auto-detected environment variables Vercel suggests for
> Next.js templates (they are only example values). Set your own (next step).

### 7.3 Add environment variables

**MANUAL STEP REQUIRED** — Vercel Project → **Settings → Environment Variables**.
Add each (Production / Preview / Development → click the "all" toggle or add to
each environment):

| Key                     | Value |
| ----------------------- | ----- |
| `MONGODB_URI`           | Your Atlas `mongodb+srv://...` string (with user + password substituted) |
| `MONGODB_DB_NAME`       | `restopos` |
| `AUTH_SECRET`           | Output of `openssl rand -base64 32` (**or the same value as local** so existing sessions survive) |
| `NEXT_PUBLIC_APP_URL`   | `https://<your-project>.vercel.app` (then update after §9) |
| `NEXT_PUBLIC_APP_NAME`  | `ZYP POS` |

Notes:
- `NEXT_PUBLIC_*` values are inlined **at build time** — a new deploy is required
  after changing them.
- Server-only values (`MONGODB_URI`, `AUTH_SECRET`) are injected at runtime and
  are never exposed to the browser.
- Keep `AUTH_SECRET` the **same** as local so cookies set locally are valid in prod
  (recommended while you experiment). For strict separation, rotate it and force
  everyone to re-login (§8.4).

### 7.4 Redeploy after changing environment variables

**MANUAL STEP REQUIRED:**

1. **Settings → Environment Variables** → edit/save the value.
2. Go to **Deployments** → find the production deployment → click **⋮ → Redeploy**.
3. On the prompt pick **Use existing build cache** (fast) or without (clean).

---

## 8. MONGODB PRODUCTION SECURITY

### 8.1 Network access in production

- Rule 1 — **your team's IP(s):** Atlas → Network Access → Add IP Address → manual
  entry of your office VPS/server IPs.
- Rule 2 — **Vercel:** Vercel does not expose fixed egress IPs for all plans, so
  to let serverless functions reach Atlas you must either:
  - add `0.0.0.0/0` (Allow access from anywhere) **for the app database only**, or
  - upgrade to a plan with fixed IPs.

  The pragmatic, widely-used config for a Next.js + Atlas app on Vercel is:
  - `0.0.0.0/0` for the `restopos` cluster,
  - a credential that is **unique and strong** so the open allowlist is not a
    backdoor (the App DB user below).

Recommendation: keep **attacker-controlled values out of the URI anyway** — never
log it, never put it in client code, never commit it.

### 8.2 Database user permissions

Create a least-privilege user for the app:

- Atlas → **Database Access → Add New User**.
- Username: `restopos_app`.
- Password: **Autogenerate Secure Password** (save it now).
- **Built-in Role:** `readWriteAnyDatabase` is the simplest correct role for a
  single app-db user (it cannot drop databases or manage users). Even better:
  create a **custom role** limited to `readWrite` on the `restopos` database only.

Do NOT use your Atlas admin account for the app URI.

### 8.3 Secret handling

- Never commit `.env.local`, `AUTH_SECRET`, or real `MONGODB_URI` (`.env*` is in
  `.gitignore`; `.env.example` is the committed template and holds only placeholders).
- Never print `process.env` in logs or error messages.
- Don't paste passwords into public issues/chats.
- Rotate secrets from time to time (below).

### 8.4 Rotating MongoDB credentials

**MANUAL STEP REQUIRED:**

1. Atlas → **Database Access** → edit the app user → **Update Password** (set a new
   autogenerated one).
2. Update `MONGODB_URI` in `.env.local` and in Vercel (§7.4) with the new password.
3. Redeploy on Vercel.
4. Optionally remove the old password rotation history later via **Network Access** /
   **Advanced** settings.

### 8.5 Rotating AUTH_SECRET

1. Generate: `openssl rand -base64 32`.
2. Update `.env.local` and Vercel (`AUTH_SECRET`).
3. Redeploy.
4. **Effect:** every existing `restopos_session` cookie becomes invalid → all users
   are logged out once. Tell owners to log in again.

---

## 9. CUSTOM DOMAIN

**MANUAL STEP REQUIRED** — registrar + Vercel dashboard:

1. Buy a domain from any registrar (GoDaddy, Namecheap, Hostinger, Cloudflare, …).
2. Vercel → project → **Settings → Domains** → **Add**.
3. Enter your domain (e.g. `restopos.in`) and follow the generated DNS instructions:
   - Preferred: add the **CNAME/ALIAS `cname.vercel-dns.com`** (or the exact target
     Vercel shows) for `restopos.in` and `www.restopos.in` at your registrar.
   - Or point nameservers to Vercel (more involved).
4. Wait for propagation (DNS can take minutes–hours; Vercel shows the status green
   in the Domains tab).
5. Vercel provisions an **HTTPS cert automatically**.
6. **Update `NEXT_PUBLIC_APP_URL`** in Vercel env to `https://restopos.in` and
   redeploy (§7.4).
7. Optional: mark the custom domain **"Redirect to Primary"** so `www` and apex
  unify.

---

## 10. BACKUPS

### 10.1 What the plans provide

- **M0 Free (shared):** **no automated backups**, no continuous/pit point-in-time
  recovery. You are responsible for your own copies.
- **M10+ (dedicated):** Cloud Backups **continuous backup / PITR** included, plus
  daily snapshots. Use the Atlas UI to schedule snapshot retention.

### 10.2 Manual backup / export (all plans)

Using `mongodump` against the Atlas connection string:

```bash
mongodump --uri="mongodb+srv://restopos_app:PASSWORD@cluster0.xxxxx.mongodb.net" \
  --db=restopos --out=./backups/$(date +%Y-%m-%d)
```

Or from the Atlas UI (small DBs): **Data Explorer → (collection) → Export → JSON/CSV**.

### 10.3 Restore

```bash
mongorestore --uri="mongodb+srv://..." --db=restopos ./backups/2026-09-16/restopos
```

(Adjust the spec if you exported CSV/JSON via Data Explorer.)

### 10.4 Recommended production strategy

1. **Free tier:** weekly `mongodump` to cloud storage (S3/R2/Drive), keep ~4 weeks.
2. **As soon as revenue or real data exists:** move the app database to **M10**
   (`~$0.10/h`, `~₹5800–₹6500/mo`) and enable **Continuous Cloud Backup / PITR**,
   with one-off point-in-time restore drill.
3. Keep a recent full export **before** any schema-change deploy.

---

## 11. PRODUCTION CHECKLIST

- [ ] MongoDB configured (Atlas cluster created)
- [ ] Database user created (least privilege, not admin)
- [ ] Network access configured (allowlist / `0.0.0.0/0` with strong username)
- [ ] Environment variables configured (`.env.local` locally, Vercel env in prod)
- [ ] `AUTH_SECRET` generated (`openssl rand -base64 32`)
- [ ] Signup tested (dev → prod)
- [ ] Login tested (correct + wrong password)
- [ ] Restaurant registration tested (onboarding form completes)
- [ ] Owner role tested (new owner lands on `/dashboard`)
- [ ] Tenant isolation tested (see §14 — two restaurants don't see each other's data)
- [ ] Production build successful (`npm run build`)
- [ ] Vercel deployment successful
- [ ] Custom domain configured
- [ ] HTTPS working (open `https://yourdomain` — Vercel cert)
- [ ] Database backup strategy configured

---

## 12. TROUBLESHOOTING

### MongoDB connection failed (`Unable to connect to the database`, `MongooseServerSelectionError` / timeout)
- **Why:** `MONGODB_URI` wrong/incomplete, Atlas user IP not allowlisted, wrong
  cluster/region, or `MONGODB_DB_NAME` mismatch.
- **Identify:** run the app with logs:
  ```bash
  npm run dev
  ```
  look for Mongoose connection errors in the terminal; test connectivity with
  ```bash
  mongosh "MONGODB_URI" --eval "db.runCommand({ping:1})"
  ```
- **Fix:** verify the URI contains `restopos_app:<real password>`; add your IP to
  Atlas Network Access; ensure the cluster shows started; confirm `MONGODB_DB_NAME`
  matches the DB you created (or let it auto-create).

### Authentication failed (`Invalid email or password`)
- **Why:** wrong email/password, or the account is deactivated (`isActive: false`).
- **Identify:** check the user in Atlas Data Explorer — is `isActive` true?
- **Fix:** try `demo@restopos.local / Demo@1234` on a seeded DB; reset
  `isActive: true` if needed:
  ```bash
  mongosh "MONGODB_URI/restopos" --eval 'db.users.updateOne({email:"X"},{$set:{isActive:true}})'
  ```

### Invalid session / logged out immediately
- **Why:** `AUTH_SECRET` changed after the cookie was issued, cookie expired (7d),
  or the user was deleted.
- **Identify:** check the browser devtools → Application → Cookies for
  `restopos_session`; if it exists but you're logged out, compare `AUTH_SECRET`
  local vs Vercel.
- **Fix:** make `AUTH_SECRET` consistent across environments, or just log in again.

### `NEXT_PUBLIC_APP_URL` incorrect
- **Why:** old value (localhost / wrong domain) still configured; the app uses it
  for links/redirects in future features.
- **Identify:** it appears when generated links open the wrong host.
- **Fix:** set it to the exact production URL (`https://yourdomain`) and redeploy.

### Vercel environment variable missing
- **Why:** added var after the last deploy, or scope (Production/Preview) mismatch.
- **Identify:** Vercel → Settings → Environment Variables shows the var; if you
  see "not provided to next dev/vercel" checks, it's a scope/name problem.
- **Fix:** add to **all** environments, then redeploy (§7.4).

### Build failure (`next build` errors locally or on Vercel)
- **Why:** TypeScript/ESLint errors (Next 16 fails builds on untyped code),
  missing env at build time, or native module build issues.
- **Identify:** run `npm run typecheck` and `npm run lint`; read the Vercel build log
  for the exact file/line.
- **Fix:** fix the reported error; ensure `MONGODB_URI` is reachable during build
  (static pages that touch DB during generation); for argon2 on Vercel, verify
  Node 22.x is selected (§7.2) since it ships prebuilt binaries.

### Database timeout (slow first load / M0 throttling)
- **Why:** free M0 cold start, unindexed queries, or region far from the serverless
  runtime.
- **Identify:** Atlas → Performance Advisor / logs; check `explain()` "COLLSCAN".
- **Fix:** confirm the indexes in §4.3 exist; move cluster region closer to users;
  upgrade cluster when load grows.

### Duplicate email (`E11000 duplicate key error`)
- **Why:** two signups raced, or you inserted a user with an existing email.
- **Identify:** the unique index on `users.email` throws `E11000`; check the
  collection for both docs.
- **Fix:** intended behavior — the app shows/redirects the duplicate-email error.
  If an orphan exists, delete it manually then retry signup.

### Unauthorized restaurant access (user sees another restaurant's data)
- **Why:** data was created without a `restaurantId`, or role checks bypassed in a
  future feature.
- **Identify:** query tenant data and check `restaurantId`; confirm the session on
  that user belongs to the same `restaurant`.
- **Fix:** Phase 1 isolates via `restaurantId` on models + `requireRestaurant`
  guard + proxy routing. **Rule for all future features:** every tenant query MUST
  filter by the current user's `restaurantId` (see §14) and use `requireRole`.

### Cannot create restaurant (onboarding fails)
- **Why:** user already owns a restaurant (idempotency returns existing),
  deactivated user, validation error, or DB unreachable.
- **Identify:** read the server action logs; verify the user has `restaurantId` null.
- **Fix:** check DB connectivity and Zod validation messages on the form; if a
  partial bundle was created (sequential write without transactions), re-run
  onboarding — it reuses the existing restaurant.

### Production works locally but not on Vercel
- **Why:** env vars not set on Vercel, IP allowlist blocks Vercel, `NEXT_PUBLIC_*`
  stale (not redeployed), or Node version mismatch.
- **Identify:** compare `env` between local / Vercel for both mirrors; check Vercel
  function logs (Runtime Logs).
- **Fix:** set all env vars on Vercel (all scopes), redeploy, allowlist
  `0.0.0.0/0` or Vercel IPs, pin Node 22.x.

---

## 13. DEVELOPMENT → PRODUCTION FLOW

```text
Code locally (npm run dev, tests green)
        │
        ▼
npm run lint · npm run typecheck · npm test · npm run build
        │
        ▼
git add .   (ensures .env.local is NOT staged)
git commit -m "feat: ..."
        │
        ▼
git remote add origin https://github.com/<you>/<repo>.git   (once)
git push -u origin main
        │
        ▼
Vercel picks up push → Production build + deploy (auto)
        │
        ▼
Runtime connects to MongoDB Atlas (MONGODB_URI) using the configured DB user
        │
        ▼
Test production: signup → onboarding → dashboard on https://yourdomain
        │
        ▼
Release: tag the commit, announce, capture backup snapshot (§10)
```

---

## 14. CUSTOMER / RESTAURANT SETUP (TENANT ISOLATION)

### What happens when a new restaurant buys the app

```text
Restaurant A signs up at /signup
→ OWNER account created (role OWNER, restaurantId null)
→ redirected to /onboarding/restaurant
→ fills restaurant details
→ createRestaurantForUser writes:
      restaurants  : new doc (ownerId = the user)
      restaurantsettings : new doc (restaurantId = restaurant)
      users.update : user.restaurantId = restaurant, role = OWNER
→ redirected to /dashboard (now shows the restaurant's name)
```

### How Restaurant B is isolated from Restaurant A

- Every tenant owns a unique `restaurants._id` and a unique
  `restaurantsettings` (unique `restaurantId`).
- Every user is attached to exactly one `restaurantId`.
- The session cookie carries the user's `restaurantId`; `src/proxy.ts` routes by it.
- Pages load the current user from the DB (`getCurrentUser`) and the restaurant via
  `getCurrentRestaurant`, so a cookie forged with another restaurant's id does not
  grant data access (guards verify against the DB).
- **Ground rule (non-negotiable for Phase 2+ features):** every collection that
  holds tenant data must include `restaurantId` with an index on it, and every query
  must filter by the current user's `restaurantId`. Never omit tenant scoping.

---

## 15. COST GUIDE

| Item               | Stage             | Cost |
| ------------------ | ----------------- | ---- |
| Development        | Your machine      | **₹0** (Node, npm, VS Code, mongodb-memory-server all free) |
| MongoDB Atlas      | Free (M0)         | **₹0** (512 MB storage, no auto-backups) |
| MongoDB Atlas      | Scale-up (M10)    | ~₹5,500–6,500/month (continuous backups/PITR, dedicated) |
| Hosting (Vercel)   | Hobby             | **₹0** (serverless, no fixed IPs) |
| Hosting (Vercel)   | Pro (fixed IPs, more scale) | ~₹1,700/month (~$20) |
| Domain | each year        | ~₹600–1,500/yr (`restopos.in`/`.com`) |
| TLS/HTTPS | Vercel         | **₹0** (auto certs) |
| Optional | Email service (SendGrid/Resend) for password-reset links later | ~₹0 at low volume |
| Optional | Backups / object storage (weekly dump) | ~₹0 at this size (use free tier of R2/Drive) |

### When to upgrade

- **M0 → M10** when you need automated backups/PITR, higher ops limits, or the free
  tier throttles under real usage (several restaurants × several users).
- **Vercel Hobby → Pro** when you need: deployment previews for teammates, fixed
  egress IPs, higher build minutes, or team collaboration.
- **Domain + email**: buy the domain before publicly pitching the product.

---

## 16. MANUAL STEPS — DO NOT OMIT

Items that cannot be automated and require dashboard clicks (already flagged above;
quick index):

1. MongoDB Atlas: account → cluster → **DB user** (§2.4) → **Network Access** (§2.5)
   → **Connection string copy** (§2.6).
2. Vercel: import repo (§7.2) → **Environment Variables** (§7.3) → **Redeploy** (§7.4).
3. Registrar DNS for the custom domain (§9).
4. Atlas: user rotation (§8.4), backup scheduling (§10), cluster upgrade (§15).

---

# ZYP POS - Complete Setup Checklist

Fresh computer → running production product, in one pass:

**1. Local**
- [ ] Install Node 22 (`nvm install 22 && nvm use 22`)
- [ ] `git clone <repo>` && `cd pos`
- [ ] `npm install`
- [ ] `cp .env.example .env.local`
- [ ] Fill `.env.local`: `MONGODB_URI`, `MONGODB_DB_NAME`, `AUTH_SECRET`
      (`openssl rand -base64 32`), `NEXT_PUBLIC_APP_URL=http://localhost:3000`,
      `NEXT_PUBLIC_APP_NAME=ZYP POS`

**2. MongoDB**
- [ ] Atlas account + M0 cluster created (Mumbai/`ap-south-1` recommended)
- [ ] DB user `restopos_app` created (own password)
- [ ] `Network Access` → your IP (and `0.0.0.0/0` for Vercel later)
- [ ] Connection string → `MONGODB_URI` in `.env.local`

**3. Verify local**
- [ ] `npm run dev` → http://localhost:3000
- [ ] `npm run db:seed` → status shows demo owner/restaurant created
- [ ] Login `demo@restopos.local` / `Demo@1234` → `/dashboard`
- [ ] Signup a brand-new owner → onboarding → `/dashboard` (verifies real DB write)
- [ ] `npm run lint` green, `npm run typecheck` green, `npm test` green,
      `npm run build` green

**4. First restaurant flow (already covered by signup test)**
- [ ] New signup → owner account → restaurant form → settings created → dashboard

**5. Git + GitHub**
- [ ] `git remote add origin https://github.com/<you>/<repo>.git`
- [ ] `git add . && git commit` (confirm `.env.local` NOT staged)
- [ ] `git push -u origin main`

**6. Vercel + production**
- [ ] Vercel project imported from the GitHub repo (Next.js detected, Node 22.x)
- [ ] Env vars added on Vercel (Production/Preview/Development):
      `MONGODB_URI`, `MONGODB_DB_NAME`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`,
      `NEXT_PUBLIC_APP_NAME`
- [ ] First deploy succeeds; open `https://<project>.vercel.app`

**7. Custom domain (optional until public)**
- [ ] Buy domain
- [ ] Vercel → Settings → Domains → add + registrar DNS (CNAME to Vercel)
- [ ] HTTPS green
- [ ] `NEXT_PUBLIC_APP_URL=https://yourdomain` + redeploy

**8. Production hardening**
- [ ] Test prod signup/login/onboarding on `https://yourdomain`
- [ ] Confirm tenant isolation: create a 2nd restaurant signup → cannot see #1's data
- [ ] Backup strategy in place (weekly dump, or M10 with PITR)
- [ ] `AUTH_SECRET` / DB password only in `.env.local` + Vercel (never in git)

**9. Release**
- [ ] Final `npm run build` on clean checkout
- [ ] Deploy, smoke-test, announce 🎉