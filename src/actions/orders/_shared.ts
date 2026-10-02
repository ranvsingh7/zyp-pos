import { assertServiceForCurrentVenue } from "@/lib/services/access";
import type { OrderView, KotView } from "@/lib/orders/types";

export interface ActionResult {
  success: boolean;
  message?: string;
  id?: string;
  order?: OrderView;
  /** cancelKotAction: true when the order was emptied and cancelled too. */
  orderCancelled?: boolean;
  /** printKotAction / reprintKotAction / viewKotAction output. */
  kotNumber?: string;
  kotId?: string;
  html?: string;
  /** printKotAction: false means "no new items to print" (no KOT created). */
  hasPending?: boolean;
  /** listOrderKotsAction: stored KOT history for an order. */
  kots?: KotView[];
}

/**
 * Every orders action funnels through here, so this is the one place the
 * service gate has to live for the whole domain. It runs before the action body
 * and throws, which the existing catch turns into the same
 * `{ success: false, message }` shape every caller already handles.
 */
export async function wrapOrderAction(
  fn: () => Promise<ActionResult>
): Promise<ActionResult> {
  try {
    await assertServiceForCurrentVenue("ORDERS");
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