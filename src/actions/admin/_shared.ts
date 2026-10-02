import { requireSuperAdmin } from "@/lib/admin/permissions";
import type { CurrentUser } from "@/lib/auth/guards";

/**
 * Server-action wrapper shared by all platform admin actions: every admin
 * action first resolves the SUPER_ADMIN session, which also provides the
 * actor id written to history + audit rows. Returns the resolved admin when
 * the caller needs it; throws (redirect) otherwise.
 */
export async function resolveAdmin(): Promise<CurrentUser> {
  return requireSuperAdmin();
}

export function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NEXT_REDIRECT" || error.message === "NEXT_REDIRECT")
  );
}

export interface ActionResult {
  success?: boolean;
  message?: string;
  id?: string;
}

/** Swallows non-redirect errors so forms render messages instead of crashing. */
export async function wrapAdminAction(
  fn: () => Promise<ActionResult>
): Promise<ActionResult> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    return {
      success: false,
      message: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}