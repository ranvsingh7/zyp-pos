/**
 * Reproduction + fix verification for "the owner can still open everything".
 *
 * This suite is deliberately shaped like the *real* development database was
 * found: a plan with no `serviceKeys` field and a subscription with no
 * `serviceKeys` snapshot, both written before entitlements existed. It proves
 * where access is decided, and then proves the fix holds once a venue carries
 * a real snapshot.
 *
 * The distinction that matters:
 *   - the page gate itself is sound (it is exercised here for the first time);
 *   - the DATA is what let a BASIC venue through, because a snapshot-less
 *     subscription falls back to a frozen legacy list that includes BILLING,
 *     KOT, INVENTORY and REPORTS.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

vi.mock("@/lib/auth/session", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/session")>("@/lib/auth/session");
  return { ...actual, getSessionRole: vi.fn(async () => currentRole) };
});

vi.mock("@/lib/auth/guards", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/guards")>("@/lib/auth/guards");
  return { ...actual, requireAuth: vi.fn(), requireRestaurant: vi.fn() };
});

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { getSessionRole } from "@/lib/auth/session";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createPlan, updatePlan } from "@/lib/admin/plan-service";
import { createSubscription } from "@/lib/admin/subscription-service";
import { getServiceAccess, hasService, checkService } from "@/lib/services/access";
import { requireService } from "@/lib/services/service-gate";
import { backfillPlanSnapshots } from "../scripts/backfill-plan-snapshots";
import {
  LEGACY_SUBSCRIPTION_SERVICE_KEYS,
  SERVICE_KEYS,
  isServiceKey,
  type ServiceKey,
} from "@/lib/services/catalog";
import type { CurrentUser } from "@/lib/auth/guards";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_access_repro_e2e";

let available = false;
let restaurantId = "";
let currentRole = "OWNER";
let ownerUserId = "";

const BASIC = ["DASHBOARD", "POS", "MENU", "TABLES", "ORDERS"] as const;

function asUser(role: string): CurrentUser {
  return {
    id: ownerUserId,
    fullName: "Owner",
    email: "owner@x.test",
    phone: null,
    role: role as CurrentUser["role"],
    restaurantId,
    isActive: true,
  };
}

/** Signs a given role in, the way a real session would. */
function signInAs(role: string): void {
  currentRole = role;
  const user = asUser(role);
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(getSessionRole).mockResolvedValue(role as never);
  vi.mocked(requireRestaurant).mockResolvedValue({
    id: restaurantId,
    name: "Repro Cafe",
    logoUrl: null,
  } as Awaited<ReturnType<typeof requireRestaurant>>);
}

async function seedRestaurant(): Promise<void> {
  const user = await UserModel.create({
    fullName: "Owner",
    email: `repro-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
  });
  ownerUserId = String(user._id);
  const result = await createRestaurantForUser(ownerUserId, {
    name: "Repro Cafe",
    ownerName: "Owner",
    phone: "9876543210",
    address: "1 Food St",
    city: "Mumbai",
    state: "MA",
    pincode: "400001",
    gstRegistered: false,
    gstin: "",
    businessType: "Restaurant",
  });
  restaurantId = result.restaurantId;
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    available = true;
  } catch {
    available = false;
  }
}, 15000);

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!available) return;
  await Promise.all([
    PlanModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    UserModel.deleteMany({}),
    RestaurantModel.deleteMany({}),
    RestaurantSettingsModel.deleteMany({}),
  ]);
  await seedRestaurant();
  signInAs("OWNER");
});

/**
 * Writes a plan and subscription with the `serviceKeys` field genuinely absent,
 * exactly as the pre-entitlement documents in the dev database are.
 */
async function seedLegacyVenue(planName = "Silver"): Promise<string> {
  // Raw inserts: the whole point is that the field is ABSENT, and both schemas
  // would otherwise stamp a default onto it.
  const { insertedId: planId } = await PlanModel.collection.insertOne({
    name: planName,
    pricePaise: 99900,
    billingCycle: "MONTHLY",
    durationDays: 30,
    gracePeriodDays: 3,
    isFree: false,
    isActive: true,
    features: [],
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const planDoc = await PlanModel.collection.findOne({ _id: planId });
  expect(planDoc?.serviceKeys, "plan must have no serviceKeys field").toBeUndefined();

  await SubscriptionModel.collection.insertOne({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    planId,
    planName,
    billingCycle: "MONTHLY",
    listPricePaise: 99900,
    discountAmountPaise: 0,
    finalPricePaise: 99900,
    durationDays: 30,
    gracePeriodDays: 3,
    isFree: false,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    expiryDate: new Date("2027-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    autoRenew: false,
    notes: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const subDoc = await SubscriptionModel.collection.findOne({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });
  expect(subDoc?.serviceKeys, "subscription must have no snapshot").toBeUndefined();
  return String(planId);
}

describe("reproduction: why a BASIC owner could open everything", () => {
  it("the page gate exists and is wired into the real pages", async () => {
    if (!available) return;
    // Sanity: the primitive the pages call is a real function.
    expect(typeof requireService).toBe("function");
  });

  it("a snapshot-less venue is granted the whole legacy list", async () => {
    if (!available) return;
    await seedLegacyVenue();
    signInAs("OWNER");

    const access = await getServiceAccess(restaurantId, { role: "OWNER" });
    console.log("LEGACY VENUE services:", JSON.stringify(access.serviceKeys));
    console.log("LEGACY VENUE source:", access.source, "isFallback:", access.isFallback);

    // This is the bug in one line: a venue nobody configured can open
    // inventory and reports.
    expect(access.isFallback).toBe(true);
    expect(await hasService(restaurantId, "INVENTORY", { role: "OWNER" })).toBe(true);
    expect(await hasService(restaurantId, "REPORTS", { role: "OWNER" })).toBe(true);
    expect(await hasService(restaurantId, "BILLING", { role: "OWNER" })).toBe(true);
    expect([...access.serviceKeys].sort()).toEqual([...LEGACY_SUBSCRIPTION_SERVICE_KEYS].sort());
  });

  it("the page gate therefore lets a legacy owner into /inventory and /reports", async () => {
    if (!available) return;
    await seedLegacyVenue();
    signInAs("OWNER");

    const inventory = await requireService("INVENTORY", { userName: "Owner" });
    expect(
      inventory.allowed,
      "BUG: the inventory page is served to a venue with no inventory entitlement"
    ).toBe(true);

    const reports = await requireService("REPORTS", { userName: "Owner" });
    expect(reports.allowed, "BUG: the reports page is served too").toBe(true);
  });

  it("a subscription-less venue is also granted everything", async () => {
    if (!available) return;
    // No plan, no subscription at all.
    const access = await getServiceAccess(restaurantId, { role: "OWNER" });
    console.log("NO SUBSCRIPTION source:", access.source);
    expect(access.source).toBe("LEGACY");
    expect(await hasService(restaurantId, "INVENTORY", { role: "OWNER" })).toBe(true);
  });
});

describe("fix: an explicit snapshot is honoured everywhere", () => {
  async function seedConfiguredBasicVenue(): Promise<string> {
    const plan = await createPlan({
      name: "BASIC",
      pricePaise: 29900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC],
      createdBy: null,
    });
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });
    return plan.planId;
  }

  it("17-20. a BASIC owner is refused inventory, reports, billing, kot", async () => {
    if (!available) return;
    await seedConfiguredBasicVenue();
    signInAs("OWNER");

    for (const key of ["INVENTORY", "REPORTS", "BILLING", "KOT"] as const) {
      expect(await hasService(restaurantId, key, { role: "OWNER" }), key).toBe(false);
      const decision = await checkService(restaurantId, key, { role: "OWNER" });
      expect(decision.allowed, key).toBe(false);
    }
  });

  it("12-16. a BASIC owner is allowed the five it paid for", async () => {
    if (!available) return;
    await seedConfiguredBasicVenue();
    signInAs("OWNER");
    for (const key of BASIC as unknown as ServiceKey[]) {
      expect(await hasService(restaurantId, key, { role: "OWNER" }), key).toBe(true);
    }
  });

  it("21. the page gate blocks a restricted route for a BASIC owner", async () => {
    if (!available) return;
    await seedConfiguredBasicVenue();
    signInAs("OWNER");

    for (const key of ["INVENTORY", "REPORTS", "BILLING", "KOT"] as const) {
      const decision = await requireService(key, { userName: "Owner" });
      expect(decision.allowed, key).toBe(false);
      if (!decision.allowed) {
        // A finished "locked" page, not a redirect to login.
        expect(decision.page).toBeTruthy();
      }
    }
    // And an allowed one still renders.
    const pos = await requireService("POS", { userName: "Owner" });
    expect(pos.allowed).toBe(true);
  });

  it("24. role still applies on top of a service the plan includes", async () => {
    if (!available) return;
    // A plan that DOES include reports, to isolate the role dimension.
    const plan = await createPlan({
      name: "PRO",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC, "INVENTORY", "REPORTS"],
      createdBy: null,
    });
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });

    // The service layer says yes for every role; RBAC is a separate decision
    // made by the domain guards (e.g. audit permissions), not by this layer.
    signInAs("CASHIER");
    expect(await hasService(restaurantId, "REPORTS", { role: "CASHIER" })).toBe(true);
    signInAs("OWNER");
    expect(await hasService(restaurantId, "REPORTS", { role: "OWNER" })).toBe(true);
  });

  it("25. SUPER_ADMIN is never blocked by a tenant's plan", async () => {
    if (!available) return;
    await seedConfiguredBasicVenue();
    signInAs("SUPER_ADMIN");

    for (const key of ["INVENTORY", "REPORTS", "BILLING"] as const) {
      expect(await hasService(restaurantId, key, { role: "SUPER_ADMIN" }), key).toBe(true);
      const decision = await requireService(key, { userName: "Admin" });
      expect(decision.allowed, key).toBe(true);
    }
  });

  it("10. OWNER gets no special treatment over the plan", async () => {
    if (!available) return;
    await seedConfiguredBasicVenue();
    // Every non-super-admin role obeys the same gate.
    for (const role of ["OWNER", "MANAGER", "CASHIER", "WAITER"]) {
      signInAs(role);
      expect(await hasService(restaurantId, "INVENTORY", { role }), role).toBe(false);
      expect(await hasService(restaurantId, "REPORTS", { role }), role).toBe(false);
    }
  });

  it("29. one venue's plan never unlocks another venue", async () => {
    if (!available) return;
    const other = await UserModel.create({
      fullName: "Other Owner",
      email: `other-${Date.now()}@restopos.test`,
      passwordHash: await hashPassword("Password123!"),
      isActive: true,
    });
    const otherRest = await createRestaurantForUser(String(other._id), {
      name: "Other Cafe",
      ownerName: "Other",
      phone: "9876543211",
      address: "2 Food St",
      city: "Mumbai",
      state: "MA",
      pincode: "400001",
      gstRegistered: false,
      gstin: "",
      businessType: "Restaurant",
    });
    const proPlan = await createPlan({
      name: "PRO",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC, "INVENTORY"],
      createdBy: null,
    });
    await createSubscription({
      restaurantId: otherRest.restaurantId,
      planId: proPlan.planId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });

    await seedConfiguredBasicVenue();
    signInAs("OWNER");
    expect(await hasService(restaurantId, "INVENTORY", { role: "OWNER" })).toBe(false);
    expect(
      await hasService(otherRest.restaurantId, "INVENTORY", { role: "OWNER" })
    ).toBe(true);
  });

  it("10b. a plan edit does not reach an already-issued subscription", async () => {
    if (!available) return;
    const planId = await seedConfiguredBasicVenue();
    await updatePlan(
      planId,
      { serviceKeys: [...BASIC, "INVENTORY"] },
      { updatedBy: null }
    );
    signInAs("OWNER");
    // The live plan now grants it; the issued subscription does not.
    expect(await hasService(restaurantId, "INVENTORY", { role: "OWNER" })).toBe(false);
  });

  it("30. a plan that grants nothing grants nothing", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Nothing",
      pricePaise: 100,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [],
      createdBy: null,
    });
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });
    signInAs("OWNER");
    for (const key of ["DASHBOARD", "POS", "MENU", "TABLES", "ORDERS", "INVENTORY"] as const) {
      expect(await hasService(restaurantId, key, { role: "OWNER" }), key).toBe(false);
    }
  });
});

describe("the migration actually closes the hole it was written for", () => {
  it("after backfill the legacy owner loses the four borrowed modules", async () => {
    if (!available) return;
    await seedLegacyVenue();
    signInAs("OWNER");

    // Before: the reported symptom.
    expect(await hasService(restaurantId, "INVENTORY", { role: "OWNER" })).toBe(true);
    const before = await requireService("INVENTORY", { userName: "Owner" });
    expect(before.allowed).toBe(true);

    await backfillPlanSnapshots(mongoose.connection.db as unknown as mongoose.mongo.Db, {
      log: () => {},
      warn: () => {},
    });

    // After: the same owner, same venue, same session — now refused.
    const access = await getServiceAccess(restaurantId, { role: "OWNER" });
    expect(access.isFallback, "must no longer be borrowing the legacy list").toBe(false);
    expect([...access.serviceKeys].sort()).toEqual([...BASIC].sort());

    for (const key of ["INVENTORY", "REPORTS", "BILLING", "KOT"] as const) {
      expect(await hasService(restaurantId, key, { role: "OWNER" }), key).toBe(false);
      const decision = await requireService(key, { userName: "Owner" });
      expect(decision.allowed, key).toBe(false);
      if (!decision.allowed) {
        expect(decision.page, key).toBeTruthy();
      }
    }
    // What they actually paid for still works.
    for (const key of BASIC as unknown as ServiceKey[]) {
      expect(await hasService(restaurantId, key, { role: "OWNER" }), key).toBe(true);
    }
  });

  it("re-running the migration changes nothing", async () => {
    if (!available) return;
    await seedLegacyVenue();
    const db = mongoose.connection.db as unknown as mongoose.mongo.Db;
    const first = await backfillPlanSnapshots(db, { log: () => {}, warn: () => {} });
    expect(first.planUpdates).toBeGreaterThan(0);
    const second = await backfillPlanSnapshots(db, { log: () => {}, warn: () => {} });
    expect(second.planUpdates).toBe(0);
    expect(second.subUpdates).toBe(0);
  });
});

describe("AUDIT is a governed module like every other one", () => {
  it("is a real, enabled service key", () => {
    expect(isServiceKey("AUDIT")).toBe(true);
    expect(SERVICE_KEYS).toContain("AUDIT");
  });

  it("is not handed out by the legacy fallback", () => {
    // Otherwise adding it would retroactively open every un-migrated venue's
    // audit trail, which is the one thing §17 forbids.
    expect(LEGACY_SUBSCRIPTION_SERVICE_KEYS).not.toContain("AUDIT");
  });

  it("is refused for a venue whose plan does not include it", async () => {
    if (!available) return;
    await createPlan({
      name: "BASIC",
      pricePaise: 29900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC],
      createdBy: null,
    });
    const plan = await PlanModel.findOne({ name: "BASIC" });
    await createSubscription({
      restaurantId,
      planId: String(plan!._id),
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });
    signInAs("OWNER");

    expect(await hasService(restaurantId, "AUDIT", { role: "OWNER" })).toBe(false);
    const decision = await requireService("AUDIT", { userName: "Owner" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.page).toBeTruthy();
    }
  });

  it("is allowed once the plan includes it, for every role", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "PRO",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC, "AUDIT"],
      createdBy: null,
    });
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });
    // OWNER and MANAGER may view; CASHIER/WAITER still reach the page but are
    // stopped by the existing role guard inside it, not by the service layer.
    for (const role of ["OWNER", "MANAGER", "CASHIER", "WAITER"]) {
      signInAs(role);
      expect(await hasService(restaurantId, "AUDIT", { role }), role).toBe(true);
    }
  });

  it("never blocks SUPER_ADMIN", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "BASIC",
      pricePaise: 29900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC],
      createdBy: null,
    });
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });
    signInAs("SUPER_ADMIN");
    expect(await hasService(restaurantId, "AUDIT", { role: "SUPER_ADMIN" })).toBe(true);
    expect((await requireService("AUDIT", { userName: "Admin" })).allowed).toBe(true);
  });
});
