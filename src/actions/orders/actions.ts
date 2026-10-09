"use server";

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import {
  assertCanOperateOrders,
  assertCanCancelOrders,
} from "@/lib/orders/permissions";
import {
  getOrder,
  createOrder,
  updateOrder,
  holdOrder,
  resumeOrder,
  cancelOrder,
  moveOrderToTable,
} from "@/lib/orders/order-service";
import {
  printPendingKot,
  listOrderKots,
  listKots,
  getKot,
  markKotPrinted,
  markKotSent,
  cancelKot,
  buildKotHtml,
} from "@/lib/orders/kot-service";
import {
  createOrderInputSchema,
  updateOrderInputSchema,
  holdOrderInputSchema,
  resumeOrderInputSchema,
  cancelOrderInputSchema,
  moveOrderInputSchema,
  printKotInputSchema,
  kotIdInputSchema,
  cancelKotInputSchema,
  kotListInputSchema,
  firstZodMessage,
} from "@/lib/orders/validation";
import { wrapOrderAction, type ActionResult } from "./_shared";

async function requireOrderContext(cancel?: boolean) {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  assertCanOperateOrders(user.role);
  if (cancel) assertCanCancelOrders(user.role);
  return {
    restaurantId: String(restaurant.id),
    restaurantName: restaurant.name,
    userId: String(user.id),
    role: user.role,
  };
}

export async function createOrderAction(
  input: unknown
): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId, userId } = await requireOrderContext();
    const parsed = createOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const order = await createOrder(restaurantId, userId, parsed.data);
    return { success: true, id: order.id, order };
  });
}

export async function updateOrderAction(
  input: unknown
): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId, userId } = await requireOrderContext();
    const parsed = updateOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { orderId, ...fields } = parsed.data;
    const order = await updateOrder(restaurantId, orderId, fields, userId);
    return { success: true, id: order.id, order };
  });
}

export async function holdOrderAction(
  input: unknown
): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId } = await requireOrderContext();
    const parsed = holdOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const order = await holdOrder(restaurantId, parsed.data.orderId);
    return { success: true, id: order.id, order };
  });
}

export async function resumeOrderAction(
  input: unknown
): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId } = await requireOrderContext();
    const parsed = resumeOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const order = await resumeOrder(restaurantId, parsed.data.orderId);
    return { success: true, id: order.id, order };
  });
}

export async function cancelOrderAction(
  input: unknown
): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId, userId } = await requireOrderContext(true);
    const parsed = cancelOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const order = await cancelOrder(
      restaurantId,
      parsed.data.orderId,
      userId,
      parsed.data.reason
    );
    return { success: true, id: order.id, order };
  });
}

export async function moveOrderAction(
  input: unknown
): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId } = await requireOrderContext();
    const parsed = moveOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const order = await moveOrderToTable(
      restaurantId,
      parsed.data.orderId,
      parsed.data.destinationTableId
    );
    return { success: true, id: order.id, order };
  });
}

/**
 * Manual PRINT KOT — prints a NEW, incremental KOT. Only runs for a saved
 * order. The server computes the pending (previously unprinted) quantities,
 * snapshots them into a new KOT (K-001, K-002, …), and atomically marks those
 * quantities as printed. Order status is never changed. When there is nothing
 * pending the action reports hasPending:false and creates no KOT.
 */
export async function printKotAction(input: unknown): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId, restaurantName, userId, role } = await requireOrderContext();
    const parsed = printKotInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { kot, hasPending } = await printPendingKot(
      restaurantId,
      parsed.data.orderId,
      userId,
      role
    );
    if (!hasPending || !kot) {
      return { success: true, hasPending: false, message: "No new items to print." };
    }
    const html = buildKotHtml({ restaurantName, kot });
    const order = await getOrder(restaurantId, parsed.data.orderId);
    return {
      success: true,
      hasPending: true,
      kotNumber: kot.kotNumber,
      kotId: kot.id,
      html,
      order: order ?? undefined,
    };
  });
}

/** REPRINT an existing KOT: prints the stored snapshot, never the live order. */
export async function reprintKotAction(input: unknown): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId, restaurantName } = await requireOrderContext();
    const parsed = kotIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const kot = await markKotPrinted(restaurantId, parsed.data.kotId);
    const html = buildKotHtml({ restaurantName, kot });
    return { success: true, kotNumber: kot.kotNumber, kotId: kot.id, html };
  });
}

/** MARK KOT AS SENT: updates KOT state from PENDING to SENT. */
export async function markKotSentAction(input: unknown): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId } = await requireOrderContext();
    const parsed = kotIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const kot = await markKotSent(restaurantId, parsed.data.kotId);
    return { success: true, kotNumber: kot.kotNumber, kotId: kot.id, state: kot.state };
  });
}

/**
 * CANCEL KOT — non-destructive: marks the KOT CANCELLED and records an
 * optional reason. The original snapshot stays in KOT history; the KOT can no
 * longer be reprinted or cancelled again. The cancelled KOT's quantities are
 * removed from the active order (total recomputed); if that empties the order
 * it is cancelled in turn and the returned `order` is null with
 * `orderCancelled` true. Otherwise the refreshed order view is returned so the
 * POS cart can reflect the removal.
 */
export async function cancelKotAction(input: unknown): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId, userId } = await requireOrderContext(true);
    const parsed = cancelKotInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { kot, orderId, orderCancelled } = await cancelKot(
      restaurantId,
      parsed.data.kotId,
      userId,
      { reason: parsed.data.reason || undefined }
    );
    const order = orderCancelled ? null : await getOrder(restaurantId, orderId);
    return {
      success: true,
      kotNumber: kot.kotNumber,
      kotId: kot.id,
      status: kot.status,
      order: order ?? undefined,
      orderCancelled,
    };
  });
}

/** VIEW an existing KOT: renders its stored snapshot without counting a print. */
export async function viewKotAction(input: unknown): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId, restaurantName } = await requireOrderContext();
    const parsed = kotIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const kot = await getKot(restaurantId, parsed.data.kotId);
    const html = buildKotHtml({ restaurantName, kot });
    return { success: true, kotNumber: kot.kotNumber, kotId: kot.id, html };
  });
}

/** KOT history for an order, oldest first (stored snapshots only). */
export async function listOrderKotsAction(input: unknown): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId } = await requireOrderContext();
    const parsed = printKotInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const kots = await listOrderKots(restaurantId, parsed.data.orderId);
    return { success: true, kots };
  });
}

/**
 * Tenant-wide KOT feed for the Kitchen page (newest printed first). Every staff
 * role may view their own restaurant's kitchen tickets.
 */
export async function listKotsAction(input: unknown): Promise<ActionResult> {
  return wrapOrderAction(async () => {
    const { restaurantId } = await requireOrderContext();
    const parsed = kotListInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const kots = await listKots(restaurantId, parsed.data.limit);
    return { success: true, kots };
  });
}