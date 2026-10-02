"use server";

import { getSessionRestaurantId } from "@/lib/auth/session";
import { getSubscriptionAccess } from "@/lib/admin/subscription-service";

export interface SubscriptionBannerInfo {
  status: "EXPIRING" | "GRACE_PERIOD";
  daysLeft: number;
  expiryDate: string | null;
  planName: string | null;
}

/**
 * Banner-only subscription snapshot for the signed-in tenant. Returns null when
 * there is nothing to warn about (no session, no restaurant, or a healthy /
 * already-blocked subscription — blocked venues are redirected to the blocked
 * page by requireRestaurant before they can reach an app page).
 */
export async function getSubscriptionBannerInfo(): Promise<SubscriptionBannerInfo | null> {
  const restaurantId = await getSessionRestaurantId();
  if (!restaurantId) return null;

  const access = await getSubscriptionAccess(restaurantId);
  if (access.status !== "EXPIRING" && access.status !== "GRACE_PERIOD") {
    return null;
  }
  return {
    status: access.status,
    daysLeft: access.daysLeft,
    expiryDate: access.expiryDate ? access.expiryDate.toISOString() : null,
    planName: access.planName,
  };
}