import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionPaymentModel } from "@/models/SubscriptionPayment";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { isSuperAdmin } from "@/lib/auth/roles";
import { assertSuperAdmin } from "@/lib/admin/permissions";
import { AdminForbiddenError } from "@/lib/admin/errors";
import { createPlan, updatePlan, type SavePlanInput } from "@/lib/admin/plan-service";
import {
  createSubscription,
  renewSubscription,
  changeSubscriptionPlan,
  changeSubscriptionPricing,
  extendSubscriptionExpiry,
  suspendSubscription,
  reactivateSubscription,
  cancelSubscription,
  getSubscriptionAccess,
  getSubscriptionByRestaurantId,
  listSubscriptions,
  listSubscriptionHistory,
  deriveSubscriptionStatus,
  isBlockedStatus,
} from "@/lib/admin/subscription-service";
import { recordPayment, listPayments } from "@/lib/admin/payment-service";
import { nextSubscriptionInvoiceNumber, formatInvoiceNumber } from "@/lib/admin/invoice";
import { getDashboardData } from "@/lib/admin/dashboard-service";
import { logPlatformAudit } from "@/lib/admin/audit";
import { listPlatformAuditLogs } from "@/lib/admin/audit-logs-service";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_admin_e2e";

let available = false;

async function seedRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `admin-e2e-${Date.now()}-${Math.random()}@restopos.test`,
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

// `pricePaise`/`billingCycle` are re-narrowed here so an override cannot widen
// them back to `number | null` the way Partial<SavePlanInput> would.
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
  await SubscriptionPaymentModel.deleteMany({});
  await PlatformCounterModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
});

describe("Admin access control", () => {
  it("isSuperAdmin only accepts the SUPER_ADMIN role", () => {
    expect(isSuperAdmin("SUPER_ADMIN")).toBe(true);
    expect(isSuperAdmin("OWNER")).toBe(false);
    expect(isSuperAdmin("MANAGER")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });

  it("assertSuperAdmin rejects a tenant user with AdminForbiddenError", async () => {
    await expect(
      assertSuperAdmin({
        id: "0123456789abcdef01234567",
        fullName: "Owner",
        email: "owner@restopos.test",
        phone: null,
        role: "OWNER",
        restaurantId: "0123456789abcdef01234567",
        isActive: true,
      })
    ).rejects.toThrow(AdminForbiddenError);
  });
});

describe("Subscription lifecycle against real MongoDB", () => {
  it(
    "derives lifecycle statuses from stored state and dates",
    async () => {
      const now = new Date("2026-01-15T00:00:00.000Z");

      expect(
        deriveSubscriptionStatus({ storedStatus: "ACTIVE", expiryDate: daysFromNow(60, now), now })
      ).toBe("ACTIVE");
      // Trial with no expiry stays a trial.
      expect(
        deriveSubscriptionStatus({ storedStatus: "TRIAL", expiryDate: null, now })
      ).toBe("TRIAL");
      // Within the 7-day warning window.
      expect(
        deriveSubscriptionStatus({ storedStatus: "ACTIVE", expiryDate: daysFromNow(5, now), now })
      ).toBe("EXPIRING");
      // Past expiry but inside grace (settings grace defaults to 7 days).
      expect(
        deriveSubscriptionStatus({ storedStatus: "ACTIVE", expiryDate: daysFromNow(-1, now), now })
      ).toBe("GRACE_PERIOD");
      // Past grace period.
      expect(
        deriveSubscriptionStatus({ storedStatus: "ACTIVE", expiryDate: daysFromNow(-10, now), now })
      ).toBe("EXPIRED");
      // Manual terminal states are never auto-flipped.
      expect(
        deriveSubscriptionStatus({ storedStatus: "SUSPENDED", expiryDate: daysFromNow(60, now), now })
      ).toBe("SUSPENDED");
      expect(
        deriveSubscriptionStatus({ storedStatus: "CANCELLED", expiryDate: null, now })
      ).toBe("CANCELLED");

      expect(isBlockedStatus("EXPIRED")).toBe(true);
      expect(isBlockedStatus("SUSPENDED")).toBe(true);
      expect(isBlockedStatus("CANCELLED")).toBe(true);
      expect(isBlockedStatus("GRACE_PERIOD")).toBe(false);
      expect(isBlockedStatus("EXPIRING")).toBe(false);
    },
    30000
  );

  it(
    "creates a subscription, rejects duplicates, and supports one per restaurant",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Alpha Kitchen");
      const planId = await seedPlan("Pro", 1000);

      const created = await createSubscription({
        restaurantId,
        planId,
        startDate: new Date(),
        createdBy: "0123456789abcdef01234567",
        changedByRole: "SUPER_ADMIN",
      });
      expect(created.status).toBe("ACTIVE");
      expect(created.planId).toBe(planId);
      // Price and duration come from the plan, not from the caller.
      expect(created.finalPricePaise).toBe(1000);
      expect(created.durationDays).toBe(30);

      // A second subscription for the same restaurant is not allowed.
      await expect(
        createSubscription({
          restaurantId,
          planId,
          startDate: new Date(),
        })
      ).rejects.toThrow(/already has a subscription/);

      // Another restaurant can still take a fresh subscription. A free plan is
      // what makes a subscription a TRIAL, so this needs a genuinely free plan.
      const otherId = await seedRestaurant("Beta Kitchen");
      const other = await createSubscription({
        restaurantId: otherId,
        planId: await seedPlan("Free", 0, { billingCycle: "FREE" }),
        startDate: new Date(),
      });
      expect(other.status).toBe("TRIAL");
      expect(other.isFree).toBe(true);
      expect(other.finalPricePaise).toBe(0);
    },
    30000
  );

  it(
    "renews forward from the current expiry and records history",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Renewal Kitchen");
      const planId = await seedPlan("Pro", 1000);
      const start = daysFromNow(-10);
      await createSubscription({
        restaurantId,
        planId,
        startDate: start,
      });
      // Expiry is start + 30 => now + 20.
      const before = await getSubscriptionByRestaurantId(restaurantId);
      expect(before?.daysLeft).toBe(20);

      const renewed = await renewSubscription({
        restaurantId,
        createdBy: "0123456789abcdef01234567",
      });
      // Renewal extends from the *current* expiry, not from today.
      expect(renewed.daysLeft).toBe(50);

      const history = await listSubscriptionHistory(restaurantId);
      expect(history.map((h) => h.action)).toContain("RENEWED");
      expect(history.find((h) => h.action === "RENEWED")?.reason).toBeNull();
    },
    30000
  );

  it(
    "changes plan mid-period preserving expiry and re-anchoring price",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Switch Kitchen");
      const planA = await seedPlan("Basic", 1000);
      const planB = await seedPlan("Premium", 2500);

      await createSubscription({
        restaurantId,
        planId: planA,
        startDate: daysFromNow(-5),
      });
      const before = await getSubscriptionByRestaurantId(restaurantId);
      const switched = await changeSubscriptionPlan({
        restaurantId,
        planId: planB,
        reason: "Upgraded",
        createdBy: "0123456789abcdef01234567",
      });
      expect(switched.planId).toBe(planB);
      expect(switched.finalPricePaise).toBe(2500);
      // Expiry untouched.
      expect(switched.expiryDate.getTime()).toBe(before!.expiryDate.getTime());

      const history = await listSubscriptionHistory(restaurantId);
      const changed = history.find((h) => h.action === "PLAN_CHANGED");
      expect(changed?.reason).toBe("Upgraded");
      expect(changed?.toPlanName).toBe("Premium");
    },
    30000
  );

  it(
    "extends expiry by days or to an explicit date",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Extend Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
      });
      const before = await getSubscriptionByRestaurantId(restaurantId);
      const extended = await extendSubscriptionExpiry({ restaurantId, days: 15 });
      expect(extended.expiryDate.getTime()).toBe(
        daysFromNow(15, before!.expiryDate).getTime()
      );

      const toDate = daysFromNow(90);
      const explicit = await extendSubscriptionExpiry({ restaurantId, newExpiryDate: toDate });
      expect(explicit.expiryDate.getTime()).toBe(toDate.getTime());

      // Non-positive extensions rejected.
      await expect(extendSubscriptionExpiry({ restaurantId, days: 0 })).rejects.toThrow(
        /positive/
      );
    },
    30000
  );

  it(
    "suspends, reactivates and enforces guardrails on renewal while suspended",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Toggle Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Pro", 1000),
        startDate: new Date(),
      });

      const suspended = await suspendSubscription({
        restaurantId,
        reason: "Non-payment",
        createdBy: "0123456789abcdef01234567",
      });
      expect(suspended.status).toBe("SUSPENDED");
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(false);

      // Suspended subs cannot be renewed.
      await expect(
        renewSubscription({ restaurantId })
      ).rejects.toThrow(/Reactivate first/);

      const reactivated = await reactivateSubscription({ restaurantId });
      expect(reactivated.status).toBe("ACTIVE");
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);
    },
    30000
  );

  it(
    "makes cancellation terminal for further mutations",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Terminal Kitchen");
      const planA = await seedPlan("Basic", 1000);
      const planB = await seedPlan("Premium", 2500);
      await createSubscription({
        restaurantId,
        planId: planA,
        startDate: new Date(),
      });

      const cancelled = await cancelSubscription({ restaurantId, reason: "Closed shop" });
      expect(cancelled.status).toBe("CANCELLED");
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(false);

      await expect(
        changeSubscriptionPlan({ restaurantId, planId: planB })
      ).rejects.toThrow(/Cancelled/);
      await expect(extendSubscriptionExpiry({ restaurantId, days: 30 })).rejects.toThrow(
        /Cancelled/
      );
      // Cancelling an already-cancelled subscription is rejected.
      await expect(cancelSubscription({ restaurantId })).rejects.toThrow(/already cancelled/);
    },
    30000
  );

  it(
    "records payments with globally unique sequential invoice numbers",
    async () => {
      if (!available) return;
      const planId = await seedPlan("Pro", 1000);
      const rA = await seedRestaurant("Invoice A");
      const rB = await seedRestaurant("Invoice B");
      await createSubscription({ restaurantId: rA, planId, startDate: new Date() });
      await createSubscription({ restaurantId: rB, planId, startDate: new Date() });

      const subA = await getSubscriptionByRestaurantId(rA);
      const subB = await getSubscriptionByRestaurantId(rB);

      const first = await recordPayment({
        restaurantId: rA,
        subscriptionId: subA!.subscriptionId,
        amountPaise: 50000,
        paymentMethod: "UPI",
      });
      const second = await recordPayment({
        restaurantId: rB,
        subscriptionId: subB!.subscriptionId,
        amountPaise: 25000,
        paymentMethod: "CARD",
      });

      expect(first.invoiceNumber).toMatch(/^SUB-\d{6}$/);
      expect(second.invoiceNumber).toMatch(/^SUB-\d{6}$/);
      expect(first.invoiceNumber).not.toBe(second.invoiceNumber);

      // Rendered invoice bodies round-trip through formatInvoiceNumber.
      const seqOf = (invoice: string): number => Number(invoice.replace(/^SUB-0*/, ""));
      expect(formatInvoiceNumber(seqOf(first.invoiceNumber))).toBe(first.invoiceNumber);
      expect(seqOf(second.invoiceNumber)).toBeGreaterThan(seqOf(first.invoiceNumber));

      // The atomic counter keeps strict monotonicity.
      const third = await nextSubscriptionInvoiceNumber();
      expect(seqOf(third)).toBeGreaterThan(seqOf(second.invoiceNumber));
    },
    30000
  );

  it(
    "keeps payments tenant-scoped and rejects foreign subscription ids",
    async () => {
      if (!available) return;
      const planId = await seedPlan("Pro", 1000);
      const rA = await seedRestaurant("Scope A");
      const rB = await seedRestaurant("Scope B");
      await createSubscription({ restaurantId: rA, planId, startDate: new Date() });
      await createSubscription({ restaurantId: rB, planId, startDate: new Date() });

      const subA = await getSubscriptionByRestaurantId(rA);
      await recordPayment({
        restaurantId: rA,
        subscriptionId: subA!.subscriptionId,
        amountPaise: 10000,
        paymentMethod: "CASH",
      });

      const scopedA = await listPayments({ restaurantId: rA });
      expect(scopedA.total).toBe(1);
      const scopedB = await listPayments({ restaurantId: rB });
      expect(scopedB.total).toBe(0);

      // Recording a payment on another restaurant's subscription must fail.
      await expect(
        recordPayment({
          restaurantId: rB,
          subscriptionId: subA!.subscriptionId,
          amountPaise: 10000,
          paymentMethod: "CASH",
        })
      ).rejects.toThrow(/subscription/i);
    },
    30000
  );

  it(
    "aggregates dashboard metrics (MRR by plan, revenue, counts)",
    async () => {
      if (!available) return;
      const planId = await seedPlan("Pro", 12000);
      const rA = await seedRestaurant("Dash A");
      const rB = await seedRestaurant("Dash B");
      const subA = await createSubscription({
        restaurantId: rA,
        planId,
        startDate: daysFromNow(-20),
        // 12000 plan - 2000 discount = 10000
        discountAmountPaise: 2000,
      });
      const subB = await createSubscription({
        restaurantId: rB,
        planId,
        startDate: daysFromNow(-10),
        // 12000 plan - 7000 discount = 5000
        discountAmountPaise: 7000,
      });
      expect(subA.finalPricePaise).toBe(10000);
      expect(subB.finalPricePaise).toBe(5000);

      await recordPayment({
        restaurantId: rA,
        subscriptionId: subA.subscriptionId,
        amountPaise: 10000,
        paymentMethod: "UPI",
      });
      await recordPayment({
        restaurantId: rB,
        subscriptionId: subB.subscriptionId,
        amountPaise: 5000,
        paymentMethod: "CASH",
      });

      const data = await getDashboardData();
      expect(data.totals.restaurants).toBe(2);
      expect(data.totals.plans).toBe(1);
      expect(data.totals.activePlans).toBe(1);
      expect(data.subscriptionCounts.ACTIVE).toBe(2);
      // MRR is monthly-equivalent of non-blocked subscriptions.
      expect(data.mrrPaise).toBeGreaterThan(0);
      const byPlan = data.byPlan.find((p) => p.planName === "Pro");
      expect(byPlan?.count).toBe(2);
      expect(byPlan?.paidCount).toBe(2);
      expect(data.revenue.totalPaise).toBe(15000);
      expect(data.revenue.paymentCountThisMonth).toBe(2);
    },
    30000
  );

  it(
    "writes platform audit rows that are append-only",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Audit Kitchen");
      await logPlatformAudit({
        action: "SUBSCRIPTION_CREATED",
        restaurantId,
        actorId: "0123456789abcdef01234567",
        actorRole: "SUPER_ADMIN",
        entityType: "SUBSCRIPTION",
        entityId: "0123456789abcdef01234567",
        entityName: "Audit Kitchen",
        summary: "Created for audit test",
        metadata: { planId: "123" },
      });

      const rows = await listPlatformAuditLogs({});
      expect(rows.items.length).toBeGreaterThanOrEqual(1);
      const row = rows.items.find((r) => r.summary === "Created for audit test");
      expect(row?.entityName).toBe("Audit Kitchen");

      const doc = await TableAuditLogModel.findOne({ summary: "Created for audit test" });
      expect(doc).not.toBeNull();

      // Update/delete must be rejected at the model boundary.
      await expect(
        TableAuditLogModel.updateOne({ _id: doc!._id }, { $set: { summary: "tampered" } })
      ).rejects.toThrow(/append-only/);
      await expect(
        TableAuditLogModel.deleteOne({ _id: doc!._id })
      ).rejects.toThrow(/append-only/);
    },
    30000
  );

  it(
    "lists subscriptions with filters",
    async () => {
      if (!available) return;
      const planId = await seedPlan("Pro", 1000);
      const freePlanId = await seedPlan("Free", 0, { billingCycle: "FREE" });
      const activeRestaurant = await seedRestaurant("Filter Active");
      const trialRestaurant = await seedRestaurant("Filter Trial");
      await createSubscription({
        restaurantId: activeRestaurant,
        planId,
        startDate: new Date(),
      });
      await createSubscription({
        restaurantId: trialRestaurant,
        planId: freePlanId,
        startDate: new Date(),
      });

      const all = await listSubscriptions({ pageSize: 50 });
      expect(all.total).toBe(2);

      // Filtering by plan narrows to the venues actually on that plan.
      const byPaidPlan = await listSubscriptions({ planId, pageSize: 50 });
      expect(byPaidPlan.total).toBe(1);
      expect(byPaidPlan.items[0].restaurantName).toBe("Filter Active");

      const byFreePlan = await listSubscriptions({ planId: freePlanId, pageSize: 50 });
      expect(byFreePlan.total).toBe(1);
      expect(byFreePlan.items[0].restaurantName).toBe("Filter Trial");

      const bySearch = await listSubscriptions({ search: "Filter Trial", pageSize: 50 });
      expect(bySearch.items).toHaveLength(1);
      expect(bySearch.items[0].restaurantName).toBe("Filter Trial");
    },
    30000
  );

  it(
    "prices and dates a subscription from the plan, ignoring anything else the caller sends",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Tamper Kitchen");
      const planId = await seedPlan("Canonical", 50000, {
        durationDays: 45,
        gracePeriodDays: 5,
      });
      const start = daysFromNow(-1);

      // A caller that tries to dictate price, duration, grace and trial-ness
      // gets the plan's terms instead. The extra keys are not in the input
      // types, so this only compiles because it is deliberately cast.
      const created = await createSubscription({
        restaurantId,
        planId,
        startDate: start,
        discountAmountPaise: 5000,
        ...({
          finalPricePaise: 1,
          listPricePaise: 1,
          durationDays: 9999,
          gracePeriodDays: 9999,
          isTrial: true,
        } as Record<string, unknown>),
      });

      // Plan price minus the one discount the caller IS allowed.
      expect(created.listPricePaise).toBe(50000);
      expect(created.discountAmountPaise).toBe(5000);
      expect(created.finalPricePaise).toBe(45000);
      // Plan duration and grace, not the injected ones.
      expect(created.durationDays).toBe(45);
      expect(created.gracePeriodDays).toBe(5);
      // A paid plan cannot be smuggled in as a trial.
      expect(created.status).toBe("ACTIVE");
      expect(created.isFree).toBe(false);
      // Expiry is the plan duration after the start date (start + 45).
      expect(created.expiryDate.getTime()).toBe(daysFromNow(45, start).getTime());
      // Grace end is expiry + the plan's 5 grace days.
      expect(created.graceEndDate.getTime()).toBe(
        daysFromNow(50, start).getTime()
      );
    },
    30000
  );

  it(
    "a free plan is a TRIAL, costs nothing, and refuses a discount",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Free Kitchen");
      const planId = await seedPlan("Forever Free", 0, {
        billingCycle: "FREE",
        durationDays: 60,
        gracePeriodDays: 3,
      });
      const start = new Date();

      const created = await createSubscription({
        restaurantId,
        planId,
        startDate: start,
      });
      expect(created.isFree).toBe(true);
      expect(created.status).toBe("TRIAL");
      expect(created.billingCycle).toBe("FREE");
      expect(created.finalPricePaise).toBe(0);
      expect(created.durationDays).toBe(60);
      expect(created.expiryDate.getTime()).toBe(daysFromNow(60, start).getTime());
      // A free plan still grants access for its term.
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);

      // A discount on a free plan is meaningless and is rejected outright.
      await expect(
        createSubscription({
          restaurantId: await seedRestaurant("Free Kitchen 2"),
          planId,
          startDate: start,
          discountAmountPaise: 100,
        })
      ).rejects.toThrow(/free plan cannot carry a discount/i);

      // And it is never given a payment obligation.
      expect((await listPayments({ restaurantId })).total).toBe(0);
    },
    30000
  );

  it(
    "renewal re-reads the plan so a price edit applies, and re-anchors to the expiry",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Reprice Kitchen");
      const planId = await seedPlan("Adjustable", 10000, { durationDays: 30 });
      await createSubscription({
        restaurantId,
        planId,
        startDate: daysFromNow(-10),
      });
      const first = await getSubscriptionByRestaurantId(restaurantId);
      expect(first?.finalPricePaise).toBe(10000);
      expect(first?.daysLeft).toBe(20);

      // The plan price is raised after the first term was sold.
      await updatePlan(planId, { pricePaise: 18000, durationDays: 60 });

      // Renewal picks up the new price AND the new duration, continuing from
      // the current expiry rather than from today.
      const renewed = await renewSubscription({ restaurantId });
      expect(renewed.finalPricePaise).toBe(18000);
      expect(renewed.durationDays).toBe(60);
      // 20 days left on the old term + 60 on the new one.
      expect(renewed.daysLeft).toBe(80);
      expect(renewed.status).toBe("ACTIVE");
    },
    30000
  );

  it(
    "a plan change re-prices but never moves the current expiry",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Upgrade Kitchen");
      // Grace is pinned on each plan so the delta is unambiguous (a plan with
      // no explicit grace falls back to the platform default).
      const basicId = await seedPlan("Basic", 10000, {
        durationDays: 30,
        gracePeriodDays: 0,
      });
      const proId = await seedPlan("Pro", 25000, {
        durationDays: 365,
        gracePeriodDays: 14,
      });

      await createSubscription({
        restaurantId,
        planId: basicId,
        startDate: daysFromNow(-5),
      });
      const before = await getSubscriptionByRestaurantId(restaurantId);
      expect(before?.gracePeriodDays).toBe(0);

      const switched = await changeSubscriptionPlan({
        restaurantId,
        planId: proId,
      });
      expect(switched.planId).toBe(proId);
      expect(switched.planName).toBe("Pro");
      expect(switched.finalPricePaise).toBe(25000);
      // The remaining term is untouched: no free days added or taken away.
      expect(switched.expiryDate.getTime()).toBe(before!.expiryDate.getTime());
      // But the new plan's terms are snapshotted for the next renewal.
      expect(switched.durationDays).toBe(365);
      expect(switched.gracePeriodDays).toBe(14);

      // Upgrading a discount from the old plan does not carry over silently:
      // the new plan starts from its own full price.
      const discounted = await changeSubscriptionPlan({
        restaurantId,
        planId: await seedPlan("Pro Plus", 30000, { durationDays: 365 }),
        discountAmountPaise: 5000,
      });
      expect(discounted.finalPricePaise).toBe(25000);
    },
    30000
  );

  it(
    "editing pricing can only apply a discount, never override the plan price",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Discount Kitchen");
      await createSubscription({
        restaurantId,
        planId: await seedPlan("Priced", 40000, { durationDays: 30 }),
        startDate: new Date(),
      });

      // A caller posting a rogue list price and final price is ignored.
      const changed = await changeSubscriptionPricing({
        restaurantId,
        discountAmountPaise: 4000,
        ...({ listPricePaise: 1, finalPricePaise: 1 } as Record<string, unknown>),
      });
      expect(changed.listPricePaise).toBe(40000);
      expect(changed.discountAmountPaise).toBe(4000);
      expect(changed.finalPricePaise).toBe(36000);

      // A discount larger than the plan price is refused.
      await expect(
        changeSubscriptionPricing({ restaurantId, discountAmountPaise: 99999 })
      ).rejects.toThrow(/exceed the plan price/i);
    },
    30000
  );

  it(
    "refuses to subscribe with an inactive or non-existent plan",
    async () => {
      if (!available) return;
      const planId = await seedPlan("Retired", 5000, { isActive: false });
      await expect(
        createSubscription({
          restaurantId: await seedRestaurant("Retired Kitchen"),
          planId,
          startDate: new Date(),
        })
      ).rejects.toThrow(/inactive plan/i);

      await expect(
        createSubscription({
          restaurantId: await seedRestaurant("Ghost Kitchen"),
          planId: "0123456789abcdef01234567",
          startDate: new Date(),
        })
      ).rejects.toThrow(/plan not found/i);
    },
    30000
  );
});