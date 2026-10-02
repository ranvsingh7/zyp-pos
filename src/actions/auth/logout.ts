"use server";

import { redirect } from "next/navigation";
import {
  deleteSession,
  getSessionRestaurantId,
  getSessionUserId,
} from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/audit-service";

export async function logoutAction(): Promise<void> {
  const userId = await getSessionUserId();
  const restaurantId = await getSessionRestaurantId();
  await deleteSession();

  // LOGOUT is written after the cookie is gone: the audit trail is not bound
  // to the session, and the logout must not be lost if redirect throws.
  await writeAuditLog({
    restaurantId: restaurantId ?? undefined,
    actorUserId: userId ?? undefined,
    action: "LOGOUT",
    resourceType: "USER",
    resourceId: userId ?? undefined,
    reason: "User logged out.",
  });

  redirect("/login");
}