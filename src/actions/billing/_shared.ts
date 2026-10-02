import { assertServiceForCurrentVenue } from "@/lib/services/access";
import type { BillListItemView, BillView } from "@/lib/billing/types";

export interface BillingActionResult {
  success: boolean;
  message?: string;
  /** bill operations: the resulting bill (with embedded payments). */
  bill?: BillView | null;
  /** printBillAction: ready-to-print thermal HTML. */
  html?: string;
  /** listBillsAction: page of bills + total count. */
  bills?: BillListItemView[];
  total?: number;
}

/**
 * Every billing action funnels through here, so this is the one place the
 * service gate has to live for the whole domain. It runs before the action body
 * and throws, which the existing catch turns into the same
 * `{ success: false, message }` shape every caller already handles.
 */
export async function wrapBillingAction(
  fn: () => Promise<BillingActionResult>
): Promise<BillingActionResult> {
  try {
    await assertServiceForCurrentVenue("BILLING");
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