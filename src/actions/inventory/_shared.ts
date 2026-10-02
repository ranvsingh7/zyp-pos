import { assertServiceForCurrentVenue } from "@/lib/services/access";
export interface ActionResult {
  success: boolean;
  message?: string;
  id?: string;
}

export interface DataActionResult<T> {
  success: boolean;
  message?: string;
  data?: T;
}

function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NEXT_REDIRECT" || error.message === "NEXT_REDIRECT")
  );
}

/**
 * Every inventory action funnels through one of these two wrappers, so the
 * service gate lives here rather than in each of the many action files. It runs
 * before the action body and throws, which the existing catch turns into the
 * same `{ success: false, message }` shape callers already handle.
 */
export async function wrapInventoryAction(
  fn: () => Promise<ActionResult>
): Promise<ActionResult> {
  try {
    await assertServiceForCurrentVenue("INVENTORY");
    return await fn();
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    return {
      success: false,
      message: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

export async function wrapDataAction<T>(
  fn: () => Promise<DataActionResult<T>>
): Promise<DataActionResult<T>> {
  try {
    await assertServiceForCurrentVenue("INVENTORY");
    return await fn();
  } catch (error: unknown) {
    if (isRedirectError(error)) throw error;
    return {
      success: false,
      message: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}
