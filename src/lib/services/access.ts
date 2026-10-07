import "server-only";

import { cache } from "react";
import { connectDB } from "@/lib/db";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { isSuperAdmin } from "@/lib/auth/roles";
import { requireAuth } from "@/lib/auth/guards";
import { isFullAccessMode } from "@/lib/config/full-access";
import {
  getService,
  isServiceKey,
  listActiveServices,
  resolveEntitledServices,
  serviceName,
  type ServiceKey,
} from "@/lib/services/catalog";

/**
 * Server-side plan/service access control.
 *
 * This is the only place a "can this venue use this service" decision is made.
 * Navigation hiding is a UX convenience layered on top of it; the enforcement
 * that matters lives here and is called from pages, API route handlers and
 * server actions alike.
 *
 * Access order is deliberately: authentication -> subscription entitlement ->
 * role permission. Service access never substitutes for RBAC: a CASHIER on a
 * plan that includes INVENTORY still cannot touch inventory, because this layer
 * only answers "does the plan grant it" and the domain's `assertCanX(role)`
 * still answers "is this role allowed".
 *
 * Everything here derives the restaurant from the caller's session, never from
 * a client-supplied restaurantId, so there is nothing for a caller to tamper
 * with.
 *
 * TEMPORARY: `FULL_ACCESS_MODE=true` short-circuits the entitlement step for
 * restaurant users so every implemented module can be tested without
 * provisioning a plan for it. It is consulted only in `getServiceAccess()`
 * below, which is why it takes effect for pages, server actions, API routes and
 * navigation alike. See `src/lib/config/full-access.ts`, and switch the flag off
 * to get exactly the behaviour documented above.
 */

/** Thrown by `assertService`; converted to a 403/UI message by the caller. */
export class ServiceAccessError extends Error {
  readonly service: ServiceKey;
  readonly serviceLabel: string;
  constructor(service: ServiceKey) {
    super(
      `${serviceName(service)} is not included in your current plan. Please contact your administrator to upgrade.`
    );
    this.name = "ServiceAccessError";
    this.service = service;
    this.serviceLabel = serviceName(service);
  }
}

/** Where the resolved entitlement came from. Useful for diagnostics and tests. */
export type ServiceEntitlementSource = "SNAPSHOT" | "PLAN" | "LEGACY" | "FULL_ACCESS";

export interface ServiceAccess {
  /** Services the venue may use, after dependency resolution. */
  serviceKeys: ServiceKey[];
  set: ReadonlySet<ServiceKey>;
  /** Display name of the current plan, for the locked page. */
  planName: string;
  /** True when no subscription snapshot existed and a fallback was applied. */
  isFallback: boolean;
  source: ServiceEntitlementSource;
}

export interface ResolvedServiceAccess extends ServiceAccess {
  has: (key: ServiceKey) => boolean;
  isSuperAdmin: boolean;
}

const NOTHING: ResolvedServiceAccess = {
  serviceKeys: [],
  set: new Set(),
  planName: "",
  isFallback: true,
  source: "LEGACY",
  has: () => false,
  isSuperAdmin: false,
};

/**
 * TEMPORARY — the `FULL_ACCESS_MODE=true` entitlement.
 *
 * Grants every service in the catalog that actually has an implementation behind
 * it, so pages, server actions, API routes and the navigation all open up from
 * this one object. Deliberately read-only: it queries no plan and no subscription
 * and writes nothing, which is what makes the flag safe to flip back and forth
 * and what guarantees no snapshot is silently rewritten while it is on.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It grants `listActiveServices()`, not `SERVICE_KEYS`. The catalogued-but-
 *    unimplemented keys (CUSTOMERS, DIGITAL_MENU, KDS, ...) stay denied, because
 *    `enabled: false` exists precisely to stop the app claiming a capability that
 *    has no code behind it. Full access means "everything that exists", not
 *    "everything that was ever planned".
 *  - It does not widen the role. `isSuperAdmin` stays false, so this cannot and
 *    does not promote a restaurant user to an unrestricted one; RBAC is a
 *    separate layer and keeps applying exactly as before.
 *  - It does not read the real plan. `planName` is a marker rather than a plan,
 *    and nothing reads it in this mode because no service is ever locked.
 */
function fullAccessEntitlement(): ResolvedServiceAccess {
  const serviceKeys = listActiveServices().map((s) => s.key);
  const set: ReadonlySet<ServiceKey> = new Set(serviceKeys);
  return {
    serviceKeys,
    set,
    planName: "Full Access Mode",
    // Not a fallback: nothing was guessed, the grant is deliberate.
    isFallback: false,
    source: "FULL_ACCESS",
    has: (key: ServiceKey) => set.has(key),
    isSuperAdmin: false,
  };
}

/**
 * Entitlement for a restaurant, resolved once per request.
 *
 * ## Why the parameters are primitives, not an options object
 *
 * `cache()` keys each entry by **argument identity**. React's implementation
 * keeps primitive arguments in a `Map` and object/function arguments in a
 * `WeakMap`, so a freshly constructed object literal is a guaranteed cache miss
 * on every call:
 *
 *     getServiceAccess(rid, { role })   // new object each time -> 1 query per call
 *
 * That is exactly the bug this signature used to have. Both
 * `requireService()` (via `checkService`) and `AppHeaderServer` passed their own
 * `{ role }` literal, so the two logically identical entitlement checks in a
 * single page render each ran their own `subscriptions` + `plans` query, and
 * `cache()` silently did nothing. It is passed as a bare `string | null` now so
 * both call sites collapse onto one cache entry and one pair of queries.
 *
 * Do not reintroduce an options object here without re-checking that, or the
 * de-duplication silently stops working.
 *
 * ## Cache scope
 *
 * `cache()` is scoped to a single React request render, so a result is never
 * shared between two requests, two users or two venues. Within one request the
 * venue id is the key and it is always derived from the session
 * (`getCurrentRestaurant()` <- `user.restaurantId`), never from the client —
 * see the module docblock above.
 */
export const getServiceAccess = cache(
  async (
    restaurantId: string,
    role?: string | null
  ): Promise<ResolvedServiceAccess> => {
    if (!restaurantId) return NOTHING;

    // A SUPER_ADMIN is never restricted by a tenant's plan. The admin panel
    // uses requireSuperAdmin(), but a super admin operating inside a venue's
    // own pages must not be locked out of a feature by that venue's plan.
    if (role != null && isSuperAdmin(role)) {
      return {
        ...NOTHING,
        serviceKeys: [],
        planName: "",
        isSuperAdmin: true,
        has: () => true,
      };
    }

    // TEMPORARY — full-access mode. See `src/lib/config/full-access.ts`. This is
    // the single place the flag is honoured for services, and because every page
    // gate, server action, API route and navigation filter resolves through this
    // function, switching it on here opens all of them at once. It sits *after*
    // the SUPER_ADMIN branch so that a super admin's result is byte-identical
    // whether or not the flag is on, and it returns before any database read so
    // nothing is queried, snapshot or written in this mode.
    if (isFullAccessMode()) return fullAccessEntitlement();

    await connectDB();
    const [sub, plan] = await Promise.all([
      SubscriptionModel.findOne({ restaurantId }).select("planId planName serviceKeys").lean(),
      // The plan is only needed for the pre-snapshot fallback, but it is
      // fetched alongside so the common snapshot case is still one round trip.
      PlanModel.find().select("_id name serviceKeys").lean(),
    ]);

    const planById = new Map(
      plan.map((p) => [
        String(p._id),
        {
          name: String(p.name),
          serviceKeys: Array.isArray(p.serviceKeys) ? p.serviceKeys.map(String) : [],
        },
      ])
    );
    const planId = sub ? String(sub.planId) : "";
    const livePlan = planById.get(planId);

    const serviceKeys = sub
      ? resolveEntitledServices(sub.serviceKeys, livePlan?.serviceKeys ?? [])
      : // No subscription at all: an unprovisioned venue keeps the same
        // everything-available default as a legacy one, so self-onboarding and
        // the trial flow are never locked out.
        resolveEntitledServices(undefined, livePlan?.serviceKeys ?? []);

    const source: ServiceEntitlementSource = sub
      ? Array.isArray(sub.serviceKeys)
        ? "SNAPSHOT"
        : livePlan && livePlan.serviceKeys.length > 0
          ? "PLAN"
          : "LEGACY"
      : "LEGACY";

    const set: ReadonlySet<ServiceKey> = new Set(serviceKeys);
    // The plan name snapshot wins, exactly as it does everywhere else.
    const planName = sub?.planName
      ? String(sub.planName)
      : (livePlan?.name ?? (sub ? planId : ""));

    return {
      serviceKeys,
      set,
      planName,
      isFallback: source !== "SNAPSHOT",
      source,
      has: (key: ServiceKey) => set.has(key),
      isSuperAdmin: false,
    };
  }
);

/** True when the venue's plan grants `key`. */
export async function hasService(
  restaurantId: string,
  key: ServiceKey,
  role?: string | null
): Promise<boolean> {
  if (!isServiceKey(key)) return false;
  const access = await getServiceAccess(restaurantId, role);
  return access.has(key);
}

/**
 * Throws `ServiceAccessError` when the service is not granted. For server
 * actions and API handlers, where a redirect would be wrong.
 */
export async function assertService(
  restaurantId: string,
  key: ServiceKey,
  role?: string | null
): Promise<void> {
  if (!isServiceKey(key)) {
    throw new ServiceAccessError(key);
  }
  const access = await getServiceAccess(restaurantId, role);
  if (!access.has(key)) throw new ServiceAccessError(key);
}

/**
 * The variant server actions and API handlers use.
 *
 * Takes the venue and role from the caller's authenticated session rather than
 * from arguments, which is what makes this safe to drop into a shared action
 * wrapper: there is no restaurantId for a caller to tamper with, and the venue
 * is always the one the session is bound to.
 *
 * Uses the same `requireAuth()` the actions already call, so it adds no second
 * session read and stays consistent with the identity the action is running as.
 * The calling action remains responsible for the rest of the guard chain
 * (`requireRestaurant()` for venue existence and subscription lifecycle);
 * this adds the one decision those guards do not make — whether the plan
 * covers this service.
 */
export async function assertServiceForCurrentVenue(key: ServiceKey): Promise<void> {
  const user = await requireAuth();
  const restaurantId = user.restaurantId;
  if (!restaurantId) {
    // No venue means no plan to consult. `requireRestaurant()` in the calling
    // action will have redirected by now; reaching here means a caller skipped
    // it, and failing closed is the only safe answer.
    throw new ServiceAccessError(key);
  }
  await assertService(restaurantId, key, user.role);
}

export type PageServiceDecision =
  | { allowed: true; access: ResolvedServiceAccess }
  | { allowed: false; access: ResolvedServiceAccess; service: ServiceKey; message: string };

/**
 * Non-throwing decision for pages. Returns the information the locked screen
 * needs (current plan + feature name) instead of redirecting, so an
 * authenticated user is never bounced to a login screen for a plan limitation.
 */
export async function checkService(
  restaurantId: string,
  key: ServiceKey,
  role?: string | null
): Promise<PageServiceDecision> {
  const access = await getServiceAccess(restaurantId, role);
  if (access.has(key)) return { allowed: true, access };
  const definition = getService(key);
  return {
    allowed: false,
    access,
    service: key,
    message: `${definition.name} is not included in your current plan.`,
  };
}
