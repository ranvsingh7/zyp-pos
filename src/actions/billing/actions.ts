"use server";

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import {
  assertCanReadBills,
  assertCanManageBills,
  assertCanCancelBills,
} from "@/lib/billing/permissions";
import {
  generateBill,
  getBill,
  getBillForOrder,
  recordPayment,
  completePayment,
  cancelBill,
  listBills,
  markBillPrinted,
} from "@/lib/billing/bill-service";
import { buildBillHtml, toLogoDataUri, type BillRestaurantHeader } from "@/lib/billing/print";
import { buildUpiPaymentQrDataUri } from "@/lib/billing/payment-qr";
import { getRestaurantLogo, getRestaurantUpiId } from "@/lib/settings/settings-service";
import {
  generateBillInputSchema,
  billIdInputSchema,
  recordPaymentInputSchema,
  completePaymentInputSchema,
  cancelBillInputSchema,
  listBillsInputSchema,
  firstZodMessage,
} from "@/lib/billing/validation";
import { RestaurantModel } from "@/models/Restaurant";
import type { BillView } from "@/lib/billing/types";
import { wrapBillingAction, type BillingActionResult } from "./_shared";

interface BillingContext {
  restaurantId: string;
  restaurantName: string;
  userId: string;
}

async function requireBillingContext(options?: {
  manage?: boolean;
  cancel?: boolean;
}): Promise<BillingContext> {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  if (options?.cancel) assertCanCancelBills(user.role);
  else if (options?.manage) assertCanManageBills(user.role);
  else assertCanReadBills(user.role);
  return {
    restaurantId: String(restaurant.id),
    restaurantName: restaurant.name,
    userId: String(user.id),
  };
}

/** Loads the full restaurant header for the 80mm bill print. */
/**
 * Restaurant identity for the printed slip. Resolved live from the
 * authenticated restaurant at print time — the same way the name, address and
 * phone already behave — so the logo and the payment QR are always the
 * restaurant's current ones and the bill snapshot is left untouched.
 */
async function loadBillHeader(bill: BillView): Promise<BillRestaurantHeader> {
  const restaurant = await requireRestaurant();
  const [doc, logo, upiId] = await Promise.all([
    RestaurantModel.findById(restaurant.id)
      .select("name address city state pincode phone gstin gstRegistered")
      .lean(),
    // A missing logo is not an error: the slip simply prints without one.
    getRestaurantLogo(String(restaurant.id)).catch(() => null),
    // Likewise for the UPI ID — scoped to this restaurant's own settings
    // document, resolved from the session rather than any submitted value.
    getRestaurantUpiId(String(restaurant.id)).catch(() => null),
  ]);
  const name = doc?.name ?? restaurant.name;
  return {
    name,
    address: doc?.address ?? null,
    city: doc?.city ?? null,
    state: doc?.state ?? null,
    pincode: doc?.pincode ?? null,
    phone: doc?.phone ?? null,
    gstin: doc?.gstin ?? null,
    logoDataUri: toLogoDataUri(logo),
    upiId,
    // The QR is prefilled with the bill's final payable total, so what the
    // customer scans matches exactly what the slip asks for.
    paymentQrDataUri: await buildUpiPaymentQrDataUri(upiId, name, bill.grandTotalPaise),
  };
}

export async function generateBillAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId, userId } = await requireBillingContext({ manage: true });
    const parsed = generateBillInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { orderId, ...discount } = parsed.data;
    const bill = await generateBill(restaurantId, orderId, userId, discount);
    return { success: true, bill };
  });
}

export async function getBillAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId } = await requireBillingContext();
    const parsed = billIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const bill = await getBill(restaurantId, parsed.data.billId);
    if (!bill) return { success: false, message: "Bill not found." };
    return { success: true, bill };
  });
}

export async function getBillForOrderAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId } = await requireBillingContext();
    const parsed = generateBillInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const bill = await getBillForOrder(restaurantId, parsed.data.orderId);
    return { success: true, bill };
  });
}

export async function listBillsAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId } = await requireBillingContext();
    const parsed = listBillsInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const result = await listBills(restaurantId, parsed.data);
    return { success: true, bills: result.bills, total: result.total };
  });
}

export async function recordPaymentAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId, userId } = await requireBillingContext({ manage: true });
    const parsed = recordPaymentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { billId, ...payment } = parsed.data;
    const bill = await recordPayment(restaurantId, billId, userId, payment);
    return { success: true, bill };
  });
}

export async function completePaymentAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId, userId } = await requireBillingContext({ manage: true });
    const parsed = completePaymentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { billId, ...payment } = parsed.data;
    const bill = await completePayment(restaurantId, billId, userId, payment);
    return { success: true, bill };
  });
}

export async function cancelBillAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId, userId } = await requireBillingContext({ cancel: true });
    const parsed = cancelBillInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const bill = await cancelBill(
      restaurantId,
      parsed.data.billId,
      userId,
      parsed.data.reason
    );
    return { success: true, bill };
  });
}

/** PRINTS / REPRINTS a bill from its stored snapshot only (never the live order). */
export async function printBillAction(input: unknown): Promise<BillingActionResult> {
  return wrapBillingAction(async () => {
    const { restaurantId } = await requireBillingContext({ manage: true });
    const parsed = billIdInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const bill = await markBillPrinted(restaurantId, parsed.data.billId);
    const html = buildBillHtml(bill, await loadBillHeader(bill));
    return { success: true, bill, html };
  });
}