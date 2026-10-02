import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import {
  createPlan,
  updatePlan,
  setPlanActive,
} from "@/lib/admin/plan-service";
import {
  createSubscription,
  renewSubscription,
  changeSubscriptionPlan,
  suspendSubscription,
  reactivateSubscription,
} from "@/lib/admin/subscription-service";
import { SERVICE_KEYS, normalizeServiceKeys } from "@/lib/services/catalog";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_audit_events_e2e";

let available = false;
let restaurantId = "";
let adminId = "";

// Real catalog keys. Expectations below run through `normalizeServiceKeys`
// rather than hard-coding arrays, so dependency expansion in the catalog cannot
// make the assertions quietly wrong.
const SELECTED_A = ["MENU", "TABLES"];
const SELECTED_B = ["MENU", "KOT"];
const NORM_A = normalizeServiceKeys(SELECTED_A);
const NORM_B = normalizeServiceKeys(SELECTED_B);
const ADDED_B_MINUS_A = NORM_B.filter((k) => !NORM_A.includes(k));
const REMOVED_A_MINUS_B = NORM_A.filter((k) => !NORM_B.includes(k));

async function seedRestaurant(): Promise<string> {
  const user = await UserModel.create({
    fullName: "Admin",
    email: `audit-events-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name: "Audit Events Cafe",
    ownerName: "Admin",
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

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    await TableAuditLogModel.syncIndexes();
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
    // The collection-level delete bypasses the append-only guard, which is the
    // same approach the existing audit e2e suite uses for isolation.
    TableAuditLogModel.collection.deleteMany({}),
    PlanModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    UserModel.deleteMany({}),
    RestaurantModel.deleteMany({}),
    RestaurantSettingsModel.deleteMany({}),
  ]);
  restaurantId = await seedRestaurant();
  const user = await UserModel.findOne({});
  adminId = String(user?._id ?? "");
});

/** All audit rows for one action, newest last. */
async function rowsFor(action: string) {
  return TableAuditLogModel.find({ action }).sort({ createdAt: 1 }).lean();
}

describe("plan + subscription audit events", () => {
  it("records PLAN_CREATED with the plan snapshot and no restaurant scope", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      features: ["Kitchen"],
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });

    const [row] = await rowsFor("PLAN_CREATED");
    expect(row).toBeTruthy();
    // Plans are platform-level, so there is no venue to scope them to.
    expect(row.restaurantId ?? null).toBeNull();
    expect(row.entityType).toBe("PLAN");
    expect(row.entityId).toBe(plan.planId);
    expect(row.actorRole).toBe("SUPER_ADMIN");
    expect(row.before ?? null).toBeNull();
    expect((row.after as Record<string, unknown>).name).toBe("Pro");
    expect((row.after as Record<string, unknown>).serviceKeys).toEqual(NORM_A);
  });

  it("records PLAN_UPDATED with before and after for the changed fields", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Starter",
      pricePaise: 49900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });

    await updatePlan(
      plan.planId,
      { name: "Starter Plus", pricePaise: 59900 },
      { updatedBy: adminId }
    );

    const [row] = await rowsFor("PLAN_UPDATED");
    expect(row).toBeTruthy();
    const before = row.before as Record<string, unknown>;
    const after = row.after as Record<string, unknown>;
    expect(before.name).toBe("Starter");
    expect(after.name).toBe("Starter Plus");
    expect(before.pricePaise).toBe(49900);
    expect(after.pricePaise).toBe(59900);
    expect(Object.keys(before).sort()).toEqual(Object.keys(after).sort());
  });

  it("records PLAN_SERVICES_UPDATED with added, removed and the key lists", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });

    await updatePlan(plan.planId, { serviceKeys: [...SELECTED_B] }, { updatedBy: adminId });

    const [row] = await rowsFor("PLAN_SERVICES_UPDATED");
    expect(row).toBeTruthy();

    const meta = row.metadata as Record<string, unknown>;
    // PAID_A -> PAID_B: TABLE_MANAGEMENT out, KOT_MANAGEMENT in.
    expect(meta.servicesAdded).toEqual(ADDED_B_MINUS_A);
    expect(meta.servicesRemoved).toEqual(REMOVED_A_MINUS_B);
    expect(meta.previousServiceKeys).toEqual(NORM_A);
    expect(meta.newServiceKeys).toEqual(NORM_B);

    expect((row.before as Record<string, unknown>).serviceKeys).toEqual(NORM_A);
    expect((row.after as Record<string, unknown>).serviceKeys).toEqual(NORM_B);
  });

  it("does not emit a services event when the selection is unchanged", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });

    // Re-saving the same selection is not a change a reviewer needs to see.
    await updatePlan(plan.planId, { serviceKeys: [...SELECTED_A] }, { updatedBy: adminId });

    expect(await rowsFor("PLAN_SERVICES_UPDATED")).toHaveLength(0);
    expect(await rowsFor("PLAN_UPDATED")).toHaveLength(0);
  });

  it("records PLAN_ACTIVATED and PLAN_DEACTIVATED as a state transition", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });

    await setPlanActive(plan.planId, false, { updatedBy: adminId });
    const [deactivated] = await rowsFor("PLAN_DEACTIVATED");
    expect(deactivated).toBeTruthy();
    expect((deactivated.before as Record<string, unknown>).isActive).toBe(true);
    expect((deactivated.after as Record<string, unknown>).isActive).toBe(false);

    await setPlanActive(plan.planId, true, { updatedBy: adminId });
    const [activated] = await rowsFor("PLAN_ACTIVATED");
    expect(activated).toBeTruthy();
    expect((activated.before as Record<string, unknown>).isActive).toBe(false);
    expect((activated.after as Record<string, unknown>).isActive).toBe(true);

    // The dedicated action replaces the generic one: one write, one event.
    expect(await rowsFor("PLAN_UPDATED")).toHaveLength(0);
  });

  it("scopes every subscription event to the restaurant", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });

    const created = await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date(),
      createdBy: adminId,
    });
    expect(created.restaurantId).toBe(restaurantId);

    await renewSubscription({
      restaurantId,
      startDate: new Date(),
      createdBy: adminId,
    } as never);
    const otherPlan = await createPlan({
      name: "Basic",
      pricePaise: 29900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_B],
      createdBy: adminId,
    });
    await changeSubscriptionPlan({
      restaurantId,
      planId: otherPlan.planId,
      createdBy: adminId,
    });
    await suspendSubscription({
      restaurantId,
      createdBy: adminId,
      reason: "Payment failed",
    });
    await reactivateSubscription({ restaurantId, createdBy: adminId } as never);

    const expected = [
      "SUBSCRIPTION_CREATED",
      "SUBSCRIPTION_RENEWED",
      "SUBSCRIPTION_PLAN_CHANGED",
      "SUBSCRIPTION_SUSPENDED",
      "SUBSCRIPTION_REACTIVATED",
    ];
    for (const action of expected) {
      const rows = await rowsFor(action);
      expect(rows, `${action} should be audited`).toHaveLength(1);
      // The restaurant is the only thing that ties a subscription event to a
      // venue, so it must never be dropped.
      expect(String(rows[0].restaurantId), action).toBe(restaurantId);
      expect(rows[0].entityType, action).toBe("SUBSCRIPTION");
    }
  });

  it("records the operator's reason on a hold", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date(),
      createdBy: adminId,
    });

    await suspendSubscription({
      restaurantId,
      createdBy: adminId,
      reason: "Payment failed",
    });

    const [row] = await rowsFor("SUBSCRIPTION_SUSPENDED");
    expect(row.reason).toBe("Payment failed");
    expect((row.before as Record<string, unknown>).status).not.toBe("SUSPENDED");
    expect((row.after as Record<string, unknown>).status).toBe("SUSPENDED");
  });

  it("records the plan and services a venue moved between", async () => {
    if (!available) return;
    const planA = await createPlan({
      name: "Basic",
      pricePaise: 29900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });
    const planB = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_B],
      createdBy: adminId,
    });
    await createSubscription({
      restaurantId,
      planId: planA.planId,
      startDate: new Date(),
      createdBy: adminId,
    });

    await changeSubscriptionPlan({
      restaurantId,
      planId: planB.planId,
      createdBy: adminId,
      reason: "Upgraded",
    });

    const [row] = await rowsFor("SUBSCRIPTION_PLAN_CHANGED");
    const before = row.before as Record<string, unknown>;
    const after = row.after as Record<string, unknown>;
    expect(before.planId).toBe(planA.planId);
    expect(after.planId).toBe(planB.planId);
    expect(before.serviceKeys).toEqual(NORM_A);
    expect(after.serviceKeys).toEqual(NORM_B);
    expect(row.reason).toBe("Upgraded");
  });

  it("never writes a credential into an audit row", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_A],
      createdBy: adminId,
    });
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date(),
      notes: "VIP guest",
      createdBy: adminId,
    });
    const otherPlan = await createPlan({
      name: "Basic",
      pricePaise: 29900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SELECTED_B],
      createdBy: adminId,
    });
    await changeSubscriptionPlan({
      restaurantId,
      planId: otherPlan.planId,
      createdBy: adminId,
    });

    // Anything that could carry a secret is a hard failure, not a warning.
    const banned = /password|token|secret|apiKey|api_key|credential|authorization/i;
    const rows = await TableAuditLogModel.find({}).lean();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const key of ["before", "after", "metadata", "summary"]) {
        const text = JSON.stringify((row as Record<string, unknown>)[key] ?? null);
        expect(text, `${row.action}.${key}`).not.toMatch(banned);
      }
    }
  });

  it("captures every service key through the audit path unchanged", async () => {
    if (!available) return;
    // Guards against an allow-list in the audit payload silently dropping a
    // newly added service from the record.
    const plan = await createPlan({
      name: "Everything",
      pricePaise: 199900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...SERVICE_KEYS],
      createdBy: adminId,
    });

    const [row] = await rowsFor("PLAN_CREATED");
    expect((row.after as Record<string, unknown>).serviceKeys).toEqual(normalizeServiceKeys(SERVICE_KEYS));
    expect(plan.serviceKeys).toEqual(normalizeServiceKeys(SERVICE_KEYS));
  });
});

describe("PLAN_SERVICES_UPDATED covers removals as well as additions", () => {
  it("records an event when a plan is emptied of services", async () => {
    // Normalization pulls in dependencies (MENU brings TABLES + ORDERS), so the
    // expected values are derived rather than hard-coded.
    const starting = normalizeServiceKeys(["DASHBOARD", "POS", "MENU"]);
    expect(starting.length).toBeGreaterThan(3);

    const plan = await createPlan({
      name: "Silver",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: ["DASHBOARD", "POS", "MENU"],
      createdBy: null,
    });
    const before = await TableAuditLogModel.countDocuments({
      entityType: "PLAN",
      entityId: plan.planId,
      action: "PLAN_SERVICES_UPDATED",
    });

    await updatePlan(plan.planId, { serviceKeys: [] }, { updatedBy: null });

    const logs = await TableAuditLogModel.find({
      entityType: "PLAN",
      entityId: plan.planId,
      action: "PLAN_SERVICES_UPDATED",
    })
      .sort({ createdAt: 1 })
      .lean();

    expect(logs.length).toBe(before + 1);
    const entry = logs[logs.length - 1] as unknown as {
      before: { serviceKeys?: string[] };
      after: { serviceKeys?: string[] };
      metadata: { servicesRemoved?: string[]; servicesAdded?: string[] };
    };
    expect(entry.before.serviceKeys).toEqual(starting);
    expect(entry.after.serviceKeys).toEqual([]);
    expect(entry.metadata.servicesRemoved).toEqual(starting);
    expect(entry.metadata.servicesAdded).toEqual([]);
  });

  it("stays silent when the service list is re-saved unchanged", async () => {
    const plan = await createPlan({
      name: "Gold",
      pricePaise: 199900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: ["DASHBOARD", "POS"],
      createdBy: null,
    });

    await updatePlan(
      plan.planId,
      { serviceKeys: ["DASHBOARD", "POS"] },
      { updatedBy: null }
    );
    await updatePlan(plan.planId, { serviceKeys: [] }, { updatedBy: null });

    const emptyAgain = await TableAuditLogModel.countDocuments({
      entityType: "PLAN",
      entityId: plan.planId,
      action: "PLAN_SERVICES_UPDATED",
    });

    // `[] -> []` is a no-op, so re-saving an already-empty plan adds no event.
    await updatePlan(plan.planId, { serviceKeys: [] }, { updatedBy: null });

    expect(
      await TableAuditLogModel.countDocuments({
        entityType: "PLAN",
        entityId: plan.planId,
        action: "PLAN_SERVICES_UPDATED",
      })
    ).toBe(emptyAgain);
  });
});
