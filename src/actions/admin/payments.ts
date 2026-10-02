"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/permissions";
import {
  recordPayment,
  updatePayment,
  refundPayment,
} from "@/lib/admin/payment-service";
import { recordPaymentSchema, updatePaymentSchema } from "@/lib/admin/query";
import { wrapAdminAction } from "./_shared";

export interface PaymentActionState {
  success?: boolean;
  message?: string;
  paymentId?: string;
  invoiceNumber?: string;
  _errors?: Record<string, string[]>;
}

export async function recordPaymentAction(
  formData: FormData
): Promise<PaymentActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = recordPaymentSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      subscriptionId: formData.get("subscriptionId"),
      amountPaise: formData.get("amountPaise"),
      paymentMethod: formData.get("paymentMethod"),
      transactionReference: formData.get("transactionReference"),
      paidAt: formData.get("paidAt"),
      note: formData.get("note"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const payment = await recordPayment({
      restaurantId: parsed.data.restaurantId,
      subscriptionId: parsed.data.subscriptionId,
      amountPaise: parsed.data.amountPaise,
      paymentMethod: parsed.data.paymentMethod,
      transactionReference: parsed.data.transactionReference ?? null,
      paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
      note: parsed.data.note ?? null,
      createdBy: admin.id,
    });
    revalidatePath("/admin/payments");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return {
      success: true,
      paymentId: payment.paymentId,
      invoiceNumber: payment.invoiceNumber,
    };
  });
}

export async function updatePaymentAction(
  formData: FormData
): Promise<PaymentActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = updatePaymentSchema.safeParse({
      paymentId: formData.get("paymentId"),
      amountPaise: formData.get("amountPaise"),
      paymentMethod: formData.get("paymentMethod"),
      transactionReference: formData.get("transactionReference"),
      status: formData.get("status"),
      paidAt: formData.get("paidAt"),
      note: formData.get("note"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const payment = await updatePayment({
      paymentId: parsed.data.paymentId,
      amountPaise: parsed.data.amountPaise ?? undefined,
      paymentMethod: parsed.data.paymentMethod ?? undefined,
      transactionReference: parsed.data.transactionReference ?? undefined,
      status: parsed.data.status ?? undefined,
      paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : undefined,
      note: parsed.data.note ?? undefined,
      createdBy: admin.id,
    });
    revalidatePath("/admin/payments");
    return {
      success: true,
      paymentId: payment.paymentId,
      invoiceNumber: payment.invoiceNumber,
    };
  });
}

export async function refundPaymentAction(
  paymentId: string,
  note?: string
): Promise<PaymentActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const payment = await refundPayment(paymentId, {
      createdBy: admin.id,
      note,
    });
    revalidatePath("/admin/payments");
    return {
      success: true,
      paymentId: payment.paymentId,
      invoiceNumber: payment.invoiceNumber,
    };
  });
}