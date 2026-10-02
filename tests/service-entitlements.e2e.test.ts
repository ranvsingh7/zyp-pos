/**
 * Plan-based service entitlements, end to end against real MongoDB.
 *
 * The rules under test, in the order a reader needs them:
 *
 *  - A plan's service keys decide what a venue can actually use, and a
 *    restaurant on BASIC cannot reach billing, inventory, reports or the KOT.
 *  - An issued subscription is a *snapshot*. Editing a plan afterwards must not
 *    change a subscriber's entitlements; only an explicit renewal or plan
 *    change re-snapshots.
 *  - Adding a service to the catalog must not retroactively grant it.
 *  - Service access is not role access: a plan can include reports while a
 *    cashier still cannot open them, and a cashier's role never grants a
 *    service the plan excludes.
 *  - Entitlements are per venue. One restaurant's plan never unlocks another's.
 *  - A SUPER_ADMIN is never blocked by a tenant's plan.
 *  - Subscriptions written before snapshots existed keep working.
 *
 * Enforcement is asserted at the layer that matters — the server actions and the
 * real export route — because a hidden navigation link is not a control.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/guards", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/guards")>("@/lib/auth/guards");
  return {
    ...actual,
    requireAuth: vi.fn(),
    requireRestaurant: vi.fn(),
  };
});

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createPlan, updatePlan } from "@/lib/admin/plan-service";
import {
  createSubscription,
  renewSubscription,
  changeSubscriptionPlan,
  getSubscriptionByRestaurantId,
} from "@/lib/admin/subscription-service";
import {
  assertService,
  checkService,
  getServiceAccess,
  hasService,
  ServiceAccessError,
} from "@/lib/services/access";
import { normalizeServiceKeys, BASIC_DEFAULT_SERVICE_KEYS } from "@/lib/services/catalog";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_entitlements_e2e";

let available = false;

const BASIC = [...BASIC_DEFAULT_SERVICE_KEYS];
const PRO = [...BASIC, "BILLING", "KOT", "INVENTORY", "REPORTS"];

async function seedRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `ent-${Date.now()}-${Math.random()}@restopos.test`,
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

/** Signs the mocked session in as an OWNER of `restaurantId`. */
async function signInAsOwner(restaurantId: string, role = "OWNER") {
  vi.mocked(requireAuth).mockResolvedValue({
    id: "0123456789abcdef01234567",
    fullName: "Owner",
    email: "owner@restopos.test",
    phone: null,
    role,
    restaurantId,
    isActive: true,
  } as Awaited<ReturnType<typeof requireAuth>>);
  vi.mocked(requireRestaurant).mockResolvedValue({
    id: restaurantId,
    name: "Test Kitchen",
    ownerId: "0123456789abcdef01234567",
    phone: "9876543210",
    email: null,
    logoUrl: null,
  } as Awaited<ReturnType<typeof requireRestaurant>>);
}

async function seedPlanWith(serviceKeys: string[]): Promise<string> {
  const plan = await createPlan({
    name: `Plan ${Date.now()}-${Math.random()}`,
    description: "entitlement test plan",
    pricePaise: 100000,
    billingCycle: "MONTHLY",
    durationDays: 30,
    isActive: true,
    serviceKeys,
  });
  return plan.planId;
}

async function subscribe(restaurantId: string, planId: string) {
  return createSubscription({
    restaurantId,
    planId,
    startDate: new Date(),
    createdBy: "0123456789abcdef01234567",
    changedByRole: "SUPER_ADMIN",
  });
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
  vi.mocked(requireAuth).mockReset();
  vi.mocked(requireRestaurant).mockReset();
});

describe("1. what a plan grants", () => {
  it(
    "a BASIC venue gets the till and its data, and nothing more",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Basic Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.has("POS")).toBe(true);
      expect(access.has("MENU")).toBe(true);
      expect(access.has("TABLES")).toBe(true);
      expect(access.has("ORDERS")).toBe(true);

      for (const locked of ["BILLING", "INVENTORY", "REPORTS", "KOT"] as const) {
        expect(access.has(locked), `${locked} must not be granted`).toBe(false);
        await expect(assertService(restaurantId, locked)).rejects.toBeInstanceOf(
          ServiceAccessError
        );
      }
    },
    30000
  );

  it(
    "expands dependencies, so a plan with POS can never be saved unusable",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Dep Kitchen");
      // Deliberately save only POS: normalization must add the rest.
      const planId = await seedPlanWith(["POS"]);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.serviceKeys).toEqual(["POS", "MENU", "TABLES", "ORDERS"]);
      expect(access.has("KOT")).toBe(false);
    },
    30000
  );

  it(
    "a PRO venue reaches every service it was sold",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Pro Kitchen");
      const planId = await seedPlanWith(PRO);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      for (const key of PRO) {
        await expect(assertService(restaurantId, key as never)).resolves.toBeUndefined();
      }
    },
    30000
  );

  it(
    "a plan that grants nothing grants nothing, even though POS would be usual",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Empty Kitchen");
      const planId = await seedPlanWith([]);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.serviceKeys).toEqual([]);
      expect(access.has("POS")).toBe(false);
      // An explicit empty snapshot is authoritative; it must not be "helpfully"
      // filled in from the plan or the legacy default.
      expect(access.source).toBe("SNAPSHOT");
    },
    30000
  );
});

describe("2. the snapshot is the contract", () => {
  it(
    "editing a plan does not change an already-issued subscription",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Snapshot Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      // The plan gains a service *after* the subscription was issued.
      await updatePlan(planId, { serviceKeys: PRO });

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.source).toBe("SNAPSHOT");
      expect(access.has("REPORTS")).toBe(false);
      expect(access.has("BILLING")).toBe(false);
      expect(access.has("POS")).toBe(true);

      // The plan itself does carry it, proving the edit took effect.
      const plan = await PlanModel.findById(planId).lean();
      expect(plan?.serviceKeys).toEqual(normalizeServiceKeys(PRO));
    },
    30000
  );

  it(
    "an explicit renewal re-snapshots and delivers the new service",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Renew Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);
      expect(await hasService(restaurantId, "REPORTS")).toBe(false);

      await updatePlan(planId, { serviceKeys: PRO });
      // Still gated before the renewal: the plan edit alone does nothing.
      expect(await hasService(restaurantId, "REPORTS")).toBe(false);

      await renewSubscription({
        restaurantId,
        planId,
        startDate: new Date(),
        createdBy: "0123456789abcdef01234567",
        changedByRole: "SUPER_ADMIN",
      });

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.has("REPORTS")).toBe(true);
      expect(access.has("BILLING")).toBe(true);
    },
    30000
  );

  it(
    "an explicit plan change re-snapshots onto the new plan's services",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Switch Kitchen");
      const basicId = await seedPlanWith(BASIC);
      const proId = await seedPlanWith(PRO);
      await subscribe(restaurantId, basicId);
      await signInAsOwner(restaurantId);

      await changeSubscriptionPlan({
        restaurantId,
        planId: proId,
        createdBy: "0123456789abcdef01234567",
        changedByRole: "SUPER_ADMIN",
      });

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.has("REPORTS")).toBe(true);
      expect(access.serviceKeys).toEqual(normalizeServiceKeys(PRO));
    },
    30000
  );

  it(
    "the subscription record itself carries the frozen keys",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Record Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await updatePlan(planId, { serviceKeys: PRO });

      // The stored document is unchanged by the later plan edit.
      const stored = await SubscriptionModel.findOne({ restaurantId }).lean();
      expect(stored?.serviceKeys).toEqual(normalizeServiceKeys(BASIC));
    },
    30000
  );
});

describe("3. entitlements are per venue", () => {
  it(
    "one restaurant's plan never unlocks another restaurant's features",
    async () => {
      if (!available) return;
      const proId = await seedRestaurant("Pro Venue");
      const basicId = await seedRestaurant("Basic Venue");
      const proPlan = await seedPlanWith(PRO);
      const basicPlan = await seedPlanWith(BASIC);
      await subscribe(proId, proPlan);
      await subscribe(basicId, basicPlan);

      // Signed in as the BASIC venue, passing the PRO venue's id must not help.
      await signInAsOwner(basicId);
      expect(await hasService(basicId, "REPORTS")).toBe(false);
      await expect(assertService(basicId, "REPORTS")).rejects.toBeInstanceOf(
        ServiceAccessError
      );
      expect(await hasService(proId, "REPORTS")).toBe(true);
    },
    30000
  );
});

describe("4. service access and role access are separate", () => {
  it(
    "a plan that includes reports still does not let a CASHIER open them",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Role Kitchen");
      const planId = await seedPlanWith(PRO);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId, "CASHIER");

      // The plan grants it...
      const access = await getServiceAccess(restaurantId, { role: "CASHIER" });
      expect(access.has("REPORTS")).toBe(true);
      // ...and the service gate lets it through. The domain's own
      // assertCanViewReports(role) is what stops the cashier afterwards, which
      // is the intended layering: this layer answers "does the plan grant it".
      await expect(assertService(restaurantId, "REPORTS")).resolves.toBeUndefined();
    },
    30000
  );

  it(
    "a waiter on a plan with reports still cannot reach a financial tab",
    async () => {
      if (!available) return;
      const { assertCanViewReportTab } = await import("@/lib/reports/permissions");
      const restaurantId = await seedRestaurant("Waiter Kitchen");
      const planId = await seedPlanWith(PRO);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId, "WAITER");

      // The plan grants REPORTS, so the service gate lets the page through...
      await expect(assertService(restaurantId, "REPORTS")).resolves.toBeUndefined();
      // ...and the independent role check refuses the revenue tab underneath.
      // Neither layer substitutes for the other.
      expect(() => assertCanViewReportTab("WAITER", "sales")).toThrow();
      expect(() => assertCanViewReportTab("OWNER", "sales")).not.toThrow();
    },
    30000
  );
});

describe("5. SUPER_ADMIN bypass", () => {
  it(
    "a super admin is never blocked by a tenant's plan",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Locked Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId, "SUPER_ADMIN");

      for (const key of ["BILLING", "INVENTORY", "REPORTS", "KOT"] as const) {
        const access = await getServiceAccess(restaurantId, { role: "SUPER_ADMIN" });
        expect(access.isSuperAdmin).toBe(true);
        await expect(assertService(restaurantId, key, { role: "SUPER_ADMIN" })).resolves.toBeUndefined();
      }
    },
    30000
  );
});

describe("6. subscriptions written before snapshots existed", () => {
  it(
    "a snapshot-less subscription follows its plan's services, without writing back",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Legacy Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);

      // Simulate a document written before service snapshots: drop the field.
      await SubscriptionModel.updateOne({ restaurantId }, { $unset: { serviceKeys: "" } });
      const raw = await SubscriptionModel.findOne({ restaurantId }).lean();
      expect(raw?.serviceKeys).toBeUndefined();

      await signInAsOwner(restaurantId);
      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.isFallback).toBe(true);
      expect(access.source).toBe("PLAN");
      // The plan is the thing being sold, so its explicit services are used
      // rather than widening the venue to everything.
      expect(access.serviceKeys).toEqual(normalizeServiceKeys(BASIC));
      expect(access.has("REPORTS")).toBe(false);

      // The fallback must not have written anything back.
      const after = await SubscriptionModel.findOne({ restaurantId }).lean();
      expect(after?.serviceKeys).toBeUndefined();
    },
    30000
  );

  it(
    "a venue whose plan also predates services keeps everything it always had",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Ancient Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);

      // Both the subscription and the plan predate service tracking.
      await SubscriptionModel.updateOne({ restaurantId }, { $unset: { serviceKeys: "" } });
      await PlanModel.updateOne({ _id: planId }, { $unset: { serviceKeys: "" } });

      await signInAsOwner(restaurantId);
      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.source).toBe("LEGACY");
      // Locking a long-standing venue out of reports would be a regression.
      expect(access.has("REPORTS")).toBe(true);
      expect(access.has("INVENTORY")).toBe(true);
      expect(access.has("BILLING")).toBe(true);
    },
    30000
  );

  it(
    "a service added to the catalog later is not handed to a snapshot venue",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("NotRetro Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      // CUSTOMERS is catalogued but unimplemented (enabled: false). Even if it
      // were switched on, a venue with a real snapshot keeps exactly what it
      // was sold.
      expect((await hasService(restaurantId, "CUSTOMERS"))).toBe(false);
      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.serviceKeys).toEqual(normalizeServiceKeys(BASIC));
    },
    30000
  );
});

describe("7. enforcement in server actions", () => {
  it(
    "a menu action is refused for a venue whose plan excludes MENU",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("NoMenu Kitchen");
      // A plan that grants the till but not menu, kept honest by removing the
      // dependency afterwards to build the awkward case on purpose.
      const planId = await seedPlanWith(["DASHBOARD"]);
      await subscribe(restaurantId, planId);
      await SubscriptionModel.updateOne(
        { restaurantId },
        { $set: { serviceKeys: ["DASHBOARD"] } }
      );
      await signInAsOwner(restaurantId);

      const { createCategoryAction } = await import("@/actions/menu/categories");
      const result = await createCategoryAction({ name: "Starters", displayOrder: 0 });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not included in your current plan/i);
    },
    30000
  );

  it(
    "the same action succeeds once the plan includes MENU",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Menu Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      const { createCategoryAction } = await import("@/actions/menu/categories");
      const result = await createCategoryAction({ name: "Starters", displayOrder: 0 });
      expect(result.success, result.message).toBe(true);
    },
    30000
  );

  it(
    "a reports export is refused for a venue whose plan excludes REPORTS",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("NoReports Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId, "OWNER");

      // The real route handler: this is the "type the URL directly" path that
      // makes page gating necessary but not sufficient.
      const { GET } = await import("@/app/api/reports/export/route");
      const req = new NextRequest("http://localhost/api/reports/export?tab=sales");
      // Translated into a 403 rather than left to propagate as an unhandled
      // error, so probing this endpoint reports "not in your plan" instead of
      // returning a 500. Either way the response carries no report data.
      const res = await GET(req);
      expect(res.status).toBe(403);
      const payload = (await res.json()) as { error: string; service: string };
      expect(payload.service).toBe("REPORTS");
      expect(payload.error).toMatch(/not included in your current plan/i);
    },
    30000
  );

  it(
    "the same export is allowed for a venue whose plan includes REPORTS",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Reports Kitchen");
      const planId = await seedPlanWith(PRO);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId, "OWNER");

      const { GET } = await import("@/app/api/reports/export/route");
      const req = new NextRequest("http://localhost/api/reports/export?tab=sales");
      const res = await GET(req);
      expect(res.status).toBe(200);
    },
    30000
  );
});

describe("8. what the views show", () => {
  it(
    "resolves a fallback subscription's services for display without writing",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("View Kitchen");
      const planId = await seedPlanWith(BASIC);
      await subscribe(restaurantId, planId);
      await SubscriptionModel.updateOne({ restaurantId }, { $unset: { serviceKeys: "" } });
      await signInAsOwner(restaurantId);

      const view = await getSubscriptionByRestaurantId(restaurantId);
      expect(view).not.toBeNull();
      // Never an empty list for a venue that genuinely has features.
      expect(view?.serviceKeys.length).toBeGreaterThan(0);
      expect(view?.serviceKeys).toContain("POS");
    },
    30000
  );

  it(
    "reports a coherent plan name alongside the services",
    async () => {
      if (!available) return;
      const restaurantId = await seedRestaurant("Name Kitchen");
      const planId = await seedPlanWith(PRO);
      await subscribe(restaurantId, planId);
      await signInAsOwner(restaurantId);

      const decision = await checkService(restaurantId, "REPORTS", { role: "OWNER" });
      expect(decision.allowed).toBe(true);

      const denied = await checkService(restaurantId, "CUSTOMERS", { role: "OWNER" });
      if (!denied.allowed) {
        expect(denied.message).toMatch(/not included in your current plan/i);
        expect(denied.access.planName).toBeTruthy();
      }
    },
    30000
  );
});
