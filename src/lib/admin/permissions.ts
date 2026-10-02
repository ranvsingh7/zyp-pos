import "server-only";

import { redirect } from "next/navigation";
import { requireAuth, type CurrentUser } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/auth/roles";
import { AdminForbiddenError } from "./errors";

/**
 * Guard used by every platform admin page and server action. A restaurant user
 * (any tenant role) is redirected to their dashboard; anonymous users go to
 * /login first via requireAuth.
 */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireAuth();
  if (!isSuperAdmin(user.role)) {
    redirect("/dashboard");
  }
  return user;
}

/**
 * In-process assertion for server actions that already have a CurrentUser from
 * requireAuth — throws instead of redirecting so the caller can wrap the action.
 */
export async function assertSuperAdmin(
  user: CurrentUser | null | undefined
): Promise<CurrentUser> {
  if (!user) {
    redirect("/login");
  }
  if (!isSuperAdmin(user.role)) {
    throw new AdminForbiddenError();
  }
  return user;
}