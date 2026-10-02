import "server-only";

/*
 * ============================================================================
 *  TEMPORARY — DEVELOPMENT / DEMO MODE.  REMOVE BEFORE PRODUCTION.
 * ============================================================================
 *
 *  `FULL_ACCESS_MODE=true` grants every authenticated restaurant user access to
 *  every *implemented* service in the catalog, regardless of what their plan or
 *  subscription actually grants. It exists for one reason: to be able to click
 *  through and test every module of the application without having to hand-issue
 *  a plan with all sixteen service keys to every restaurant first.
 *
 *  What it is NOT:
 *
 *    - It is not a plan. No Plan, Subscription or snapshot document is created,
 *      edited or deleted. Turning the flag off restores plan-based access with no
 *      code change and no data change.
 *    - It is not RBAC. Roles are untouched: a CASHIER still cannot open staff
 *      management, and a WAITER still cannot see the revenue tab. This flag only
 *      answers "does the plan grant this service", which was always the separate,
 *      narrower question this layer answers.
 *    - It is not an escalation. A restaurant user granted every service is still
 *      a restaurant user. Nothing here produces a SUPER_ADMIN, and the admin
 *      panel is unaffected.
 *    - It does not switch anything off. Every existing plan, subscription,
 *      snapshot, catalog entry, resolver and audit row stays exactly as it is, and
 *      is used again the moment the flag is off.
 *
 *  ---------------------------------------------------------------------------
 *  HOW TO USE
 *  ---------------------------------------------------------------------------
 *
 *    FULL_ACCESS_MODE=true    every restaurant role sees and can open every
 *                             implemented module (subject to its own RBAC)
 *    FULL_ACCESS_MODE=false   normal plan-based service entitlements
 *    unset                    identical to `false` — plan-based access
 *
 *  Put it in `.env.local` (or the deployment environment) and restart the dev
 *  server. It is a plain server-side variable with no `NEXT_PUBLIC_` prefix, so
 *  Next.js never exposes it to the browser.
 *
 *  ---------------------------------------------------------------------------
 *  SECURITY
 *  ---------------------------------------------------------------------------
 *
 *  Trusted server configuration only. There is deliberately no code path that
 *  reads this flag from a request header, query string, request body, cookie,
 *  localStorage or session payload — `requireAuth()` and friends are never asked
 *  about it, and no client component imports this module (`server-only` makes
 *  that a build error rather than a convention). A browser cannot turn full
 *  access on for itself.
 *
 *  Parsing is deliberately unforgiving: only the exact string `true` (any case,
 *  surrounding whitespace ignored) enables full access. A typo like `ture` or
 *  `enabled` therefore falls back to plan-based access rather than silently
 *  granting every service — the safe direction to fail in for a flag that
 *  removes a security-adjacent restriction.
 *
 *  ---------------------------------------------------------------------------
 *  WHY THE CHECK LIVES HERE AND NOT AT THE CALL SITES
 *  ---------------------------------------------------------------------------
 *
 *  `isFullAccessMode()` is the only definition of "temporary full access" in the
 *  codebase. It is consulted in exactly two places, and both of them are
 *  pre-existing enforcement points that were already deciding access:
 *
 *    1. `getServiceAccess()` in `src/lib/services/access.ts` — the single
 *       resolver behind every page gate, every server action's `assertService`,
 *       every API route's `assertServiceForCurrentVenue`, and the navigation
 *       filtering. Bypassing it there covers page access, API access, server
 *       actions and navigation in one move, which is what makes this a real
 *       server-side control rather than a frontend-only one.
 *    2. `requireRestaurant()` in `src/lib/auth/guards.ts` — the subscription
 *       lifecycle gate that redirects to `/subscription-blocked` before any app
 *       page can render. The subscription service itself is left untouched and
 *       keeps reporting the truth to the admin panel, the subscription view and
 *       the banner.
 *
 *  No page, component, route handler or action references this flag directly.
 *  Adding a 16th service to the catalog needs no changes here: it is granted the
 *  moment it is implemented.
 */

const FLAG_NAME = "FULL_ACCESS_MODE";

/**
 * True only when `FULL_ACCESS_MODE` is exactly `true` (case-insensitive).
 *
 * Read on every call rather than cached at module load, so a value changed in
 * the environment is picked up without a rebuild and so tests can toggle it.
 *
 * The env object is read through a cast instead of `process.env.FLAG_NAME`, so
 * the value is resolved from the real runtime environment at call time and
 * cannot be frozen into the bundle as a build-time constant.
 */
export function isFullAccessMode(): boolean {
  const env = process.env as Record<string, string | undefined>;
  return (env[FLAG_NAME] ?? "").trim().toLowerCase() === "true";
}
