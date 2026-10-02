import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// The staff UI is a server-action client component; the guards are stubbed so
// the component tree can be rendered without a session.
vi.mock("@/lib/auth/guards", () => ({
  requireAuth: vi.fn(),
  requireRestaurant: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentRestaurant: vi.fn(),
}));

import mongoose from "mongoose";
import React from "react";
import { renderToString } from "react-dom/server";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { SubscriptionPaymentModel } from "@/models/SubscriptionPayment";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { attemptLogin } from "@/lib/auth/login-service";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { canManageStaff, assertCanManageStaff, StaffForbiddenError } from "@/lib/staff/permissions";
import {
  listStaff,
  createStaffMember,
  updateStaffMember,
  setStaffActive,
  resetStaffPassword,
  StaffConflictError,
  StaffNotFoundError,
  StaffValidationError,
  type StaffActor,
  type StaffListResult,
} from "@/lib/staff/staff-service";
import { createStaffSchema, updateStaffSchema } from "@/lib/staff/validation";
import { STAFF_ASSIGNABLE_ROLES } from "@/lib/staff/constants";
import { StaffManager } from "@/components/settings/staff-manager";
import { createPlan, type SavePlanInput } from "@/lib/admin/plan-service";
import {
  createSubscription,
  renewSubscription,
  changeSubscriptionPlan,
  changeSubscriptionPricing,
  getSubscriptionAccess,
  getSubscriptionByRestaurantId,
  listSubscriptionHistory,
} from "@/lib/admin/subscription-service";
import { recordPayment, listPayments } from "@/lib/admin/payment-service";
import { SubscriptionValidationError } from "@/lib/admin/errors";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_staff_e2e";

let available = false;
let seq = 0;

function uniqueEmail(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@restopos.test`;
}

interface Tenant {
  restaurantId: string;
  ownerId: string;
  ownerActor: StaffActor;
  password: string;
}

const PASSWORD = "Password123!";

async function seedTenant(name: string): Promise<Tenant> {
  const owner = await UserModel.create({
    fullName: `${name} Owner`,
    email: uniqueEmail("owner"),
    passwordHash: await hashPassword(PASSWORD),
    phone: "9876543210",
    isActive: true,
  });
  const result = await createRestaurantForUser(String(owner._id), {
    name,
    ownerName: `${name} Owner`,
    phone: "9876543210",
    address: "1 Food St",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    gstRegistered: false,
    gstin: "",
    businessType: "Restaurant",
  });
  return {
    restaurantId: result.restaurantId,
    ownerId: String(owner._id),
    ownerActor: { userId: String(owner._id), role: "OWNER" },
    password: PASSWORD,
  };
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
    features: ["pos"],
    isActive: true,
    ...overrides,
  });
  return plan.planId;
}

function actor(userId: string, role: string): StaffActor {
  return { userId, role };
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
  await SubscriptionPaymentModel.deleteMany({});
  await PlatformCounterModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
  // The shared login rate limiter stores its budget in MongoDB, so buckets
  // survive between runs. Without clearing them they accumulate across suite
  // runs until real accounts are locked out and unrelated assertions fail.
  await mongoose.connection.collection("ratelimits").deleteMany({});
});

it("requires a reachable MongoDB so a skipped run can never look green", () => {
  expect(available, `MongoDB unreachable at ${MONGODB_E2E_URI}`).toBe(true);
});

/* ------------------------------------------------------------------ */
/* Staff: pure rules                                                   */
/* ------------------------------------------------------------------ */

describe("staff: role rules", () => {
  it("only owners and managers may manage staff", () => {
    expect(canManageStaff("OWNER")).toBe(true);
    expect(canManageStaff("MANAGER")).toBe(true);
    expect(canManageStaff("CASHIER")).toBe(false);
    expect(canManageStaff("WAITER")).toBe(false);
    expect(canManageStaff("SUPER_ADMIN")).toBe(false);
    expect(() => assertCanManageStaff("CASHIER")).toThrow(StaffForbiddenError);
    expect(() => assertCanManageStaff("OWNER")).not.toThrow();
  });

  it("never offers SUPER_ADMIN as an assignable staff role", () => {
    expect(STAFF_ASSIGNABLE_ROLES).toEqual(["OWNER", "MANAGER", "CASHIER", "WAITER"]);
    expect(STAFF_ASSIGNABLE_ROLES as readonly string[]).not.toContain("SUPER_ADMIN");
  });

  it("rejects a forged SUPER_ADMIN role at the schema boundary", () => {
    const parsed = createStaffSchema.safeParse({
      fullName: "Mallory",
      email: "mallory@restopos.test",
      phone: "9876543210",
      role: "SUPER_ADMIN",
      password: "Password123!",
    });
    expect(parsed.success).toBe(false);

    const update = updateStaffSchema.safeParse({ role: "SUPER_ADMIN" });
    expect(update.success).toBe(false);
  });

  it("requires a password of at least 8 characters", () => {
    expect(
      createStaffSchema.safeParse({
        fullName: "Short",
        email: "short@restopos.test",
        phone: "9876543210",
        role: "CASHIER",
        password: "short",
      }).success
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Staff: lifecycle against real MongoDB                               */
/* ------------------------------------------------------------------ */

describe("staff management against real MongoDB", () => {
  it(
    "1. an owner creates staff with the correct restaurantId and a hashed password",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");

      const member = await createStaffMember(
        tenant.restaurantId,
        {
          fullName: "Ravi Kumar",
          email: "ravi@restopos.test",
          phone: "9876500001",
          role: "CASHIER",
          password: "CashierPass1!",
        },
        tenant.ownerActor
      );

      expect(member.role).toBe("CASHIER");
      expect(member.isActive).toBe(true);
      expect(member.isOwner).toBe(false);

      const stored = await UserModel.findById(member.userId).lean();
      expect(String(stored?.restaurantId)).toBe(tenant.restaurantId);

      // The hash must exist, be argon2, and never equal the plaintext.
      const withHash = await UserModel.findById(member.userId)
        .select("+passwordHash")
        .lean();
      const hash = String(withHash?.passwordHash);
      expect(hash).not.toBe("CashierPass1!");
      expect(hash.startsWith("$argon2")).toBe(true);
      expect(await verifyPassword("CashierPass1!", hash)).toBe(true);
    },
    30000
  );

  it(
    "2. the new staff member can sign in with the credentials the owner set",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      await createStaffMember(
        tenant.restaurantId,
        {
          fullName: "Ravi Kumar",
          email: "ravi-login@restopos.test",
          phone: "9876500001",
          role: "WAITER",
          password: "WaiterPass1!",
        },
        tenant.ownerActor
      );

      const result = await attemptLogin({
        email: "ravi-login@restopos.test",
        password: "WaiterPass1!",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.role).toBe("WAITER");
        expect(result.restaurantId).toBe(tenant.restaurantId);
      }
    },
    30000
  );

  it(
    "3. a deactivated staff member cannot sign in, and reactivating restores access",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const member = await createStaffMember(
        tenant.restaurantId,
        {
          fullName: "Ravi Kumar",
          email: "ravi-off@restopos.test",
          phone: "9876500001",
          role: "CASHIER",
          password: "CashierPass1!",
        },
        tenant.ownerActor
      );

      const off = await setStaffActive(tenant.restaurantId, member.userId, false, tenant.ownerActor);
      expect(off.isActive).toBe(false);

      const blocked = await attemptLogin({
        email: "ravi-off@restopos.test",
        password: "CashierPass1!",
      });
      expect(blocked).toEqual({ ok: false, reason: "deactivated" });

      await setStaffActive(tenant.restaurantId, member.userId, true, tenant.ownerActor);
      const allowed = await attemptLogin({
        email: "ravi-off@restopos.test",
        password: "CashierPass1!",
      });
      expect(allowed.ok).toBe(true);
    },
    30000
  );

  it(
    "4. editing a staff member changes name, phone and role",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const member = await createStaffMember(
        tenant.restaurantId,
        {
          fullName: "Ravi Kumar",
          email: "ravi-edit@restopos.test",
          phone: "9876500001",
          role: "WAITER",
          password: "WaiterPass1!",
        },
        tenant.ownerActor
      );

      const updated = await updateStaffMember(
        tenant.restaurantId,
        member.userId,
        { fullName: "Ravi K", phone: "9876500099", role: "MANAGER" },
        tenant.ownerActor
      );

      expect(updated.fullName).toBe("Ravi K");
      expect(updated.phone).toBe("9876500099");
      expect(updated.role).toBe("MANAGER");

      // A profile edit must never disturb the credentials.
      const stored = await UserModel.findById(member.userId)
        .select("+passwordHash")
        .lean();
      expect(await verifyPassword("WaiterPass1!", String(stored?.passwordHash))).toBe(true);
    },
    30000
  );

  it(
    "5. a password reset replaces the old one and the new hash is stored",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const member = await createStaffMember(
        tenant.restaurantId,
        {
          fullName: "Ravi Kumar",
          email: "ravi-reset@restopos.test",
          phone: "9876500001",
          role: "CASHIER",
          password: "OldPass123!",
        },
        tenant.ownerActor
      );

      const result = await resetStaffPassword(
        tenant.restaurantId,
        member.userId,
        "NewPass456!",
        tenant.ownerActor
      );
      expect(result.userId).toBe(member.userId);
      // The return value must not carry the new secret.
      expect(JSON.stringify(result)).not.toContain("NewPass456!");

      const stored = await UserModel.findById(member.userId)
        .select("+passwordHash")
        .lean();
      expect(String(stored?.passwordHash)).not.toBe("NewPass456!");
      expect(await verifyPassword("NewPass456!", String(stored?.passwordHash))).toBe(true);
      expect(await verifyPassword("OldPass123!", String(stored?.passwordHash))).toBe(false);
    },
    30000
  );

  it(
    "6. duplicate email addresses are rejected without leaking the other tenant",
    async () => {
      if (!available) return;
      const a = await seedTenant("Curry House");
      await createStaffMember(
        a.restaurantId,
        {
          fullName: "Ravi Kumar",
          email: "shared@restopos.test",
          phone: "9876500001",
          role: "CASHIER",
          password: "CashierPass1!",
        },
        a.ownerActor
      );

      const b = await seedTenant("Tandoor House");
      await expect(
        createStaffMember(
          b.restaurantId,
          {
            fullName: "Other Person",
            email: "shared@restopos.test",
            phone: "9876500002",
            role: "CASHIER",
            password: "CashierPass1!",
          },
          b.ownerActor
        )
      ).rejects.toThrow(StaffConflictError);
    },
    30000
  );

  it(
    "7. the restaurant owner cannot be demoted or deactivated",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");

      await expect(
        updateStaffMember(tenant.restaurantId, tenant.ownerId, { role: "CASHIER" }, tenant.ownerActor)
      ).rejects.toThrow(StaffValidationError);

      await expect(
        setStaffActive(tenant.restaurantId, tenant.ownerId, false, tenant.ownerActor)
      ).rejects.toThrow(StaffValidationError);

      const owner = await UserModel.findById(tenant.ownerId).lean();
      expect(owner?.role).toBe("OWNER");
      expect(owner?.isActive).toBe(true);
    },
    30000
  );

  it(
    "8. an owner cannot deactivate their own account",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const manager = await createStaffMember(
        tenant.restaurantId,
        {
          fullName: "Maya Manager",
          email: "maya@restopos.test",
          phone: "9876500003",
          role: "MANAGER",
          password: "ManagerPass1!",
        },
        tenant.ownerActor
      );

      await expect(
        setStaffActive(
          tenant.restaurantId,
          manager.userId,
          false,
          actor(manager.userId, "MANAGER")
        )
      ).rejects.toThrow(StaffValidationError);
    },
    30000
  );

  it(
    "9. staff writes are recorded in the existing audit log without secrets",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const member = await createStaffMember(
        tenant.restaurantId,
        {
          fullName: "Ravi Kumar",
          email: "ravi-audit@restopos.test",
          phone: "9876500001",
          role: "CASHIER",
          password: "CashierPass1!",
        },
        tenant.ownerActor
      );
      await updateStaffMember(tenant.restaurantId, member.userId, { phone: "9876500099" }, tenant.ownerActor);
      await setStaffActive(tenant.restaurantId, member.userId, false, tenant.ownerActor);
      await resetStaffPassword(tenant.restaurantId, member.userId, "NewPass456!", tenant.ownerActor);

      const logs = await TableAuditLogModel.find({
        restaurantId: tenant.restaurantId,
        action: "STAFF_CHANGE",
      })
        .sort({ createdAt: 1 })
        .lean();
      const changes = logs.map((l) => String((l.metadata as { change?: string })?.change ?? ""));

      expect(changes).toEqual([
        "STAFF_CREATED",
        "STAFF_UPDATED",
        "STAFF_DEACTIVATED",
        "STAFF_PASSWORD_RESET",
      ]);
      for (const log of logs) {
        const serialised = JSON.stringify(log);
        expect(serialised).not.toContain("CashierPass1!");
        expect(serialised).not.toContain("NewPass456!");
        expect(serialised).not.toContain("$argon2");
      }
    },
    30000
  );

  it(
    "10. search and filters narrow the list",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      await createStaffMember(
        tenant.restaurantId,
        { fullName: "Ravi Kumar", email: "ravi@restopos.test", phone: "9876500001", role: "CASHIER", password: "CashierPass1!" },
        tenant.ownerActor
      );
      const waiter = await createStaffMember(
        tenant.restaurantId,
        { fullName: "Asha Waiter", email: "asha@restopos.test", phone: "9876500002", role: "WAITER", password: "WaiterPass1!" },
        tenant.ownerActor
      );
      await setStaffActive(tenant.restaurantId, waiter.userId, false, tenant.ownerActor);

      const all = await listStaff(tenant.restaurantId);
      expect(all.total).toBe(3); // owner + 2 staff
      expect(all.counts.active).toBe(2);

      expect((await listStaff(tenant.restaurantId, { search: "asha" })).items).toHaveLength(1);
      expect((await listStaff(tenant.restaurantId, { search: "ravi@" })).items).toHaveLength(1);
      expect((await listStaff(tenant.restaurantId, { search: "9876500002" })).items).toHaveLength(1);
      expect((await listStaff(tenant.restaurantId, { role: "WAITER" })).items).toHaveLength(1);
      expect((await listStaff(tenant.restaurantId, { isActive: "false" })).items).toHaveLength(1);
      expect((await listStaff(tenant.restaurantId, { search: "zzz" })).items).toHaveLength(0);
    },
    30000
  );

  it(
    "11. the list never exposes a password hash",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      await createStaffMember(
        tenant.restaurantId,
        { fullName: "Ravi Kumar", email: "ravi@restopos.test", phone: "9876500001", role: "CASHIER", password: "CashierPass1!" },
        tenant.ownerActor
      );
      const result = await listStaff(tenant.restaurantId);
      expect(JSON.stringify(result)).not.toContain("$argon2");
      expect(JSON.stringify(result)).not.toContain("passwordHash");
    },
    30000
  );

  it(
    "12. the service itself refuses a non-manager, not just the UI",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const waiter = await createStaffMember(
        tenant.restaurantId,
        { fullName: "Ravi Kumar", email: "ravi@restopos.test", phone: "9876500001", role: "WAITER", password: "WaiterPass1!" },
        tenant.ownerActor
      );
      const waiterActor: StaffActor = { userId: waiter.userId, role: "WAITER" };
      const input = { fullName: "Ravi K", email: "ravi@restopos.test", phone: "9876500001", role: "WAITER" as const, password: "WaiterPass1!" };

      await expect(createStaffMember(tenant.restaurantId, input, waiterActor)).rejects.toThrow(StaffForbiddenError);
      await expect(updateStaffMember(tenant.restaurantId, waiter.userId, { fullName: "Hacked" }, waiterActor)).rejects.toThrow(StaffForbiddenError);
      await expect(setStaffActive(tenant.restaurantId, waiter.userId, false, waiterActor)).rejects.toThrow(StaffForbiddenError);
      await expect(resetStaffPassword(tenant.restaurantId, waiter.userId, "NewPass123!", waiterActor)).rejects.toThrow(StaffForbiddenError);

      // Nothing was written by any of the rejected calls.
      const after = await UserModel.findById(waiter.userId).lean();
      expect(after?.fullName).toBe("Ravi Kumar");
      expect(after?.isActive).toBe(true);
    },
    30000
  );

  it(
    "13. a manager cannot mint a second owner or demote the real one",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const manager = await createStaffMember(
        tenant.restaurantId,
        { fullName: "Maya Manager", email: "maya@restopos.test", phone: "9876500003", role: "MANAGER", password: "ManagerPass1!" },
        tenant.ownerActor
      );
      const managerActor: StaffActor = { userId: manager.userId, role: "MANAGER" };

      // Escalation attempt through the role field.
      await expect(
        createStaffMember(
          tenant.restaurantId,
          { fullName: "Usurper", email: "usurper@restopos.test", phone: "9876500009", role: "OWNER", password: "Usurper123!" },
          managerActor
        )
      ).rejects.toThrow(StaffForbiddenError);

      await expect(
        updateStaffMember(tenant.restaurantId, manager.userId, { role: "OWNER" }, managerActor)
      ).rejects.toThrow(StaffForbiddenError);

      // The restaurant owner account stays untouchable.
      await expect(
        updateStaffMember(tenant.restaurantId, tenant.ownerId, { role: "CASHIER" }, managerActor)
      ).rejects.toThrow(StaffValidationError);
      await expect(
        setStaffActive(tenant.restaurantId, tenant.ownerId, false, managerActor)
      ).rejects.toThrow(StaffValidationError);

      // Even a real owner cannot create a second owner while one exists.
      await expect(
        createStaffMember(
          tenant.restaurantId,
          { fullName: "Owner Two", email: "owner2@restopos.test", phone: "9876500008", role: "OWNER", password: "OwnerTwo123!" },
          tenant.ownerActor
        )
      ).rejects.toThrow(StaffValidationError);

      expect(await UserModel.countDocuments({ restaurantId: tenant.restaurantId, role: "OWNER" })).toBe(1);
    },
    30000
  );

  it(
    "14. nobody can deactivate their own account",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const manager = await createStaffMember(
        tenant.restaurantId,
        { fullName: "Maya Manager", email: "maya@restopos.test", phone: "9876500003", role: "MANAGER", password: "ManagerPass1!" },
        tenant.ownerActor
      );
      const managerActor: StaffActor = { userId: manager.userId, role: "MANAGER" };

      // Via the dedicated toggle.
      await expect(setStaffActive(tenant.restaurantId, manager.userId, false, managerActor)).rejects.toThrow(StaffValidationError);
      // And via the update path, which also accepts an isActive field.
      await expect(
        updateStaffMember(tenant.restaurantId, manager.userId, { isActive: false }, managerActor)
      ).rejects.toThrow(StaffValidationError);

      expect((await UserModel.findById(manager.userId).lean())?.isActive).toBe(true);
    },
    30000
  );
});

/* ------------------------------------------------------------------ */
/* Staff: the rendered table                                           */
/* ------------------------------------------------------------------ */

describe("staff table rendering", () => {
  const view: StaffListResult = {
    items: [
      {
        userId: "u1",
        fullName: "Owner Person",
        email: "owner@shop.test",
        phone: "9876543210",
        role: "OWNER",
        isActive: true,
        isOwner: true,
        createdAt: null,
        updatedAt: null,
      },
      {
        userId: "u2",
        fullName: "Ravi Kumar",
        email: "ravi@shop.test",
        phone: "9876500001",
        role: "CASHIER",
        isActive: true,
        isOwner: false,
        createdAt: null,
        updatedAt: null,
      },
      {
        userId: "u3",
        fullName: "Asha Waiter",
        email: "asha@shop.test",
        phone: "9876500002",
        role: "WAITER",
        isActive: false,
        isOwner: false,
        createdAt: null,
        updatedAt: null,
      },
      {
        userId: "u4",
        fullName: "Maya Manager",
        email: "maya@shop.test",
        phone: "9876500003",
        role: "MANAGER",
        isActive: true,
        isOwner: false,
        createdAt: null,
        updatedAt: null,
      },
    ],
    total: 4,
    counts: { all: 4, active: 3, inactive: 1 },
  };

  it("21. lists staff with role, status and row actions", () => {
    const html = renderToString(
      React.createElement(StaffManager, {
        result: view,
        canEdit: true,
        currentUserId: "u2",
        isOwnerRole: true,
        filters: { search: "", role: "", status: "" },
      })
    );

    expect(html).toContain("Ravi Kumar");
    expect(html).toContain("ravi@shop.test");
    expect(html).toContain("Cashier");
    expect(html).toContain("Waiter");
    expect(html).toContain("Active");
    expect(html).toContain("Inactive");
    expect(html).toContain("Add staff");
    expect(html).toContain("Reset password");
    expect(html).toContain("Deactivate");
    // The signed-in user cannot deactivate their own account.
    expect(html).toContain(">You<");
    // The restaurant owner account cannot be deactivated.
    expect(html).toContain(">Owner<");
  });

  it("22. hides every mutating control for a read-only role", () => {
    const html = renderToString(
      React.createElement(StaffManager, {
        result: view,
        canEdit: false,
        currentUserId: "u9",
        isOwnerRole: false,
        filters: { search: "", role: "", status: "" },
      })
    );

    expect(html).toContain("Ravi Kumar");
    expect(html).not.toContain("Add staff");
    expect(html).not.toContain("Reset password");
    expect(html).not.toContain("Deactivate");
    expect(html).not.toContain(">Edit<");
    expect(html).toContain("Read only");
  });
});

/* ------------------------------------------------------------------ */
/* Multi-tenancy                                                       */
/* ------------------------------------------------------------------ */

describe("multi-tenant isolation", () => {
  it(
    "12. restaurant A cannot see or modify restaurant B staff",
    async () => {
      if (!available) return;
      const a = await seedTenant("Curry House");
      const b = await seedTenant("Tandoor House");
      const bStaff = await createStaffMember(
        b.restaurantId,
        { fullName: "B Staff", email: "bstaff@restopos.test", phone: "9876500010", role: "CASHIER", password: "CashierPass1!" },
        b.ownerActor
      );

      // A's list contains only A's people.
      const aList = await listStaff(a.restaurantId);
      expect(aList.items.map((m) => m.userId)).not.toContain(bStaff.userId);
      expect(aList.total).toBe(1);

      // Every A-initiated write against B's user must fail as "not found".
      await expect(
        updateStaffMember(a.restaurantId, bStaff.userId, { fullName: "Hijacked" }, a.ownerActor)
      ).rejects.toThrow(StaffNotFoundError);
      await expect(
        setStaffActive(a.restaurantId, bStaff.userId, false, a.ownerActor)
      ).rejects.toThrow(StaffNotFoundError);
      await expect(
        resetStaffPassword(a.restaurantId, bStaff.userId, "Hijack123!", a.ownerActor)
      ).rejects.toThrow(StaffNotFoundError);

      // B's staff record is untouched.
      const untouched = await UserModel.findById(bStaff.userId)
        .select("+passwordHash fullName isActive")
        .lean();
      expect(untouched?.fullName).toBe("B Staff");
      expect(untouched?.isActive).toBe(true);
      expect(await verifyPassword("CashierPass1!", String(untouched?.passwordHash))).toBe(true);
    },
    30000
  );

  it(
    "13. a staff member's login is scoped to their own restaurant",
    async () => {
      if (!available) return;
      const a = await seedTenant("Curry House");
      await createStaffMember(
        a.restaurantId,
        { fullName: "A Staff", email: "astaff@restopos.test", phone: "9876500011", role: "CASHIER", password: "CashierPass1!" },
        a.ownerActor
      );

      const result = await attemptLogin({
        email: "astaff@restopos.test",
        password: "CashierPass1!",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.restaurantId).toBe(a.restaurantId);
    },
    30000
  );
});

/* ------------------------------------------------------------------ */
/* Subscription pricing, payments and the access gate                  */
/* ------------------------------------------------------------------ */

describe("subscription pricing and payments", () => {
  it(
    "14. a customer-specific price keeps list, discount and final apart",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const planId = await seedPlan("STANDARD", 999900);

      const sub = await createSubscription(
        {
          restaurantId: tenant.restaurantId,
          planId,
          startDate: new Date(),
          // Final price is derived: 999900 plan - 200000 discount = 799900.
          discountAmountPaise: 200000,
          createdBy: tenant.ownerId,
          changedByRole: "SUPER_ADMIN",
        }
      );

      expect(sub.listPricePaise).toBe(999900);
      expect(sub.discountAmountPaise).toBe(200000);
      expect(sub.finalPricePaise).toBe(799900);
    },
    30000
  );

  it(
    "15. a discount greater than the list price is rejected",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const planId = await seedPlan("STANDARD", 999900);

      await expect(
        createSubscription({
          restaurantId: tenant.restaurantId,
          planId,
          startDate: new Date(),
          discountAmountPaise: 1500000,
          createdBy: tenant.ownerId,
        })
      ).rejects.toThrow(SubscriptionValidationError);
    },
    30000
  );

  it(
    "16. a restaurant can only ever have one subscription",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const planId = await seedPlan("STANDARD", 999900);
      await createSubscription({
        restaurantId: tenant.restaurantId,
        planId,
        startDate: new Date(),
        createdBy: tenant.ownerId,
      });

      await expect(
        createSubscription({
          restaurantId: tenant.restaurantId,
          planId,
          startDate: new Date(),
          createdBy: tenant.ownerId,
        })
      ).rejects.toThrow(SubscriptionValidationError);
      expect(await SubscriptionModel.countDocuments({ restaurantId: tenant.restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "17. renewal extends expiry and plan change keeps the new list price",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const standard = await seedPlan("STANDARD", 999900);
      const pro = await seedPlan("PRO", 1999900);

      const created = await createSubscription({
        restaurantId: tenant.restaurantId,
        planId: standard,
        startDate: new Date(),
        createdBy: tenant.ownerId,
        changedByRole: "SUPER_ADMIN",
      });

      const renewed = await renewSubscription({
        restaurantId: tenant.restaurantId,
        createdBy: tenant.ownerId,
        changedByRole: "SUPER_ADMIN",
      });
      expect(renewed.expiryDate.getTime()).toBeGreaterThan(created.expiryDate.getTime());

      const upgraded = await changeSubscriptionPlan({
        restaurantId: tenant.restaurantId,
        planId: pro,
        createdBy: tenant.ownerId,
        changedByRole: "SUPER_ADMIN",
      });
      expect(upgraded.planName).toBe("PRO");
      expect(upgraded.listPricePaise).toBe(1999900);
      // A plan switch must not leave the previous plan's discount behind.
      expect(upgraded.finalPricePaise).toBe(1999900);

      const actions = (await listSubscriptionHistory(tenant.restaurantId)).map((h) => h.action);
      expect(actions).toContain("CREATED");
      expect(actions).toContain("RENEWED");
      expect(actions).toContain("PLAN_CHANGED");
    },
    30000
  );

  it(
    "18. a recorded payment stores method and reference, and a reference is unique",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");
      const planId = await seedPlan("STANDARD", 999900);
      const sub = await createSubscription({
        restaurantId: tenant.restaurantId,
        planId,
        startDate: new Date(),
        createdBy: tenant.ownerId,
      });

      const payment = await recordPayment({
        restaurantId: tenant.restaurantId,
        subscriptionId: sub.subscriptionId,
        amountPaise: sub.finalPricePaise,
        paymentMethod: "UPI",
        transactionReference: "UPI-ABC-123",
        createdBy: tenant.ownerId,
      });
      expect(payment.paymentMethod).toBe("UPI");
      expect(payment.transactionReference).toBe("UPI-ABC-123");

      await expect(
        recordPayment({
          restaurantId: tenant.restaurantId,
          subscriptionId: sub.subscriptionId,
          amountPaise: 100,
          paymentMethod: "CASH",
          transactionReference: "UPI-ABC-123",
          createdBy: tenant.ownerId,
        })
      ).rejects.toThrow();

      const listed = await listPayments({ restaurantId: tenant.restaurantId });
      expect(listed.items).toHaveLength(1);
    },
    30000
  );

  it(
    "19. the access gate allows valid states and blocks expired ones without deleting data",
    async () => {
      if (!available) return;
      const tenant = await seedTenant("Curry House");

      // No subscription at all is now blocked: a venue is only ever served
      // after a SUPER_ADMIN has assigned it a plan.
      const none = await getSubscriptionAccess(tenant.restaurantId);
      expect(none.allowed).toBe(false);
      expect(none.status).toBe("NONE");

      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 60);
      const sub = await createSubscription({
        restaurantId: tenant.restaurantId,
        // 60 days ago on a 30-day plan is 30 days past expiry; a zero grace
        // period on the plan means there is no grace to fall back on.
        planId: await seedPlan("STANDARD No Grace", 999900, { gracePeriodDays: 0 }),
        startDate: start,
        createdBy: tenant.ownerId,
        changedByRole: "SUPER_ADMIN",
      });

      const expired = await getSubscriptionAccess(tenant.restaurantId);
      expect(expired.allowed).toBe(false);
      expect(expired.status).toBe("EXPIRED");

      // The restaurant and its people must survive an expiry untouched.
      const restaurant = await RestaurantModel.findById(tenant.restaurantId).lean();
      expect(restaurant?.name).toBe("Curry House");
      expect(await UserModel.countDocuments({ restaurantId: tenant.restaurantId })).toBe(1);
      expect(await SubscriptionModel.countDocuments({ restaurantId: tenant.restaurantId })).toBe(1);
      expect(await getSubscriptionByRestaurantId(tenant.restaurantId)).not.toBeNull();
      // The stored state is untouched; only the derived state moved to EXPIRED.
      expect(sub.storedStatus).toBe("ACTIVE");
      expect(sub.status).toBe("EXPIRED");
    },
    30000
  );

  it(
    "20. each restaurant's subscription is read and written only under its own key",
    async () => {
      if (!available) return;
      const a = await seedTenant("Curry House");
      const b = await seedTenant("Tandoor House");
      const planId = await seedPlan("PRO", 1999900);
      await createSubscription({
        restaurantId: b.restaurantId,
        planId,
        startDate: new Date(),
        createdBy: b.ownerId,
        changedByRole: "SUPER_ADMIN",
      });

      // The owner-facing read path is scoped to the session's restaurant, so A
      // can observe neither B's subscription nor B's history.
      expect(await getSubscriptionByRestaurantId(a.restaurantId)).toBeNull();
      expect(await listSubscriptionHistory(a.restaurantId)).toHaveLength(0);
      expect(await getSubscriptionByRestaurantId(b.restaurantId)).not.toBeNull();
      expect(await listSubscriptionHistory(b.restaurantId)).toHaveLength(1);

      // The admin pricing service is keyed strictly by restaurantId. Note this
      // service is NOT the tenant boundary: `changeSubscriptionPricingAction`
      // gates it behind `requireSuperAdmin()`. What is asserted here is that
      // targeting B leaves A completely untouched.
      await changeSubscriptionPricing({
        restaurantId: b.restaurantId,
        discountAmountPaise: 100000,
        createdBy: b.ownerId,
      });
      const bSub = await getSubscriptionByRestaurantId(b.restaurantId);
      expect(bSub?.discountAmountPaise).toBe(100000);
      expect(await getSubscriptionByRestaurantId(a.restaurantId)).toBeNull();
      expect(await listSubscriptionHistory(a.restaurantId)).toHaveLength(0);
    },
    30000
  );
});
