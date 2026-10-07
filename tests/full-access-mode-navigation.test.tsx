/**
 * FULL_ACCESS_MODE — navigation, end to end through the real server wrapper.
 *
 * Separate from `full-access-mode.e2e.test.tsx` for one reason: `AppHeader` is a
 * client component that calls `usePathname()`, which needs a router context that
 * only exists inside a Next.js request. Mocking `usePathname` here keeps
 * `redirect()` (used by the auth guards the other suite exercises) real.
 *
 * The point of the suite is that navigation is not special-cased. The header is
 * handed `getServiceAccess(...).serviceKeys`, so flipping the one switch changes
 * what is visible with no navigation logic of its own. These tests assert that
 * the wiring holds in both directions, and that the resolver feeding it is the
 * same one the page gates and API routes use.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, usePathname: () => "/dashboard" };
});

vi.mock("@/lib/auth/session", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/session")>("@/lib/auth/session");
  // getSessionTokenVersion must be stubbed as well: `loadUser` reads it to check
  // for session revocation, and the real one calls `cookies()`, which throws
  // outside a request scope. No reset has happened here, so 0 is correct.
  return {
    ...actual,
    getSessionToken: vi.fn(),
    getSessionUserId: vi.fn(),
    getSessionRole: vi.fn(),
    getSessionTokenVersion: vi.fn(async () => 0),
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
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createPlan } from "@/lib/admin/plan-service";
import { createSubscription } from "@/lib/admin/subscription-service";
import { getServiceAccess } from "@/lib/services/access";
import { AppHeaderServer } from "@/components/app-header-server";
import { AppHeader } from "@/components/app-header";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { BASIC_DEFAULT_SERVICE_KEYS, listActiveServices } from "@/lib/services/catalog";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_full_access_nav_e2e";

/** Every restaurant-facing route the header links to. */
const ALL_ROUTES = [
  "/dashboard",
  "/pos",
  "/orders",
  "/menu",
  "/tables",
  "/inventory",
  "/billing",
  "/kot",
  "/reports",
  "/audit",
] as const;

const BASIC = [...BASIC_DEFAULT_SERVICE_KEYS];

let available = false;
let restaurantId = "";
let ownerUserId = "";

function setFullAccess(on: boolean) {
  vi.stubEnv("FULL_ACCESS_MODE", on ? "true" : "false");
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
  setFullAccess(false);
  if (!available) return;
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await PlanModel.deleteMany({});
  await SubscriptionModel.deleteMany({});
  await PlatformCounterModel.deleteMany({});
  vi.mocked(getSessionToken).mockReset();
  vi.mocked(getSessionUserId).mockReset();
  vi.mocked(getSessionRole).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seedBasicVenueAndSignIn(): Promise<void> {
  const user = await UserModel.create({
    fullName: "Owner",
    email: `nav-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
  });
  ownerUserId = String(user._id);
  const { restaurantId: id } = await createRestaurantForUser(ownerUserId, {
    name: "Nav Kitchen",
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
  restaurantId = id;
  const plan = await createPlan({
    name: `BASIC ${Date.now()}`,
    description: "nav test plan",
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
  const token = await encryptSession({ userId: ownerUserId, restaurantId, role: "OWNER" });
  vi.mocked(getSessionToken).mockResolvedValue(token);
  vi.mocked(getSessionUserId).mockResolvedValue(ownerUserId);
  vi.mocked(getSessionRole).mockResolvedValue("OWNER");
}

describe("navigation under FULL_ACCESS_MODE", () => {
  it(
    "OFF: a BASIC owner only sees the modules their plan includes",
    async () => {
      if (!available) return;
      await seedBasicVenueAndSignIn();
      setFullAccess(false);

      const access = await getServiceAccess(restaurantId, "OWNER");
      const html = renderToStaticMarkup(
        <AppHeader userName="Owner" serviceKeys={access.serviceKeys} />
      );
      expect(html).toContain('href="/pos"');
      expect(html).toContain('href="/menu"');
      // Hidden by the plan, exactly as before this flag existed.
      for (const href of ["/inventory", "/billing", "/kot", "/reports"]) {
        expect(html, href).not.toContain(`href="${href}"`);
      }
    },
    30000
  );

  it(
    "ON: the same owner sees every implemented module, from the same resolver",
    async () => {
      if (!available) return;
      await seedBasicVenueAndSignIn();
      setFullAccess(true);

      const access = await getServiceAccess(restaurantId, "OWNER");
      expect(access.serviceKeys).toEqual(listActiveServices().map((s) => s.key));

      // The real server wrapper, not a hand-fed prop list.
      const html = renderToStaticMarkup(
        await AppHeaderServer({ userName: "Owner", restaurantName: "Nav Kitchen" })
      );
      for (const href of ALL_ROUTES) {
        expect(html, href).toContain(`href="${href}"`);
      }
      // Nothing was removed: settings is unserviced and was always shown.
      expect(html).toContain('href="/settings"');
    },
    30000
  );

  it(
    "ON: the dashboard quick actions unhide too, with no second filter",
    async () => {
      if (!available) return;
      await seedBasicVenueAndSignIn();

      setFullAccess(false);
      const locked = await getServiceAccess(restaurantId, "OWNER");
      const lockedHtml = renderToStaticMarkup(
        <QuickActions serviceKeys={locked.serviceKeys} />
      );
      expect(lockedHtml).not.toContain('href="/billing"');
      expect(lockedHtml).not.toContain('href="/reports"');

      setFullAccess(true);
      const open = await getServiceAccess(restaurantId, "OWNER");
      const openHtml = renderToStaticMarkup(<QuickActions serviceKeys={open.serviceKeys} />);
      expect(openHtml).toContain('href="/billing"');
      expect(openHtml).toContain('href="/reports"');
    },
    30000
  );

  it(
    "a SUPER_ADMIN header is unchanged by the flag",
    async () => {
      if (!available) return;
      await seedBasicVenueAndSignIn();

      setFullAccess(false);
      const superOff = await getServiceAccess(restaurantId, "SUPER_ADMIN");
      setFullAccess(true);
      const superOn = await getServiceAccess(restaurantId, "SUPER_ADMIN");

      // A super admin's resolved entitlements carry no service list at all (they
      // bypass by `has`, not by being granted everything), and that is preserved:
      // AppHeaderServer keeps passing an empty list, and the header falls back to
      // showing every nav item. Both modes agree.
      expect(superOn.serviceKeys).toEqual(superOff.serviceKeys);
      expect(superOn.isSuperAdmin).toBe(true);
      expect(superOff.serviceKeys).toEqual([]);
    },
    30000
  );
});
