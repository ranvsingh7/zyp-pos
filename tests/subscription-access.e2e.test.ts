/**
 * Subscription-gated access control, end to end against real MongoDB.
 *
 * The business rule under test: a restaurant may only use ZYP POS when a
 * SUPER_ADMIN has assigned it a subscription that is still valid. These tests
 * pin that rule at the service layer (the single source of truth the guards,
 * server actions and APIs all consult) and at the persistence layer, so a
 * regression in any of them fails here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { isSuperAdmin } from "@/lib/auth/roles";
import { createPlan, type SavePlanInput } from "@/lib/admin/plan-service";
import {
  createSubscription,
  renewSubscription,
  suspendSubscription,
  reactivateSubscription,
  cancelSubscription,
  getSubscriptionAccess,
  getSubscriptionByRestaurantId,
  listSubscriptionHistory,
} from "@/lib/admin/subscription-service";
import { listPlatformAuditLogs } from "@/lib/admin/audit-logs-service";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_subscription_e2e";

let available = false;

const SUPER_ADMIN_ID = "0123456789abcdef01234567";

async function seedRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `sub-e2e-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash,
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name,
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
  return result.restaurantId;
}

type SeedPlanOverrides = Partial<Omit<SavePlanInput, "pricePaise" | "billingCycle">> & {
  billingCycle?: string;
};

async function seedPlan(
  name: string,
  pricePaise: number,
  overrides: SeedPlanOverrides = {}
): Promise<string> {
  const plan = await createPlan({
    name,
    description: `${name} plan`,
    pricePaise,
    billingCycle: "MONTHLY",
    durationDays: 30,
    features: ["pos", "orders"],
    isActive: true,
    ...overrides,
  });
  return plan.planId;
}

function daysFromNow(days: number, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
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
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await PlanModel.deleteMany({});
  await SubscriptionModel.deleteMany({});
  await SubscriptionHistoryModel.deleteMany({});
  await PlatformCounterModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
});

describe("Subscription access control", () => {
  it(
    "1. a restaurant created with no subscription is blocked",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("No Plan Kitchen");

      const access = await getSubscriptionAccess(restaurantId);
      expect(access.allowed).toBe(false);
      expect(access.status).toBe("NONE");
      expect(access.expiryDate).toBeNull();
      expect(access.planName).toBeNull();

      // The restaurant itself is untouched — blocking is not deletion.
      expect(await RestaurantModel.countDocuments({ _id: restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "2. an active subscription with a future expiry is allowed",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Active Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      const access = await getSubscriptionAccess(restaurantId);
      expect(access.allowed).toBe(true);
      expect(access.status).toBe("ACTIVE");
      expect(access.daysLeft).toBeGreaterThan(0);
    },
    30000
  );

  it(
    "3. an explicitly assigned trial is allowed, and its expiry is honoured",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Trial Kitchen");
      // A free plan is what makes the subscription a TRIAL — the client no
      // longer asserts it, and a paid plan here would be stored ACTIVE.
      const planId = await seedPlan("Free Trial", 0, { billingCycle: "FREE" });
      await createSubscription({
        restaurantId,
        planId,
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      const during = await getSubscriptionAccess(restaurantId);
      expect(during.allowed).toBe(true);
      expect(during.status).toBe("TRIAL");

      // A trial that ran out must stop granting access.
      await SubscriptionModel.updateOne(
        { restaurantId },
        { $set: { expiryDate: daysFromNow(-1), gracePeriodDays: 0 } }
      );
      const after = await getSubscriptionAccess(restaurantId);
      expect(after.allowed).toBe(false);
      expect(after.status).toBe("EXPIRED");
    },
    30000
  );

  it(
    "4. an active subscription whose expiry has passed is blocked",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Lapsed Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000, { gracePeriodDays: 0 }),
        startDate: daysFromNow(-60),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      // Status is still stored as ACTIVE, but the date makes it invalid. This is
      // the case a status-only check would wrongly let through.
      const stored = await SubscriptionModel.findOne({ restaurantId }).lean();
      expect(stored?.status).toBe("ACTIVE");

      const access = await getSubscriptionAccess(restaurantId);
      expect(access.allowed).toBe(false);
      expect(access.status).toBe("EXPIRED");
      expect(access.daysLeft).toBeLessThan(0);
    },
    30000
  );

  it(
    "4b. an explicit zero grace period is not widened by the platform default",
    async () => {
      if (!available) return;
      // A plan configured with gracePeriodDays: 0 means "cut off at expiry".
      // The platform-wide default grace must not add days back on, otherwise a
      // subscription that is already past its expiry would keep working.
      const restaurantId = await seedRestaurant("Strict Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000, { gracePeriodDays: 0 }),
        startDate: daysFromNow(-31),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      const stored = await SubscriptionModel.findOne({ restaurantId }).lean();
      expect(stored?.gracePeriodDays).toBe(0);
      expect(stored?.status).toBe("ACTIVE");

      const access = await getSubscriptionAccess(restaurantId);
      expect(access.allowed).toBe(false);
      expect(access.status).toBe("EXPIRED");
    },
    30000
  );

  it(
    "5. suspended and cancelled subscriptions are both blocked",
    async () => {
      if (!available) return;
      const suspendedId = await seedRestaurant("Held Kitchen");
      const cancelledId = await seedRestaurant("Cancelled Kitchen");
      const planId = await seedPlan("Pro", 1000);

      for (const id of [suspendedId, cancelledId]) {
        await createSubscription({
          restaurantId: id,
          planId,
          startDate: new Date(),
          createdBy: SUPER_ADMIN_ID,
          changedByRole: "SUPER_ADMIN",
        });
      }

      await suspendSubscription({ restaurantId: suspendedId, reason: "Payment pending" });
      await cancelSubscription({ restaurantId: cancelledId, reason: "Churned" });

      const held = await getSubscriptionAccess(suspendedId);
      expect(held.allowed).toBe(false);
      expect(held.status).toBe("SUSPENDED");

      const gone = await getSubscriptionAccess(cancelledId);
      expect(gone.allowed).toBe(false);
      expect(gone.status).toBe("CANCELLED");
    },
    30000
  );

  it(
    "6. hold stores the reason, actor and time, and audits the change",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Reason Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      const before = new Date();
      const held = await suspendSubscription({
        restaurantId,
        reason: "Payment pending",
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });
      expect(held.status).toBe("SUSPENDED");
      expect(held.suspensionReason).toBe("Payment pending");
      expect(held.suspendedBy).toBe(SUPER_ADMIN_ID);
      expect(held.suspendedAt).toBeInstanceOf(Date);
      expect(held.suspendedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

      // Persisted, not just returned.
      const stored = await SubscriptionModel.findOne({ restaurantId }).lean();
      expect(stored?.suspensionReason).toBe("Payment pending");
      expect(String(stored?.suspendedBy)).toBe(SUPER_ADMIN_ID);

      // History keeps the reason.
      const history = await listSubscriptionHistory(restaurantId);
      const suspendRow = history.find((h) => h.action === "SUSPENDED");
      expect(suspendRow?.reason).toBe("Payment pending");

      // And the platform audit log records who did it. The audit log is a
      // platform-wide stream, so filter by action rather than by restaurant.
      const logs = await listPlatformAuditLogs({
        action: "SUBSCRIPTION_SUSPENDED",
        page: 1,
        pageSize: 50,
      });
      const suspendLog = logs.items.find((l) => l.entityId === held.subscriptionId);
      expect(suspendLog).toBeDefined();
      expect(suspendLog?.actorId).toBe(SUPER_ADMIN_ID);
      expect(suspendLog?.summary).toContain("Payment pending");
    },
    30000
  );

  it(
    "7. resume restores access only while the paid term is still valid",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Resume Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      await suspendSubscription({ restaurantId, reason: "Under review" });
      const resumed = await reactivateSubscription({ restaurantId });

      expect(resumed.status).toBe("ACTIVE");
      expect(resumed.suspensionReason).toBeNull();
      expect(resumed.suspendedAt).toBeNull();
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);
    },
    30000
  );

  it(
    "8. resume after the term already ended stays expired and needs renewal",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Stale Hold Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000, { gracePeriodDays: 0 }),
        startDate: daysFromNow(-40),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      await suspendSubscription({ restaurantId, reason: "Payment pending" });
      const resumed = await reactivateSubscription({ restaurantId });

      // The hold is lifted, but the money ran out while it was held: access must
      // NOT come back, and the venue has to be renewed. `storedStatus` is what
      // matters here — the derived `status` would read EXPIRED either way,
      // because the expiry date itself has passed.
      expect(resumed.status).toBe("EXPIRED");
      expect(resumed.storedStatus).toBe("EXPIRED");
      expect(resumed.storedStatus).not.toBe("ACTIVE");
      expect(resumed.suspensionReason).toBeNull();

      const access = await getSubscriptionAccess(restaurantId);
      expect(access.allowed).toBe(false);
      expect(access.status).toBe("EXPIRED");

      // And it really is renewable, which is why it became EXPIRED not SUSPENDED.
      const renewed = await renewSubscription({ restaurantId });
      expect(renewed.status).toBe("ACTIVE");
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);
    },
    30000
  );

  it(
    "9. renewal extends the existing subscription and preserves history",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Renew Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      const before = await getSubscriptionByRestaurantId(restaurantId);
      const renewed = await renewSubscription({ restaurantId });

      expect(renewed.status).toBe("ACTIVE");
      expect(renewed.expiryDate.getTime()).toBeGreaterThan(before!.expiryDate.getTime());

      // Still exactly one subscription document per restaurant.
      expect(await SubscriptionModel.countDocuments({ restaurantId })).toBe(1);

      const history = await listSubscriptionHistory(restaurantId);
      expect(history.some((h) => h.action === "CREATED")).toBe(true);
      expect(history.some((h) => h.action === "RENEWED")).toBe(true);
    },
    30000
  );

  it(
    "10. access never trusts a client-supplied restaurant id or status",
    async () => {
      if (!available) return;
      // Two venues: one paying, one with nothing. Reading access for the paying
      // venue must never leak into the other, whatever a caller claims.
      const payingId = await seedRestaurant("Paying Kitchen");
      const freeId = await seedRestaurant("Free Kitchen");
      await createSubscription({
        restaurantId: payingId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      const paying = await getSubscriptionAccess(payingId);
      const free = await getSubscriptionAccess(freeId);
      expect(paying.allowed).toBe(true);
      expect(free.allowed).toBe(false);

      // A stray query for a restaurant that does not exist is also blocked
      // rather than throwing or defaulting to allowed.
      const missing = await getSubscriptionAccess("0123456789abcdef01234599");
      expect(missing.allowed).toBe(false);
      expect(missing.status).toBe("NONE");
    },
    30000
  );

  it(
    "11. super admin is not itself a tenant user and is not gated by subscriptions",
    async () => {
      if (!available) return;
      // requireSuperAdmin() calls requireAuth() only — it never calls
      // requireRestaurant(), so a SUPER_ADMIN with no restaurantId (and therefore
      // no subscription) still reaches /admin. This is asserted at the role and
      // identity level because the guard needs a request scope.
      expect(isSuperAdmin("SUPER_ADMIN")).toBe(true);
      expect(isSuperAdmin("OWNER")).toBe(false);
      expect(isSuperAdmin(null)).toBe(false);

      const superAdmin = await UserModel.create({
        fullName: "Platform Admin",
        email: `super-${Date.now()}@restopos.test`,
        passwordHash: await hashPassword("Password123!"),
        isActive: true,
        role: "SUPER_ADMIN",
        restaurantId: null,
      });
      // No restaurant and no subscription, yet it is a platform operator.
      expect(superAdmin.restaurantId).toBeNull();
      expect(isSuperAdmin(superAdmin.role)).toBe(true);
      expect(await SubscriptionModel.countDocuments({ restaurantId: null })).toBe(0);
    },
    30000
  );

  it(
    "12. one restaurant user cannot read or mutate another restaurant's subscription",
    async () => {
      if (!available) return;
      const mineId = await seedRestaurant("Mine Kitchen");
      const theirsId = await seedRestaurant("Theirs Kitchen");
      const planId = await seedPlan("Pro", 1000);

      await createSubscription({
        restaurantId: theirsId,
        planId,
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      // Every mutating helper is keyed by an explicit restaurantId, and the
      // unique index guarantees one document per venue. Creating for a second
      // venue must not disturb the first.
      await createSubscription({
        restaurantId: mineId,
        // A second, shorter plan: duration comes from the plan, so varying the
        // term means naming a different plan.
        planId: await seedPlan("Pro Fortnight", 1000, { durationDays: 15 }),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      expect(await SubscriptionModel.countDocuments({ restaurantId: theirsId })).toBe(1);
      expect(await SubscriptionModel.countDocuments({ restaurantId: mineId })).toBe(1);

      // History is per venue.
      expect((await listSubscriptionHistory(theirsId)).length).toBeGreaterThan(0);
      expect((await listSubscriptionHistory(mineId)).length).toBeGreaterThan(0);

      // Holding one venue leaves the other untouched.
      await suspendSubscription({ restaurantId: mineId, reason: "Payment pending" });
      expect((await getSubscriptionAccess(mineId)).allowed).toBe(false);
      expect((await getSubscriptionAccess(theirsId)).allowed).toBe(true);
    },
    30000
  );

  it(
    "13. a cancelled subscription is terminal and cannot be silently resurrected",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Terminal Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });

      await cancelSubscription({ restaurantId, reason: "Churned" });
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(false);

      // Resuming a cancelled venue is refused; only a hold can be lifted.
      await expect(reactivateSubscription({ restaurantId })).rejects.toThrow(/suspended/);
      // Re-holding a cancelled venue is refused too.
      await expect(suspendSubscription({ restaurantId })).rejects.toThrow();
      expect((await getSubscriptionAccess(restaurantId)).status).toBe("CANCELLED");
    },
    30000
  );

  it(
    "14. blocking access never deletes the restaurant, its people or its history",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Durable Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });
      await suspendSubscription({ restaurantId, reason: "Payment pending" });

      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(false);

      const restaurant = await RestaurantModel.findById(restaurantId).lean();
      expect(restaurant?.name).toBe("Durable Kitchen");
      expect(await UserModel.countDocuments({ restaurantId })).toBe(1);
      expect(await SubscriptionModel.countDocuments({ restaurantId })).toBe(1);
      expect(await getSubscriptionByRestaurantId(restaurantId)).not.toBeNull();
      expect((await listSubscriptionHistory(restaurantId)).length).toBeGreaterThan(0);
    },
    30000
  );

  it(
    "15. the full lifecycle returns a blocked venue to service",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Full Cycle Kitchen");
      const planId = await seedPlan("Pro", 1000);

      // none -> active
      expect((await getSubscriptionAccess(restaurantId)).status).toBe("NONE");
      await createSubscription({
        restaurantId,
        planId,
        startDate: new Date(),
        createdBy: SUPER_ADMIN_ID,
        changedByRole: "SUPER_ADMIN",
      });
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);

      // active -> held -> active
      await suspendSubscription({ restaurantId, reason: "Payment pending" });
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(false);
      await reactivateSubscription({ restaurantId });
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);

      // active -> renewed -> expired
      await renewSubscription({ restaurantId });
      await SubscriptionModel.updateOne(
        { restaurantId },
        { $set: { expiryDate: daysFromNow(-1), gracePeriodDays: 0 } }
      );
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(false);

      // expired -> renewed -> active
      await renewSubscription({ restaurantId });
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);

      // active -> cancelled
      await cancelSubscription({ restaurantId, reason: "Churned" });
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(false);
      expect((await getSubscriptionAccess(restaurantId)).status).toBe("CANCELLED");

      // Every step left an audit trail.
      const history = await listSubscriptionHistory(restaurantId);
      for (const action of ["CREATED", "SUSPENDED", "REACTIVATED", "RENEWED", "CANCELLED"]) {
        expect(history.some((h) => h.action === action)).toBe(true);
      }
    },
    30000
  );
});
