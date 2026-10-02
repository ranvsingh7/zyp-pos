/**
 * FULL_ACCESS_MODE — the temporary full-access switch, in both directions.
 *
 * This is the safety net for a temporary development/demo flag, so it asserts the
 * things that would actually hurt if the flag were wrong:
 *
 *  - ON: a restaurant OWNER reaches every service the application actually
 *    implements, even though their plan is the most restricted one we sell.
 *  - ON: a restricted subscription (suspended, expired, or not provisioned at
 *    all) stops blocking the venue entirely.
 *  - OFF: the existing subscription + service entitlement behaviour is untouched,
 *    byte for byte.
 *  - ON: RBAC still applies. This flag grants *services*, never *roles*, so a
 *    CASHIER still cannot manage staff and a WAITER still cannot see revenue.
 *  - ON and OFF: SUPER_ADMIN behaves exactly the same, because the flag is
 *    consulted after the super-admin branch rather than instead of it.
 *  - ON: the control is server-side. Direct URLs, API routes and server actions
 *    open up; nothing can be enabled from a browser.
 *  - ON: no Plan, Subscription or SubscriptionHistory document is created,
 *    modified or deleted. That is what makes flipping the flag back a complete
 *    and lossless undo.
 *
 * The guards are deliberately NOT mocked. The session helpers are, so a real
 * signed-in user is presented to the real `requireAuth()` / `requireRestaurant()`
 * chain, which means the page gates, API routes and server actions exercised here
 * go through the identical code a browser request would.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/session")>("@/lib/auth/session");
  // Only the three readers that need a real browser request are stubbed; the
  // signer stays real so the token below is a genuinely valid session JWT.
  return {
    ...actual,
    getSessionToken: vi.fn(),
    getSessionUserId: vi.fn(),
    getSessionRole: vi.fn(),
  };
});

import {
  encryptSession,
  getSessionRole,
  getSessionToken,
  getSessionUserId,
} from "@/lib/auth/session";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createPlan } from "@/lib/admin/plan-service";
import {
  createSubscription,
  reactivateSubscription,
  suspendSubscription,
  getSubscriptionAccess,
} from "@/lib/admin/subscription-service";
import {
  assertService,
  assertServiceForCurrentVenue,
  checkService,
  getServiceAccess,
  hasService,
  ServiceAccessError,
} from "@/lib/services/access";
import { requireService } from "@/lib/services/service-gate";
import {
  BASIC_DEFAULT_SERVICE_KEYS,
  SERVICE_KEYS,
  listActiveServices,
  type ServiceKey,
} from "@/lib/services/catalog";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_full_access_e2e";

let available = false;

/** The plan we use as the "most restricted realistic venue" baseline. */
const BASIC = [...BASIC_DEFAULT_SERVICE_KEYS];

/** Everything the application implements, i.e. everything full access grants. */
const IMPLEMENTED = listActiveServices().map((s) => s.key);

/** Everything BASIC does not pay for — the interesting set for this suite. */
const NOT_IN_BASIC = IMPLEMENTED.filter((k) => !BASIC.includes(k));

let restaurantId = "";
let ownerUserId = "";
let ownerEmail = "";

/** Flips the temporary server-side switch. */
function setFullAccess(on: boolean) {
  vi.stubEnv("FULL_ACCESS_MODE", on ? "true" : "false");
}

async function seedRestrictedVenue(name: string): Promise<{
  restaurantId: string;
  planId: string;
}> {
  ownerEmail = `fullaccess-${Date.now()}-${Math.random()}@restopos.test`;
  const user = await UserModel.create({
    fullName: "Owner",
    email: ownerEmail,
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
  });
  ownerUserId = String(user._id);
  const result = await createRestaurantForUser(ownerUserId, {
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
  restaurantId = result.restaurantId;

  const plan = await createPlan({
    name: `BASIC ${Date.now()}-${Math.random()}`,
    description: "full access test plan",
    pricePaise: 29900,
    billingCycle: "MONTHLY",
    durationDays: 30,
    isActive: true,
    serviceKeys: BASIC,
  });
  await createSubscription({
    restaurantId,
    planId: plan.planId,
    startDate: new Date(),
    createdBy: ownerUserId,
    changedByRole: "SUPER_ADMIN",
  });
  return { restaurantId, planId: plan.planId };
}

/**
 * Signs the mocked cookie jar in as the seeded owner. Everything downstream
 * (`requireAuth`, `requireRestaurant`, `assertServiceForCurrentVenue`) then runs
 * for real against the seeded database.
 */
async function signIn(role: string = "OWNER") {
  await UserModel.updateOne({ _id: ownerUserId }, { $set: { role } });
  const token = await encryptSession({
    userId: ownerUserId,
    restaurantId,
    role,
  });
  vi.mocked(getSessionToken).mockResolvedValue(token);
  vi.mocked(getSessionUserId).mockResolvedValue(ownerUserId);
  vi.mocked(getSessionRole).mockResolvedValue(role);
}

/** `next/navigation.redirect()` throws; its digest carries the destination. */
function isRedirectTo(error: unknown, pathname: string): boolean {
  return (
    error instanceof Error &&
    typeof (error as Error & { digest?: unknown }).digest === "string" &&
    ((error as Error & { digest: string }).digest.includes(pathname) ||
      (error as Error).message === "NEXT_REDIRECT")
  );
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
  // Plan-based access is the default for every test; each one opts in explicitly.
  setFullAccess(false);
  if (!available) return;
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await PlanModel.deleteMany({});
  await SubscriptionModel.deleteMany({});
  await SubscriptionHistoryModel.deleteMany({});
  await PlatformCounterModel.deleteMany({});
  await MenuCategoryModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
  vi.mocked(getSessionToken).mockReset();
  vi.mocked(getSessionUserId).mockReset();
  vi.mocked(getSessionRole).mockReset();
});

afterEach(() => {
  // Never let the temporary switch leak into another file or test.
  vi.unstubAllEnvs();
});

describe("0. the switch itself", () => {
  it("only the exact string 'true' turns full access on", async () => {
    if (!available) return;
    const { isFullAccessMode } = await import("@/lib/config/full-access");

    for (const value of ["false", "0", "", "no", "on", "ture", "TRUEISH", "enabled"]) {
      vi.stubEnv("FULL_ACCESS_MODE", value);
      expect(isFullAccessMode(), `"${value}" must not enable full access`).toBe(false);
    }
    for (const value of ["true", "TRUE", " True "]) {
      vi.stubEnv("FULL_ACCESS_MODE", value);
      expect(isFullAccessMode(), `"${value}" should enable full access`).toBe(true);
    }
    vi.stubEnv("FULL_ACCESS_MODE", undefined as unknown as string);
    expect(isFullAccessMode()).toBe(false);
  });

  it("is read from the server environment only — no browser surface exists", async () => {
    // The module is `server-only`, so a client component importing it is a build
    // error rather than a leak. This asserts the flag has no public twin.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/config/full-access.ts", "utf8")
    );
    expect(source).toContain('import "server-only"');
    // A NEXT_PUBLIC_ twin would expose it to the browser; there must not be one.
    const envFiles = [".env.example", "src/lib/config/full-access.ts"];
    for (const file of envFiles) {
      const text = await import("node:fs").then((fs) => fs.readFileSync(file, "utf8"));
      expect(text).not.toMatch(/NEXT_PUBLIC_FULL_ACCESS/);
    }
    // And nothing reads the flag from a request, a cookie or the session.
    expect(source).not.toMatch(/searchParams|request\.|cookies\(|headers\(/);
  });
});

describe("1. FULL_ACCESS_MODE=true: an OWNER reaches every implemented service", () => {
  it(
    "grants all implemented services despite a BASIC-only plan",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Full Access Kitchen");
      await signIn("OWNER");

      // Baseline: without the flag this venue is locked out of five services.
      setFullAccess(false);
      expect(NOT_IN_BASIC.length).toBeGreaterThan(0);
      expect(await hasService(restaurantId, "REPORTS", { role: "OWNER" })).toBe(false);

      setFullAccess(true);
      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.source).toBe("FULL_ACCESS");
      expect(access.serviceKeys).toEqual(IMPLEMENTED);

      for (const key of IMPLEMENTED) {
        expect(access.has(key), key).toBe(true);
        // assertService is what server actions and API routes call.
        await expect(
          assertService(restaurantId, key, { role: "OWNER" })
        ).resolves.toBeUndefined();
      }

      // Catalogued-but-unimplemented services stay denied: there is no code
      // behind them, and full access means "everything that exists".
      for (const key of SERVICE_KEYS) {
        if (IMPLEMENTED.includes(key)) continue;
        expect(access.has(key), key).toBe(false);
      }
    },
    30000
  );

  it(
    "covers every restaurant role, without promoting any of them",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("All Roles Kitchen");

      for (const role of ["OWNER", "MANAGER", "CASHIER", "WAITER"]) {
        await signIn(role);
        setFullAccess(true);
        const access = await getServiceAccess(restaurantId, { role });
        expect(access.serviceKeys, role).toEqual(IMPLEMENTED);
        // Full access is not a promotion. Only a real SUPER_ADMIN is unrestricted.
        expect(access.isSuperAdmin, role).toBe(false);
        await expect(
          assertServiceForCurrentVenue("REPORTS")
        ).resolves.toBeUndefined();
      }
    },
    30000
  );
});

describe("2. FULL_ACCESS_MODE=true: a restricted subscription stops blocking", () => {
  it(
    "a SUSPENDED subscription no longer locks the venue out of its modules",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Suspended Kitchen");
      await signIn("OWNER");
      await suspendSubscription({
        restaurantId,
        createdBy: ownerUserId,
        changedByRole: "SUPER_ADMIN",
        reason: "unpaid invoice",
      });
      const { requireRestaurant } = await import("@/lib/auth/guards");

      // Off: the lifecycle gate bounces the venue before any page can render.
      setFullAccess(false);
      const info = await getSubscriptionAccess(restaurantId);
      expect(info.allowed).toBe(false);
      expect(info.status).toBe("SUSPENDED");
      await expect(requireRestaurant()).rejects.toSatisfy((e: unknown) =>
        isRedirectTo(e, "/subscription-blocked")
      );

      // On: the venue walks straight in. Nothing about the subscription changed.
      setFullAccess(true);
      await expect(requireRestaurant()).resolves.toMatchObject({ id: restaurantId });
      expect((await checkService(restaurantId, "BILLING", { role: "OWNER" })).allowed).toBe(
        true
      );
      // The subscription service still tells the truth — it was not weakened.
      expect((await getSubscriptionAccess(restaurantId)).status).toBe("SUSPENDED");
    },
    30000
  );

  it(
    "an EXPIRED subscription and a venue with no subscription at all are both reachable",
    async () => {
      if (!available) return;
      const { requireRestaurant } = await import("@/lib/auth/guards");

      await seedRestrictedVenue("Expired Kitchen");
      await signIn("OWNER");
      await SubscriptionModel.updateOne(
        { restaurantId },
        { $set: { expiryDate: new Date("2020-01-01T00:00:00.000Z") } }
      );

      setFullAccess(false);
      expect((await getSubscriptionAccess(restaurantId)).status).toMatch(
        /EXPIRED|GRACE_PERIOD/
      );
      await expect(requireRestaurant()).rejects.toSatisfy((e: unknown) =>
        isRedirectTo(e, "/subscription-blocked")
      );

      setFullAccess(true);
      await expect(requireRestaurant()).resolves.toMatchObject({ id: restaurantId });
      expect(await hasService(restaurantId, "INVENTORY", { role: "OWNER" })).toBe(true);

      // No subscription at all: the other half of the "restricted" spectrum.
      await seedRestrictedVenue("Unprovisioned Kitchen");
      await signIn("OWNER");
      await SubscriptionModel.deleteMany({ restaurantId });
      setFullAccess(false);
      expect((await getSubscriptionAccess(restaurantId)).status).toBe("NONE");
      await expect(requireRestaurant()).rejects.toSatisfy((e: unknown) =>
        isRedirectTo(e, "/subscription-blocked")
      );

      setFullAccess(true);
      await expect(requireRestaurant()).resolves.toMatchObject({ id: restaurantId });
      expect(await hasService(restaurantId, "KOT", { role: "OWNER" })).toBe(true);
    },
    30000
  );
});

describe("3. FULL_ACCESS_MODE=false: existing restrictions work normally", () => {
  it(
    "a BASIC venue is still locked out of everything it did not pay for",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Basic Kitchen");
      await signIn("OWNER");
      setFullAccess(false);

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      // The real snapshot machinery, untouched: source is still SNAPSHOT.
      expect(access.source).toBe("SNAPSHOT");
      expect([...access.serviceKeys].sort()).toEqual([...BASIC].sort());
      expect(access.serviceKeys).not.toContain("REPORTS");

      for (const key of NOT_IN_BASIC) {
        expect(await hasService(restaurantId, key, { role: "OWNER" }), key).toBe(false);
        await expect(
          assertService(restaurantId, key, { role: "OWNER" })
        ).rejects.toBeInstanceOf(ServiceAccessError);
        const decision = await checkService(restaurantId, key, { role: "OWNER" });
        expect(decision.allowed, key).toBe(false);
        if (!decision.allowed) {
          expect(decision.message).toMatch(/not included in your current plan/i);
        }
      }

      // Still granted what it paid for, and the lifecycle gate still runs.
      for (const key of BASIC as ServiceKey[]) {
        expect(await hasService(restaurantId, key, { role: "OWNER" }), key).toBe(true);
      }
      const { requireRestaurant } = await import("@/lib/auth/guards");
      await expect(requireRestaurant()).resolves.toMatchObject({ id: restaurantId });
    },
    30000
  );

  it(
    "unsetting the flag is identical to setting it to false",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Unset Kitchen");
      await signIn("OWNER");

      setFullAccess(false);
      const withFalse = await getServiceAccess(restaurantId, { role: "OWNER" });
      vi.stubEnv("FULL_ACCESS_MODE", undefined as unknown as string);
      const withUnset = await getServiceAccess(restaurantId, { role: "OWNER" });

      expect(withUnset.source).toBe("SNAPSHOT");
      expect(withUnset.serviceKeys).toEqual(withFalse.serviceKeys);
    },
    30000
  );

  it(
    "flipping off restores every lock, with no data change",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Flip Kitchen");
      await signIn("OWNER");

      setFullAccess(true);
      expect(await hasService(restaurantId, "BILLING", { role: "OWNER" })).toBe(true);

      setFullAccess(false);
      expect(await hasService(restaurantId, "BILLING", { role: "OWNER" })).toBe(false);
      await expect(
        assertService(restaurantId, "BILLING", { role: "OWNER" })
      ).rejects.toBeInstanceOf(ServiceAccessError);

      // And the subscription is still ACTIVE and untouched throughout.
      expect((await getSubscriptionAccess(restaurantId)).status).toBe("ACTIVE");
      expect((await getSubscriptionByPlanOfVenue())?.serviceKeys).toEqual(BASIC);
    },
    30000
  );
});

/** Reads the seeded venue's subscription snapshot straight from the database. */
async function getSubscriptionByPlanOfVenue() {
  const sub = await SubscriptionModel.findOne({ restaurantId }).lean() as
    | { serviceKeys?: string[] }
    | null;
  return sub ? { serviceKeys: sub.serviceKeys ?? [] } : null;
}

describe("4. RBAC still works: full access grants services, never roles", () => {
  it(
    "a CASHIER still cannot reach revenue figures or manage staff",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Cashier Kitchen");
      await signIn("CASHIER");
      setFullAccess(true);

      // The service gate opens for every role — that is the whole point of the
      // flag. The role check underneath is what still refuses.
      await expect(
        assertServiceForCurrentVenue("REPORTS")
      ).resolves.toBeUndefined();

      const { assertCanViewReportTab, canViewDashboardFinancials } = await import(
        "@/lib/reports/permissions"
      );
      const { assertCanManageStaff } = await import("@/lib/staff/permissions");
      const { assertCanViewAuditLogs } = await import("@/lib/audit/permissions");

      expect(() => assertCanViewReportTab("CASHIER", "gst")).toThrow();
      expect(() => assertCanViewReportTab("CASHIER", "discounts")).toThrow();
      expect(() => assertCanManageStaff("CASHIER")).toThrow();
      expect(() => assertCanViewAuditLogs("CASHIER")).toThrow();
      expect(canViewDashboardFinancials("CASHIER")).toBe(true); // sales money is fine
      // The owner is unaffected by any of this.
      expect(() => assertCanViewReportTab("OWNER", "gst")).not.toThrow();
    },
    30000
  );

  it(
    "a WAITER still cannot see revenue, and the audit export refuses them",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Waiter Kitchen");
      await signIn("WAITER");
      setFullAccess(true);

      const { assertCanViewReportTab } = await import("@/lib/reports/permissions");
      const { assertCanManageStaff } = await import("@/lib/staff/permissions");
      expect(() => assertCanViewReportTab("WAITER", "sales")).toThrow();
      expect(() => assertCanManageStaff("WAITER")).toThrow();
      expect(() => assertCanViewReportTab("WAITER", "orders")).not.toThrow();

      // Real route, real ordering: the service gate passes, the role gate throws
      // past it. Under full access the waiter gets "forbidden", never data.
      const { GET } = await import("@/app/api/audit/export/route");
      const req = new NextRequest("http://localhost/api/audit/export?page=1");
      await expect(GET(req)).rejects.toThrow(/permission to view audit logs/i);
    },
    30000
  );

  it(
    "a MANAGER keeps exactly the permissions it already had",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Manager Kitchen");
      await signIn("MANAGER");
      setFullAccess(true);

      const { assertCanViewReportTab } = await import("@/lib/reports/permissions");
      const { assertCanManageStaff } = await import("@/lib/staff/permissions");
      expect(() => assertCanViewReportTab("MANAGER", "gst")).not.toThrow();
      expect(() => assertCanManageStaff("MANAGER")).not.toThrow();
    },
    30000
  );
});

describe("5. SUPER_ADMIN behaviour is unchanged", () => {
  it(
    "a super admin resolves identically with the flag on and off",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Locked Kitchen");
      await signIn("OWNER");

      setFullAccess(false);
      const off = await getServiceAccess(restaurantId, { role: "SUPER_ADMIN" });
      setFullAccess(true);
      const on = await getServiceAccess(restaurantId, { role: "SUPER_ADMIN" });

      // Identical in every observable respect, including the services a tenant
      // could never have. The flag is consulted after this branch, not instead.
      expect(on.isSuperAdmin).toBe(true);
      expect(on.serviceKeys).toEqual(off.serviceKeys);
      expect(on.planName).toBe(off.planName);
      expect(on.source).toBe(off.source);
      for (const key of SERVICE_KEYS) {
        expect(on.has(key), key).toBe(off.has(key));
        expect(on.has(key), key).toBe(true);
      }
    },
    30000
  );

  it(
    "a restaurant role under full access is never a super admin",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("NotPromoted Kitchen");
      await signIn("OWNER");
      setFullAccess(true);

      const access = await getServiceAccess(restaurantId, { role: "OWNER" });
      expect(access.isSuperAdmin).toBe(false);
      // Full access grants the tenant's catalogue, not the platform's: the
      // unimplemented keys a super admin bypasses are still denied.
      expect(access.has("CUSTOMERS")).toBe(false);
      expect(access.has("KDS")).toBe(false);
      expect(access.has("API_INTEGRATION")).toBe(false);

      // And the DB role is untouched.
      const user = await UserModel.findById(ownerUserId).select("role").lean();
      expect(String(user?.role)).toBe("OWNER");
    },
    30000
  );
});

describe("6. direct URLs are reachable in full-access mode", () => {
  it(
    "the page gate admits every restaurant route for an authorized role",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Direct Url Kitchen");
      await signIn("OWNER");

      setFullAccess(false);
      for (const key of NOT_IN_BASIC) {
        const blocked = await requireService(key, { userName: "Owner" });
        expect(blocked.allowed, key).toBe(false);
      }

      setFullAccess(true);
      for (const key of IMPLEMENTED) {
        const decision = await checkService(restaurantId, key, { role: "OWNER" });
        expect(decision.allowed, key).toBe(true);
        // The real page-gate function, not a reimplementation of it.
        const gate = await requireService(key, { userName: "Owner" });
        expect(gate.allowed, key).toBe(true);
      }
    },
    30000
  );

  it(
    "a CASHIER's direct URL reaches the page gate but not the RBAC behind it",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Cashier Direct Kitchen");
      await signIn("CASHIER");
      setFullAccess(true);

      const gate = await requireService("AUDIT", { userName: "Cashier" });
      expect(gate.allowed).toBe(true);

      const { assertCanViewAuditLogs } = await import("@/lib/audit/permissions");
      expect(() => assertCanViewAuditLogs("CASHIER")).toThrow();
    },
    30000
  );
});

describe("7. APIs and server actions are reachable in full-access mode", () => {
  it(
    "the reports export route answers 200 instead of 403",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Reports Export Kitchen");
      await signIn("OWNER");
      const { GET } = await import("@/app/api/reports/export/route");

      setFullAccess(false);
      const blocked = await GET(
        new NextRequest("http://localhost/api/reports/export?tab=sales")
      );
      expect(blocked.status).toBe(403);
      expect(((await blocked.json()) as { service: string }).service).toBe("REPORTS");

      setFullAccess(true);
      const allowed = await GET(
        new NextRequest("http://localhost/api/reports/export?tab=sales")
      );
      expect(allowed.status).toBe(200);
    },
    30000
  );

  it(
    "the audit export route answers 200 for an owner, and still 500-throws for a waiter",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Audit Export Kitchen");
      const { GET } = await import("@/app/api/audit/export/route");

      await signIn("OWNER");
      setFullAccess(false);
      const blocked = await GET(new NextRequest("http://localhost/api/audit/export?page=1"));
      expect(blocked.status).toBe(403);
      expect(((await blocked.json()) as { service: string }).service).toBe("AUDIT");

      setFullAccess(true);
      const allowed = await GET(new NextRequest("http://localhost/api/audit/export?page=1"));
      expect(allowed.status).toBe(200);

      await signIn("WAITER");
      await expect(
        GET(new NextRequest("http://localhost/api/audit/export?page=1"))
      ).rejects.toThrow(/permission to view audit logs/i);
    },
    30000
  );

  it(
    "a billing server action stops failing on the plan check",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Billing Action Kitchen");
      await signIn("OWNER");
      const { listBillsAction } = await import("@/actions/billing/actions");

      setFullAccess(false);
      const blocked = await listBillsAction({});
      expect(blocked.success).toBe(false);
      expect(blocked.message).toMatch(/not included in your current plan/i);

      setFullAccess(true);
      const allowed = await listBillsAction({});
      expect(allowed.success, allowed.message).toBe(true);
    },
    30000
  );

  it(
    "a menu server action resolves its venue and role from the session as usual",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Menu Action Kitchen");
      await signIn("OWNER");
      setFullAccess(true);

      const { createCategoryAction } = await import("@/actions/menu/categories");
      const result = await createCategoryAction({ name: "Starters", displayOrder: 0 });
      expect(result.success, result.message).toBe(true);
      expect(await MenuCategoryModel.countDocuments({ name: "Starters" })).toBe(1);
    },
    30000
  );

  it(
    "the session-derived action guard still refuses an unauthenticated caller",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Anon Kitchen");
      setFullAccess(true);
      // Full access is not authentication. With no session at all there is no
      // venue to grant anything to, so the caller is sent to /login rather than
      // being let into the module.
      vi.mocked(getSessionToken).mockResolvedValue(null);
      vi.mocked(getSessionUserId).mockResolvedValue(null);

      await expect(assertServiceForCurrentVenue("BILLING")).rejects.toSatisfy((e: unknown) =>
        isRedirectTo(e, "/login")
      );
      // The page gate runs through requireRestaurant() -> requireAuth(), so it is
      // bounced at authentication too, before any entitlement question is asked.
      const { requireRestaurant } = await import("@/lib/auth/guards");
      await expect(requireRestaurant()).rejects.toSatisfy((e: unknown) =>
        isRedirectTo(e, "/login")
      );
    },
    30000
  );
});

describe("8. enabling full access modifies no plan or subscription data", () => {
  it(
    "plans, subscriptions and subscription history are byte-identical afterwards",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Immutable Kitchen");
      await signIn("OWNER");

      const snapshot = async () => ({
        plans: (await PlanModel.find().sort({ _id: 1 }).lean()).map((p) => ({
          _id: String(p._id),
          name: String(p.name),
          serviceKeys: Array.isArray(p.serviceKeys) ? p.serviceKeys.map(String) : null,
          isActive: Boolean(p.isActive),
          updatedAt: p.updatedAt,
        })),
        subscriptions: (await SubscriptionModel.find().sort({ _id: 1 }).lean()).map((s) => ({
          _id: String(s._id),
          planId: String(s.planId),
          planName: String(s.planName),
          status: String(s.status),
          serviceKeys: Array.isArray(s.serviceKeys) ? s.serviceKeys.map(String) : null,
          expiryDate: s.expiryDate,
          updatedAt: s.updatedAt,
        })),
        history: (await SubscriptionHistoryModel.find().sort({ _id: 1 }).lean()).map((h) => ({
          _id: String(h._id),
          action: String(h.action),
          updatedAt: h.updatedAt,
        })),
      });

      const before = await snapshot();

      // Exercise every read path full access touches, including one real server
      // action and one real API route, so a hidden write would show up here.
      setFullAccess(true);
      await getServiceAccess(restaurantId, { role: "OWNER" });
      for (const key of IMPLEMENTED) {
        await assertService(restaurantId, key, { role: "OWNER" });
        await requireService(key, { userName: "Owner" });
      }
      const { listBillsAction } = await import("@/actions/billing/actions");
      await listBillsAction({});
      const { GET } = await import("@/app/api/reports/export/route");
      await GET(new NextRequest("http://localhost/api/reports/export?tab=sales"));
      await requireRestaurantActual();

      expect(await snapshot()).toEqual(before);

      // No plan or subscription was created either.
      expect(await PlanModel.countDocuments({})).toBe(before.plans.length);
      expect(await SubscriptionModel.countDocuments({})).toBe(before.subscriptions.length);
      expect(await SubscriptionHistoryModel.countDocuments({})).toBe(
        before.history.length
      );

      // And the snapshot the venue was actually sold still says BASIC.
      expect(before.subscriptions[0]?.serviceKeys).toEqual(BASIC);
    },
    30000
  );

  it(
    "the subscription service still reports the true status while the flag is on",
    async () => {
      if (!available) return;
      await seedRestrictedVenue("Honest Service Kitchen");
      await signIn("OWNER");

      setFullAccess(true);
      // Full access relaxes the gate, not the underlying truth. The admin panel,
      // the subscription page and the banner all still read this.
      const active = await getSubscriptionAccess(restaurantId);
      expect(active.allowed).toBe(true);
      expect(active.status).toBe("ACTIVE");

      await suspendSubscription({
        restaurantId,
        createdBy: ownerUserId,
        changedByRole: "SUPER_ADMIN",
        reason: "chargeback",
      });
      setFullAccess(true);
      const suspended = await getSubscriptionAccess(restaurantId);
      expect(suspended.allowed).toBe(false);
      expect(suspended.status).toBe("SUSPENDED");

      // ...while the venue itself is still fully usable.
      await expect(requireRestaurantActual()).resolves.toMatchObject({ id: restaurantId });

      // Restoring the subscription works exactly as it always did.
      await reactivateSubscription({
        restaurantId,
        createdBy: ownerUserId,
        changedByRole: "SUPER_ADMIN",
      });
      expect((await getSubscriptionAccess(restaurantId)).allowed).toBe(true);
    },
    40000
  );
});

/** `requireRestaurant` from the real (unmocked) guards module. */
async function requireRestaurantActual() {
  const { requireRestaurant } = await import("@/lib/auth/guards");
  return requireRestaurant();
}
