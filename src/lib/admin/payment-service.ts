import "server-only";

import type { QueryFilter } from "mongoose";
import { connectDB } from "@/lib/db";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionPaymentModel, type SubscriptionPayment } from "@/models/SubscriptionPayment";
import type {
  SubscriptionPaymentMethod,
  SubscriptionPaymentStatus,
} from "./constants";
import { SUBSCRIPTION_PAYMENT_METHODS, SUBSCRIPTION_PAYMENT_STATUSES } from "./constants";
import {
  PaymentNotFoundError,
  PaymentValidationError,
  SubscriptionNotFoundError,
} from "./errors";
import { nextSubscriptionInvoiceNumber } from "./invoice";
import { logPlatformAudit } from "./audit";

export interface PaymentView {
  paymentId: string;
  restaurantId: string;
  restaurantName: string;
  subscriptionId: string;
  invoiceNumber: string;
  amountPaise: number;
  paymentMethod: SubscriptionPaymentMethod;
  transactionReference: string | null;
  periodStartDate: Date | null;
  periodEndDate: Date | null;
  status: SubscriptionPaymentStatus;
  paidAt: Date | null;
  note: string | null;
  createdAt: Date;
}

export interface PaymentFilters {
  search?: string;
  status?: string;
  restaurantId?: string;
  subscriptionId?: string;
  page?: number;
  pageSize?: number;
}

export async function listPayments(
  filters: PaymentFilters = {}
): Promise<{ items: PaymentView[]; total: number; page: number; pageSize: number }> {
  await connectDB();
  const page = Math.max(1, Number(filters.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(filters.pageSize ?? 25)));

  const query: QueryFilter<SubscriptionPayment> = {};
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.restaurantId) {
    query.restaurantId = filters.restaurantId;
  }
  if (filters.subscriptionId) {
    query.subscriptionId = filters.subscriptionId;
  }
  if (filters.search?.trim()) {
    query.$or = [
      { invoiceNumber: { $regex: filters.search.trim(), $options: "i" } },
      { transactionReference: { $regex: filters.search.trim(), $options: "i" } },
    ];
  }

  const [payments, total, restaurantDocs] = await Promise.all([
    SubscriptionPaymentModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    SubscriptionPaymentModel.countDocuments(query),
    import("@/models/Restaurant").then(({ RestaurantModel }) =>
      RestaurantModel.find().select("_id name").lean()
    ),
  ]);
  const nameById = new Map(
    restaurantDocs.map((r) => [String(r._id), String(r.name)])
  );

  const items = payments.map((p) => toView(p, nameById.get(String(p.restaurantId)) ?? "Restaurant"));
  return { items, total, page, pageSize };
}

export async function getPaymentById(paymentId: string): Promise<PaymentView | null> {
  await connectDB();
  const payment = await SubscriptionPaymentModel.findById(paymentId).lean();
  if (!payment) return null;
  return toView(payment, "Restaurant");
}

function toView(
  p: {
    _id?: unknown;
    restaurantId?: unknown;
    subscriptionId?: unknown;
    invoiceNumber?: unknown;
    amountPaise?: unknown;
    paymentMethod?: unknown;
    transactionReference?: unknown;
    periodStartDate?: unknown;
    periodEndDate?: unknown;
    status?: unknown;
    paidAt?: unknown;
    note?: unknown;
    createdAt?: unknown;
  },
  restaurantName: string
): PaymentView {
  return {
    paymentId: String(p._id),
    restaurantId: String(p.restaurantId),
    restaurantName,
    subscriptionId: String(p.subscriptionId),
    invoiceNumber: String(p.invoiceNumber),
    amountPaise: Number(p.amountPaise ?? 0),
    paymentMethod: p.paymentMethod as SubscriptionPaymentMethod,
    transactionReference: p.transactionReference ? String(p.transactionReference) : null,
    periodStartDate: p.periodStartDate ? new Date(p.periodStartDate as string | number | Date) : null,
    periodEndDate: p.periodEndDate ? new Date(p.periodEndDate as string | number | Date) : null,
    status: p.status as SubscriptionPaymentStatus,
    paidAt: p.paidAt ? new Date(p.paidAt as string | number | Date) : null,
    note: p.note ? String(p.note) : null,
    createdAt: new Date(p.createdAt as string | number | Date),
  };
}

/**
 * A bank/UPI reference identifies one payment platform-wide. The unique partial
 * index in the model is the hard guarantee; this check exists so the admin gets
 * a readable message instead of a raw duplicate-key error.
 */
async function assertReferenceAvailable(
  transactionReference: string | null | undefined,
  excludePaymentId?: string
): Promise<void> {
  const reference = transactionReference?.trim();
  if (!reference) return;
  const filter: Record<string, unknown> = { transactionReference: reference };
  if (excludePaymentId) filter._id = { $ne: excludePaymentId };
  const existing = await SubscriptionPaymentModel.findOne(filter).select("_id").lean();
  if (existing) {
    throw new PaymentValidationError("That payment reference is already recorded.");
  }
}

export interface RecordPaymentInput {
  restaurantId: string;
  subscriptionId: string;
  amountPaise: number;
  paymentMethod: SubscriptionPaymentMethod;
  transactionReference?: string | null;
  paidAt?: Date | null;
  note?: string | null;
  createdBy?: string | null;
}

/**
 * Records a subscription payment for a restaurant and mints a unique platform
 * invoice number. The subscription itself is untouched — dates/status derive
 * from the subscription service; this is the money ledger for the SaaS sale.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<PaymentView> {
  await connectDB();
  const amountPaise = Math.round(Number(input.amountPaise));
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new PaymentValidationError("Payment amount must be a positive number.");
  }
  if (!(SUBSCRIPTION_PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) {
    throw new PaymentValidationError("Invalid payment method.");
  }
  const sub = await SubscriptionModel.findById(input.subscriptionId).lean();
  if (!sub || String(sub.restaurantId) !== String(input.restaurantId)) {
    throw new SubscriptionNotFoundError();
  }
  await assertReferenceAvailable(input.transactionReference);

  const invoiceNumber = await nextSubscriptionInvoiceNumber();
  const restaurant = await import("@/models/Restaurant").then(({ RestaurantModel }) =>
    RestaurantModel.findById(input.restaurantId).select("name").lean()
  );
  const restaurantName = restaurant ? String(restaurant.name) : "Restaurant";

  const payment = await SubscriptionPaymentModel.create({
    restaurantId: input.restaurantId,
    subscriptionId: input.subscriptionId,
    invoiceNumber,
    amountPaise,
    paymentMethod: input.paymentMethod,
    transactionReference: input.transactionReference?.trim() || null,
    periodStartDate: sub.startDate,
    periodEndDate: sub.expiryDate,
    status: "PAID",
    paidAt: input.paidAt ?? new Date(),
    note: input.note?.trim() || null,
    createdBy: input.createdBy ?? null,
  });

  await logPlatformAudit({
    action: "PAYMENT_RECORDED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "SUBSCRIPTION_PAYMENT",
    entityId: String(payment._id),
    summary: `Payment ${invoiceNumber} recorded for ${restaurantName} (₹${(amountPaise / 100).toFixed(2)})`,
    metadata: {
      invoiceNumber,
      amountPaise,
      paymentMethod: input.paymentMethod,
      subscriptionId: input.subscriptionId,
    },
  });

  return toView(payment, restaurantName);
}

export interface UpdatePaymentInput {
  paymentId: string;
  amountPaise?: number;
  paymentMethod?: SubscriptionPaymentMethod;
  transactionReference?: string | null;
  status?: SubscriptionPaymentStatus;
  paidAt?: Date | null;
  note?: string | null;
  createdBy?: string | null;
}

export async function updatePayment(input: UpdatePaymentInput): Promise<PaymentView> {
  await connectDB();
  const existing = await SubscriptionPaymentModel.findById(input.paymentId).lean();
  if (!existing) throw new PaymentNotFoundError();

  const patch: Record<string, unknown> = {};
  if (input.amountPaise !== undefined) {
    const amountPaise = Math.round(Number(input.amountPaise));
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new PaymentValidationError("Payment amount must be a positive number.");
    }
    patch.amountPaise = amountPaise;
  }
  if (input.paymentMethod !== undefined) {
    if (!(SUBSCRIPTION_PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) {
      throw new PaymentValidationError("Invalid payment method.");
    }
    patch.paymentMethod = input.paymentMethod;
  }
  if (input.status !== undefined) {
    if (!(SUBSCRIPTION_PAYMENT_STATUSES as readonly string[]).includes(input.status)) {
      throw new PaymentValidationError("Invalid payment status.");
    }
    patch.status = input.status;
  }
  if (input.transactionReference !== undefined) {
    await assertReferenceAvailable(input.transactionReference, input.paymentId);
    patch.transactionReference = input.transactionReference?.trim() || null;
  }
  if (input.paidAt !== undefined) {
    patch.paidAt = input.paidAt;
  }
  if (input.note !== undefined) {
    patch.note = input.note?.trim() || null;
  }

  await SubscriptionPaymentModel.updateOne({ _id: input.paymentId }, { $set: patch });

  await logPlatformAudit({
    action: "PAYMENT_UPDATED",
    restaurantId: String(existing.restaurantId),
    actorId: input.createdBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "SUBSCRIPTION_PAYMENT",
    entityId: input.paymentId,
    summary: `Payment ${String(existing.invoiceNumber)} updated`,
    metadata: { changed: Object.keys(patch) },
  });

  return getPaymentById(input.paymentId) as Promise<PaymentView>;
}

export async function refundPayment(
  paymentId: string,
  meta: { createdBy?: string | null; note?: string | null } = {}
): Promise<PaymentView> {
  await connectDB();
  const existing = await SubscriptionPaymentModel.findById(paymentId).lean();
  if (!existing) throw new PaymentNotFoundError();

  await SubscriptionPaymentModel.updateOne(
    { _id: paymentId },
    { $set: { status: "REFUNDED" } }
  );

  await logPlatformAudit({
    action: "PAYMENT_REFUNDED",
    restaurantId: String(existing.restaurantId),
    actorId: meta.createdBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "SUBSCRIPTION_PAYMENT",
    entityId: paymentId,
    summary: `Payment ${String(existing.invoiceNumber)} refunded`,
    metadata: { note: meta.note ?? null },
  });

  return getPaymentById(paymentId) as Promise<PaymentView>;
}