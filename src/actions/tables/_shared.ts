import { assertServiceForCurrentVenue } from "@/lib/services/access";
export interface ActionResult {
  success: boolean;
  message?: string;
  id?: string;
}

/**
 * Every tables action funnels through here, so this is the one place the
 * service gate has to live for the whole domain. It runs before the action body
 * and throws, which the existing catch turns into the same
 * `{ success: false, message }` shape every caller already handles.
 */
export async function wrapTableAction(
  fn: () => Promise<ActionResult>
): Promise<ActionResult> {
  try {
    await assertServiceForCurrentVenue("TABLES");
    return await fn();
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.name === "NEXT_REDIRECT" || error.message === "NEXT_REDIRECT")
    ) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Something went wrong.";
    return { success: false, message };
  }
}