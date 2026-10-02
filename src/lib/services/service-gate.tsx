import "server-only";

/**
 * The page-level service gate.
 *
 * A restaurant page calls `requireService("REPORTS", { ...headerProps })` right
 * after `requireRestaurant()` and gets back either the go-ahead or a finished
 * locked page to return in its place.
 *
 * Split from `access.ts` for two reasons: the decision logic stays free of
 * React so it can be unit tested directly, and the gate lives in its own module
 * so a page's dependency on the locked UI is obvious at the call site.
 */
import type { ReactNode } from "react";
import { AppHeaderServer } from "@/components/app-header-server";
import { FeatureLocked } from "@/components/feature-locked";
import { requireRestaurant } from "@/lib/auth/guards";
import { getSessionRole } from "@/lib/auth/session";
import { checkService, type ResolvedServiceAccess } from "./access";
import type { ServiceKey } from "./catalog";

/** The same display props the page already passes to its header. */
export interface ServiceGateHeader {
  userName: string;
  restaurantName?: string | null;
  restaurantLogoUrl?: string | null;
}

export type ServiceGateResult =
  | { allowed: true; access: ResolvedServiceAccess }
  | { allowed: false; page: ReactNode };

/**
 * Runs after `requireRestaurant()`, so the caller is already authenticated,
 * bound to their own venue, and their subscription is live. All that is left to
 * decide is whether the plan covers this service.
 *
 * A denial returns a complete page rather than redirecting: "your plan is
 * smaller" is not an authentication failure, so the user stays signed in, keeps
 * their navigation, and is shown which plan they are on and how to upgrade.
 */
export async function requireService(
  key: ServiceKey,
  header: ServiceGateHeader
): Promise<ServiceGateResult> {
  const [role, restaurant] = await Promise.all([getSessionRole(), requireRestaurant()]);
  const decision = await checkService(restaurant.id, key, { role });
  if (decision.allowed) return { allowed: true, access: decision.access };
  return {
    allowed: false,
    page: (
      <div className="min-h-screen bg-background">
        <AppHeaderServer {...header} />
        <FeatureLocked service={decision.service} planName={decision.access.planName} />
      </div>
    ),
  };
}
