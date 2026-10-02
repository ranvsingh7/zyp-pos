# FULL_ACCESS_MODE (temporary)

> **TEMPORARY — development/demo only. Do not enable in production.**
> Delete `src/lib/config/full-access.ts` and the two call sites noted below once
> you no longer need it. The plan/subscription system is untouched and keeps
> working the whole time this flag exists.

## What it does

```ini
# .env.local
FULL_ACCESS_MODE=true
```

Every authenticated restaurant user — `OWNER`, `MANAGER`, `CASHIER`, `WAITER` —
can open every implemented module, whatever their plan actually grants. It is
there so the whole application can be clicked through and tested without
hand-issuing a plan with every service key to every venue first.

Set it back to `false` (or remove it) and plan-based entitlements return exactly
as they were. No code change, no data change, no migration.

| `FULL_ACCESS_MODE` | Behaviour |
| ------------------ | --------- |
| `true`             | Restaurant users reach every implemented service |
| `false` / unset    | Normal plan + subscription + service entitlement checks |

## What it deliberately does *not* do

- **It is not RBAC.** Roles are unchanged. A `CASHIER` still cannot manage staff,
  a `WAITER` still cannot open the revenue tab. The entitlement layer only ever
  answered "does the plan grant this service"; that question is separate from
  "is this role allowed", and only the first one is bypassed.
- **It does not make anyone `SUPER_ADMIN`.** The admin panel and
  `requireSuperAdmin()` are unaffected.
- **It creates and changes no data.** No plan, subscription, service snapshot,
  subscription history or audit row is written. This is a read-time decision.
- **It does not disable feature gating.** The catalog, `serviceKeys`, the plan
  editor, the snapshot resolution and the feature-gate component all stay in
  place and are used again the moment the flag is off.
- **Only *implemented* services are granted.** The catalogued-but-unbuilt keys
  (`CUSTOMERS`, `DIGITAL_MENU`, `QR_ORDERING`, `ONLINE_ORDERING`, `KDS`,
  `API_INTEGRATION`) stay denied, because `enabled: false` exists to stop the
  app advertising something with no code behind it. Granting a new module needs
  no change here — it is included the moment it is implemented.

## Why it works everywhere

It is read in exactly two places, both of which were already deciding access:

1. **`getServiceAccess()`** — `src/lib/services/access.ts`. The single resolver
   behind every page gate (`requireService`), every server action and API route
   (`assertService` / `assertServiceForCurrentVenue`), and the navigation
   filtering (`AppHeaderServer`, dashboard quick actions). Bypassing it here is
   what makes this a real server-side control rather than a frontend-only one:
   hidden navigation is never the mechanism, the resolver is.
2. **`requireRestaurant()`** — `src/lib/auth/guards.ts`. The subscription
   lifecycle gate that redirects to `/subscription-blocked` before any app page
   renders, so an expired or unprovisioned venue is still drivable.

The subscription service itself is deliberately left alone, so it keeps reporting
the true status to the admin panel, the subscription view and the subscription
banner.

No page, component, route handler or action references the flag. To turn the
behaviour on or off, change this one value.

## Security

Trusted server configuration only. The variable has no `NEXT_PUBLIC_` prefix, and
the module that reads it is marked `server-only`, so importing it from a client
component is a build error. Nothing reads the flag from a request header, query
string, request body, cookie, `localStorage` or session payload — a browser
cannot turn full access on for itself.

Parsing is strict on purpose: only the exact string `true` (any case, whitespace
ignored) enables it. A typo such as `ture` falls back to plan-based access
rather than silently granting every service.

## Tests

`tests/full-access-mode.e2e.test.ts` covers both directions of the switch, that
RBAC and `SUPER_ADMIN` behaviour are unaffected, that direct URLs, API routes and
server actions open up, and that no plan or subscription document is modified
while it is on.

`vitest.config.ts` pins `FULL_ACCESS_MODE=false`, so the rest of the suite always
exercises the real plan-based behaviour regardless of your local `.env.local`.
