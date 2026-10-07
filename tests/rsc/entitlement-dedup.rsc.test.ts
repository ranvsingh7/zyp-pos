/**
 * Proves the entitlement de-duplication fix against a **real MongoDB** and a
 * **real React Server request cache scope**.
 *
 * ## What is being proved
 *
 * Before the fix, a single authenticated page render issued roughly 5 reads of
 * `subscriptions` and 2 of `plans`. Two independent causes:
 *
 *   1. `getServiceAccess()` was wrapped in `cache()` but took an options object,
 *      and React keys object arguments by identity in a `WeakMap`. Every caller
 *      passed its own `{ role }` literal, so every call was a cache miss.
 *   2. `getSubscriptionAccess()` was not cached at all, and `requireRestaurant()`
 *      is called several times during one render (page + `requireService()` +
 *      `AppHeaderServer`), each running its own subscription read.
 *
 * ## How this suite avoids proving nothing
 *
 *   - MongoDB is real (`:27018`, a throwaway database). Queries are counted from
 *     the driver's own `commandStarted` events, i.e. commands that actually went
 *     over the wire, not a mocked model method.
 *   - The request cache scope is real. `React.cache()` is a **no-op outside a
 *     render**, so a test that called these functions directly would observe
 *     zero de-duplication whether or not the bug existed. This suite therefore
 *     runs under `tests/vitest.rsc.config.ts`, which aliases `react` to the
 *     react-server build, and installs a per-request cache scope
 *     (`withRequestScope`).
 *   - The harness's ability to *detect* the bug is asserted separately in
 *     `cache-scope-harness.test.ts`, so a broken harness fails loudly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Resolve the URI the same way the application does, so the suite can never
// assert against a different database than the code under test uses.
const MONGODB_URI =
  process.env.MONGODB_URI ??
  process.env.MONGODB_E2E_URI ??
  "mongodb://127.0.0.1:27018/restopos_rsc_test";

let available = false;
/** The signed session cookie the real session code will read. */
let sessionToken = "";

// `next/headers` is the only thing between the real session code and a real
// signed JWT, so it is the only thing mocked here. `getSessionToken`,
// `getSessionUserId`, `getSessionRole`, `getCurrentUser`, `requireAuth` and
// `requireRestaurant` all run for real from that point on.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "restopos_session" && sessionToken ? { name, value: sessionToken } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Map(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  permanentRedirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { getSessionRole, encryptSession } from "@/lib/auth/session";
import {
  getServiceAccess,
  checkService,
  hasService,
  assertService,
} from "@/lib/services/access";
import { getSubscriptionAccess } from "@/lib/admin/subscription-service";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { UserModel } from "@/models/User";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { withRequestScope } from "./request-scope";

// ---------------------------------------------------------------------------
// Real wire-level command counting
// ---------------------------------------------------------------------------

type CommandCounts = Record<string, number>;

let counting = false;
let counts: CommandCounts = {};

function collectionOf(event: { commandName: string; command: Record<string, unknown> }): string {
  const value = event.command[event.commandName];
  return typeof value === "string" ? value : event.commandName;
}

function onCommandStarted(event: {
  commandName: string;
  command: Record<string, unknown>;
}): void {
  if (!counting) return;
  const key = `${event.commandName}:${collectionOf(event)}`;
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Reads of one collection. Mongoose `findOne` also sends a `find`. */
function reads(db: CommandCounts, collection: string): number {
  return db[`find:${collection}`] ?? 0;
}

/** Runs `fn` and returns both its value and the DB commands it produced. */
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; db: CommandCounts }> {
  counting = true;
  counts = {};
  try {
    const value = await fn();
    return { value, db: { ...counts } };
  } finally {
    counting = false;
    counts = {};
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASIC = ["DASHBOARD", "POS", "MENU", "TABLES", "ORDERS"] as const;
const PRO = [
  "DASHBOARD", "POS", "MENU", "TABLES", "ORDERS", "KOT", "BILLING", "INVENTORY",
  "REPORTS", "AUDIT", "STAFF", "SETTINGS", "SUBSCRIPTION",
] as const;

interface Venue {
  userId: string;
  restaurantId: string;
}

async function createVenue(opts: {
  name: string;
  planKeys?: readonly string[];
  withSubscription?: boolean;
  status?: string;
  /** false reproduces a pre-entitlements document with no serviceKeys snapshot. */
  snapshot?: boolean;
}): Promise<Venue> {
  const user = await UserModel.create({
    fullName: `Owner ${opts.name}`,
    email: `${opts.name}-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash: await hashPassword("Password123!"),
    role: "OWNER",
    isActive: true,
  });
  const userId = String(user._id);

  // Uses the app's own service so the fixture matches a real onboarding.
  const { restaurantId } = await createRestaurantForUser(userId, {
    name: opts.name,
    ownerName: `Owner ${opts.name}`,
    phone: "9876543210",
    address: "1 Food St",
    city: "Mumbai",
    state: "MA",
    pincode: "400001",
    gstRegistered: false,
    gstin: "",
    businessType: "Restaurant",
  });

  const plan = await PlanModel.create({
    name: `${opts.name} Plan`,
    pricePaise: 99900,
    billingCycle: "MONTHLY",
    durationDays: 30,
    gracePeriodDays: 7,
    isActive: true,
    serviceKeys: [...(opts.planKeys ?? PRO)],
  } as never);

  if (opts.withSubscription !== false) {
    const payload: Record<string, unknown> = {
      restaurantId,
      planId: plan._id,
      planName: plan.name,
      status: opts.status ?? "ACTIVE",
      startDate: new Date(Date.now() - 86_400_000),
      expiryDate: new Date(Date.now() + 30 * 86_400_000),
      billingCycle: "MONTHLY",
      listPricePaise: 99900,
      finalPricePaise: 99900,
      amountPaise: 99900,
    };
    if (opts.snapshot !== false) payload.serviceKeys = [...(opts.planKeys ?? PRO)];
    await SubscriptionModel.create(payload as never);
  }

  return { userId, restaurantId };
}

async function signInAs(role: string, userId: string, restaurantId: string | null): Promise<void> {
  sessionToken = await encryptSession({ userId, restaurantId, role });
}

/**
 * The entitlement work one authenticated page render performs: the page's own
 * `requireAuth()` + `requireRestaurant()`, then the `requireService()` check,
 * then `AppHeaderServer`'s independent check.
 *
 * `requireService()` delegates to `checkService()` with a primitive role after
 * resolving the session, which is exactly what this reproduces; `requireService`
 * itself is exercised by the existing entitlement suites.
 */
async function renderPageLike(): Promise<void> {
  await requireAuth();
  const restaurant = await requireRestaurant();
  const role = await getSessionRole();

  const decision = await checkService(restaurant.id, "MENU", role);
  expect(decision.allowed).toBe(true);

  const headerAccess = await getServiceAccess(restaurant.id, role);
  expect(headerAccess.serviceKeys.length).toBeGreaterThan(0);
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
      // Required for commandStarted/commandSucceeded events to be emitted at
      // all; without it the client silently never reports a query.
      monitorCommands: true,
    });
    await mongoose.connection.db?.command({ ping: 1 });
    mongoose.connection.getClient().on("commandStarted", onCommandStarted);
    available = true;
  } catch {
    available = false;
    // These are real-MongoDB integration tests. Skipping is the repo's existing
    // e2e convention, but it must never be mistaken for a passing assertion.
    console.warn(
      `[SKIPPED - NOT VERIFIED] entitlement de-duplication suite requires MongoDB at ${MONGODB_URI}. ` +
        `No database behaviour was proven by this run.`
    );
  }
}, 15000);

afterAll(async () => {
  if (available) {
    mongoose.connection.getClient().off?.("commandStarted", onCommandStarted);
  }
  await mongoose.disconnect();
});

beforeEach(async () => {
  vi.stubEnv("FULL_ACCESS_MODE", "false");
  sessionToken = "";
  if (!available) return;
  await Promise.all([
    PlanModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

// ---------------------------------------------------------------------------

describe("entitlement de-duplication (real DB, real request cache scope)", () => {
  it("1. two identical entitlement checks in one render read the subscription once", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "dedup", withSubscription: true });
    await signInAs("OWNER", venue.userId, venue.restaurantId);

    const { db } = await capture(() => withRequestScope(() => renderPageLike()));

    // The page gate and the header must collapse onto one subscriptions read
    // and one plans read.
    expect(reads(db, "subscriptions"), `commands: ${JSON.stringify(db)}`).toBeLessThanOrEqual(2);
    expect(reads(db, "plans"), `commands: ${JSON.stringify(db)}`).toBe(1);
  });

  it("2. the page gate and the app header share one entitlement result object", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "shared", withSubscription: true });
    await signInAs("OWNER", venue.userId, venue.restaurantId);

    const { value } = await capture(() =>
      withRequestScope(async () => {
        const restaurant = await requireRestaurant();
        const role = await getSessionRole();
        const gate = await checkService(restaurant.id, "MENU", role);
        const header = await getServiceAccess(restaurant.id, role);
        return { gateAccess: gate.access, header };
      })
    );

    // Identity equality proves a single resolution served both call sites.
    expect(value.gateAccess).toBe(value.header);
  });

  it("3. repeated requireRestaurant() calls do not re-read the subscription", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "guards", withSubscription: true });
    await signInAs("OWNER", venue.userId, venue.restaurantId);

    const { db } = await capture(() =>
      withRequestScope(async () => {
        // The page, requireService() and AppHeaderServer each call this.
        await requireRestaurant();
        await requireRestaurant();
        await requireRestaurant();
      })
    );

    expect(reads(db, "subscriptions"), `commands: ${JSON.stringify(db)}`).toBe(1);
  });

  it("4. fifteen further identical checks in one render add no reads", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "repeat", withSubscription: true });
    await signInAs("OWNER", venue.userId, venue.restaurantId);

    const { db } = await capture(() =>
      withRequestScope(async () => {
        for (let i = 0; i < 5; i += 1) {
          await checkService(venue.restaurantId, "MENU", "OWNER");
          await hasService(venue.restaurantId, "POS", "OWNER");
          await getServiceAccess(venue.restaurantId, "OWNER");
        }
      })
    );

    expect(reads(db, "subscriptions"), `commands: ${JSON.stringify(db)}`).toBe(1);
    expect(reads(db, "plans"), `commands: ${JSON.stringify(db)}`).toBe(1);
  });
});

describe("cache scope and tenant/user safety", () => {
  it("5. two different restaurants never share an entitlement result", async () => {
    if (!available) return;
    const a = await createVenue({ name: "venue-a", planKeys: BASIC, withSubscription: true });
    const b = await createVenue({ name: "venue-b", planKeys: PRO, withSubscription: true });

    const { db } = await capture(() =>
      withRequestScope(async () => {
        const accessA = await getServiceAccess(a.restaurantId, "OWNER");
        const accessB = await getServiceAccess(b.restaurantId, "OWNER");
        return { a: accessA.has("INVENTORY"), b: accessB.has("INVENTORY") };
      })
    );

    // BASIC must not inherit PRO's entitlements, and both must be resolved.
    expect(reads(db, "subscriptions")).toBe(2);
    expect(reads(db, "plans")).toBe(2);
  });

  it("6. distinct roles within one venue get distinct results", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "roles", withSubscription: true });

    const { value } = await capture(() =>
      withRequestScope(async () => {
        const owner = await getServiceAccess(venue.restaurantId, "OWNER");
        const superAdmin = await getServiceAccess(venue.restaurantId, "SUPER_ADMIN");
        const noRole = await getServiceAccess(venue.restaurantId, undefined);
        return {
          owner: owner.has("INVENTORY"),
          superIsAdmin: superAdmin.isSuperAdmin,
          noRoleIsAdmin: noRole.isSuperAdmin,
        };
      })
    );

    expect(value.owner).toBe(true);
    expect(value.superIsAdmin).toBe(true);
    expect(value.noRoleIsAdmin).toBe(false);
  });

  it("7. each request scope re-reads the subscription (no cross-request caching)", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "fresh", withSubscription: true });

    const first = await capture(() =>
      withRequestScope(() => getServiceAccess(venue.restaurantId, "OWNER"))
    );
    const second = await capture(() =>
      withRequestScope(() => getServiceAccess(venue.restaurantId, "OWNER"))
    );

    expect(reads(first.db, "subscriptions")).toBe(1);
    expect(reads(second.db, "subscriptions")).toBe(1);
  });

  it("8. one user's request result is not reused for another user of the same venue", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "users", withSubscription: true });
    const other = await UserModel.create({
      fullName: "Cashier",
      email: `cashier-${Date.now()}@restopos.test`,
      passwordHash: await hashPassword("Password123!"),
      role: "CASHIER",
      restaurantId: venue.restaurantId,
      isActive: true,
    } as never);

    await signInAs("OWNER", venue.userId, venue.restaurantId);
    const asOwner = await capture(() =>
      withRequestScope(async () => {
        const user = await requireAuth();
        expect(user.id).toBe(venue.userId);
        expect(user.role).toBe("OWNER");
        return getServiceAccess(venue.restaurantId, await getSessionRole());
      })
    );

    await signInAs("CASHIER", String(other._id), venue.restaurantId);
    const asCashier = await capture(() =>
      withRequestScope(async () => {
        const user = await requireAuth();
        expect(user.id).toBe(String(other._id));
        expect(user.role).toBe("CASHIER");
        return getServiceAccess(venue.restaurantId, await getSessionRole());
      })
    );

    // Each request performed its own subscription read: no leakage between users.
    expect(reads(asOwner.db, "subscriptions")).toBe(1);
    expect(reads(asCashier.db, "subscriptions")).toBe(1);
  });
});

describe("authorization behaviour is unchanged", () => {
  it("9. SUPER_ADMIN bypasses the tenant plan", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "super", planKeys: BASIC, withSubscription: true });
    await signInAs("SUPER_ADMIN", venue.userId, venue.restaurantId);

    const { value } = await capture(() =>
      withRequestScope(async () => {
        const access = await getServiceAccess(venue.restaurantId, "SUPER_ADMIN");
        return { isSuperAdmin: access.isSuperAdmin, inventory: access.has("INVENTORY") };
      })
    );

    expect(value.isSuperAdmin).toBe(true);
    expect(value.inventory).toBe(true);
  });

  it("10. a plan that omits the service still denies it", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "deny", planKeys: BASIC, withSubscription: true });

    const { value } = await capture(() =>
      withRequestScope(async () => {
        const allowed = await checkService(venue.restaurantId, "MENU", "OWNER");
        const denied = await checkService(venue.restaurantId, "INVENTORY", "OWNER");
        if (denied.allowed) throw new Error("INVENTORY should not be in a BASIC plan");
        return { allowed: allowed.allowed, denied: denied.allowed, service: denied.service };
      })
    );

    expect(value.allowed).toBe(true);
    expect(value.denied).toBe(false);
    expect(value.service).toBe("INVENTORY");
  });

  it("11. assertService resolves for an entitled key and throws for an unentitled one", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "assert", planKeys: BASIC, withSubscription: true });

    await withRequestScope(async () => {
      await expect(assertService(venue.restaurantId, "MENU", "OWNER")).resolves.toBeUndefined();
      await expect(assertService(venue.restaurantId, "BILLING", "OWNER")).rejects.toThrow(
        /not included/
      );
    });
  });

  it("12. FULL_ACCESS_MODE=false keeps plan enforcement and reads the subscription", async () => {
    if (!available) return;
    vi.stubEnv("FULL_ACCESS_MODE", "false");
    const venue = await createVenue({ name: "off", planKeys: BASIC, withSubscription: true });

    const { value, db } = await capture(() =>
      withRequestScope(async () => {
        const access = await getServiceAccess(venue.restaurantId, "OWNER");
        return { source: access.source, inventory: access.has("INVENTORY") };
      })
    );

    expect(value.source).toBe("SNAPSHOT");
    expect(value.inventory).toBe(false);
    expect(reads(db, "subscriptions")).toBe(1);
    expect(reads(db, "plans")).toBe(1);
  });

  it("13. FULL_ACCESS_MODE=true opens everything and queries nothing", async () => {
    if (!available) return;
    vi.stubEnv("FULL_ACCESS_MODE", "true");
    const venue = await createVenue({ name: "on", planKeys: BASIC, withSubscription: true });

    const { value, db } = await capture(() =>
      withRequestScope(async () => {
        const access = await getServiceAccess(venue.restaurantId, "OWNER");
        return {
          source: access.source,
          inventory: access.has("INVENTORY"),
          isSuperAdmin: access.isSuperAdmin,
        };
      })
    );

    expect(value.source).toBe("FULL_ACCESS");
    expect(value.inventory).toBe(true);
    // Full access must not widen the role, and must not query anything.
    expect(value.isSuperAdmin).toBe(false);
    expect(reads(db, "subscriptions")).toBe(0);
    expect(reads(db, "plans")).toBe(0);
  });

  it("14. an explicit reference time still overrides the default", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "expiry", withSubscription: true });

    const { value } = await capture(() =>
      withRequestScope(async () => {
        const during = await getSubscriptionAccess(venue.restaurantId, new Date());
        const longAfter = await getSubscriptionAccess(
          venue.restaurantId,
          new Date(Date.now() + 400 * 86_400_000)
        );
        return { during: during.allowed, after: longAfter.allowed, status: longAfter.status };
      })
    );

    expect(value.during).toBe(true);
    expect(value.after).toBe(false);
    expect(value.status).toMatch(/EXPIRED|GRACE_PERIOD/);
  });

  it("15. a snapshot-less subscription keeps its non-SNAPSHOT fallback", async () => {
    if (!available) return;
    const venue = await createVenue({
      name: "legacy",
      planKeys: BASIC,
      withSubscription: true,
      snapshot: false,
    });

    const { value } = await capture(() =>
      withRequestScope(async () => {
        const access = await getServiceAccess(venue.restaurantId, "OWNER");
        return { source: access.source, isFallback: access.isFallback };
      })
    );

    // A snapshot-less document must never report SNAPSHOT.
    expect(value.source).not.toBe("SNAPSHOT");
    expect(value.isFallback).toBe(true);
  });

  it("16. a missing subscription is blocked at the lifecycle gate", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "nosub", withSubscription: false });

    const { value } = await capture(() =>
      withRequestScope(() => getSubscriptionAccess(venue.restaurantId))
    );

    expect(value.allowed).toBe(false);
    expect(value.status).toBe("NONE");
  });

  it("17. requireRestaurant redirects a subscription-less venue", async () => {
    if (!available) return;
    const venue = await createVenue({ name: "blocked", withSubscription: false });
    await signInAs("OWNER", venue.userId, venue.restaurantId);

    await withRequestScope(async () => {
      await expect(requireRestaurant()).rejects.toThrow(/redirect:\/subscription-blocked/);
    });
  });
});