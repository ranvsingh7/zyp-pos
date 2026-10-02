import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { UserModel, type User } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { LOGO_ROUTE_PATH } from "@/lib/settings/constants";
import { isFullAccessMode } from "@/lib/config/full-access";
import type { Role, UserRole } from "./roles";

const PUBLIC_ROLE_ATTRS = "_id fullName email phone role restaurantId isActive createdAt updatedAt";

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  restaurantId: string | null;
  isActive: boolean;
}

function toCurrentUser(doc: {
  _id: unknown;
  fullName: string;
  email: string;
  phone?: string | null;
  role: string;
  restaurantId?: unknown;
  isActive: boolean;
}): CurrentUser {
  return {
    id: String(doc._id),
    fullName: doc.fullName,
    email: doc.email,
    phone: doc.phone ?? null,
    role: doc.role as Role,
    restaurantId: doc.restaurantId ? String(doc.restaurantId) : null,
    isActive: doc.isActive,
  };
}

function logAuth(step: string, detail?: Record<string, unknown> | string) {
  const suffix = typeof detail === "string" ? detail : JSON.stringify(detail ?? {});
  console.log(`[auth-guard] ${step} ${suffix}`);
}

async function loadUser(): Promise<CurrentUser | null> {
  const { getSessionToken, getSessionUserId } = await import("@/lib/auth/session");
  const token = await getSessionToken();
  const userId = await getSessionUserId();

  if (!token) {
    logAuth("no session cookie -> unauthenticated", { step: "loadUser" });
    return null;
  }
  if (!userId) {
    logAuth("session cookie present but JWT invalid/expired", { step: "loadUser" });
    return null;
  }

  logAuth("valid session cookie", { userId, step: "loadUser" });

  try {
    await connectDB();
    const user = await UserModel.findById(userId).select(PUBLIC_ROLE_ATTRS).lean();
    if (!user) {
      logAuth("DB user not found for session", { userId, step: "loadUser" });
      return null;
    }

    const typed = user as unknown as {
      _id: unknown;
      fullName: string;
      email: string;
      phone?: string | null;
      role: string;
      restaurantId?: unknown;
      isActive: boolean;
    };
    const current = toCurrentUser(typed);
    logAuth("user loaded", {
      userId: current.id,
      restaurantId: current.restaurantId ?? null,
      role: current.role,
      isActive: current.isActive,
      step: "loadUser",
    });
    return current;
  } catch (err) {
    // Fail closed: DB unreachable must NOT look like "logged out" (would cause a
    // proxy redirect loop between /dashboard -> /login and back).
    logAuth("database unavailable while loading user -> fail closed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
      step: "loadUser",
    });
    throw new Error("Unable to verify session: database unavailable.", { cause: err });
  }
}

export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    return loadUser();
  }
);

export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const { getSessionToken } = await import("@/lib/auth/session");
    const hasCookie = Boolean(await getSessionToken());
    if (hasCookie) {
      // Cookie exists but no valid DB user -> clear it so the proxy doesn't
      // bounce the still-present JWT back into a redirect loop.
      logAuth("redirect -> /api/auth/signout", {
        step: "requireAuth",
        reason: "session-cookie-present-but-user-invalid",
      });
      redirect("/api/auth/signout?error=session_expired");
    }
    logAuth("redirect -> /login", {
      step: "requireAuth",
      reason: "no-session",
    });
    redirect("/login");
  }
  if (!user.isActive) {
    logAuth("redirect -> /api/auth/signout", {
      step: "requireAuth",
      reason: "account_deactivated",
      userId: user.id,
    });
    redirect("/api/auth/signout?error=account_deactivated");
  }
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireAuth();
  if (roles.length > 0 && !roles.includes(user.role)) {
    redirect("/dashboard");
  }
  return user;
}

export interface CurrentRestaurant {
  id: string;
  name: string;
  ownerId: string;
  phone: string;
  email: string | null;
  logoUrl: string | null;
}

export const getCurrentRestaurant = cache(
  async (): Promise<CurrentRestaurant | null> => {
    const user = await getCurrentUser();
    if (!user?.restaurantId) return null;

    try {
      await connectDB();
      const restaurant = await RestaurantModel.findById(user.restaurantId)
        .select("_id name ownerId phone email logo.mimeType")
        .lean();
      if (!restaurant) return null;

      const r = restaurant as unknown as {
        _id: unknown;
        name: string;
        ownerId: unknown;
        phone: string;
        email?: string | null;
        logo?: { mimeType?: string | null } | null;
      };
      return {
        id: String(r._id),
        name: r.name,
        ownerId: String(r.ownerId),
        phone: r.phone,
        email: r.email ?? null,
        // Projecting only the metadata lets the header link the logo without
        // ever pulling the binary into the server render; the bytes themselves
        // are served by the authenticated settings logo route.
        logoUrl: r.logo?.mimeType ? LOGO_ROUTE_PATH : null,
      };
    } catch (err) {
      // Fail closed: DB unreachable must not look like "no restaurant" (the
      // proxy would bounce /onboarding back to /dashboard and loop).
      logAuth("database unavailable while loading restaurant -> fail closed", {
        restaurantId: user.restaurantId,
        error: err instanceof Error ? err.message : String(err),
        step: "getCurrentRestaurant",
      });
      throw new Error("Unable to verify restaurant: database unavailable.", {
        cause: err,
      });
    }
  }
);

export async function requireRestaurant(): Promise<CurrentRestaurant> {
  const user = await requireAuth();
  if (!user.restaurantId) {
    logAuth("redirect -> /onboarding/restaurant", {
      step: "requireRestaurant",
      reason: "no-restaurant",
      userId: user.id,
    });
    redirect("/onboarding/restaurant");
  }
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) {
    logAuth("redirect -> /api/auth/signout", {
      step: "requireRestaurant",
      reason: "restaurant-not-found",
      userId: user.id,
    });
    redirect("/api/auth/signout?error=restaurant_not_found");
  }
  // Subscription enforcement: an expired/suspended/cancelled plan blocks the
  // venue before any app page or action can run. A missing subscription is
  // treated as an open trial so existing self-onboarded restaurants are never
  // locked out unexpectedly.
  //
  // TEMPORARY: `FULL_ACCESS_MODE=true` skips this lifecycle gate so an expired or
  // unprovisioned venue can still be driven through every module. This is the
  // only place the flag is honoured for subscription *status* — service
  // entitlements are handled by `getServiceAccess()`. The subscription service
  // itself is deliberately left alone, so it keeps reporting the true status to
  // the admin panel, the subscription view and the banner, and no plan, snapshot
  // or history document is touched. See `src/lib/config/full-access.ts`.
  if (!isFullAccessMode()) {
    const { getSubscriptionAccess } = await import("@/lib/admin/subscription-service");
    const access = await getSubscriptionAccess(restaurant.id);
    if (!access.allowed) {
      logAuth("redirect -> /subscription-blocked", {
        step: "requireRestaurant",
        reason: `subscription-${access.status.toLowerCase()}`,
        restaurantId: restaurant.id,
      });
      redirect("/subscription-blocked");
    }
  } else {
    logAuth("subscription lifecycle check skipped (FULL_ACCESS_MODE)", {
      step: "requireRestaurant",
      restaurantId: restaurant.id,
    });
  }
  logAuth("granted restaurant access", {
    restaurantId: restaurant.id,
    step: "requireRestaurant",
  });
  return restaurant;
}

export async function assertOwnerOfRestaurant(
  restaurantId: string
): Promise<void> {
  const user = await requireAuth();
  if (!user.restaurantId || user.restaurantId !== restaurantId) {
    redirect("/dashboard");
  }
}

export function serializeUser(
  user: User
): CurrentUser {
  return toCurrentUser(user as unknown as Parameters<typeof toCurrentUser>[0]);
}