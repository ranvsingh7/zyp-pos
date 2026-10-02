"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/permissions";
import {
  createSubscription,
  renewSubscription,
  changeSubscriptionPlan,
  changeSubscriptionPricing,
  extendSubscriptionExpiry,
  suspendSubscription,
  reactivateSubscription,
  cancelSubscription,
} from "@/lib/admin/subscription-service";
import {
  createSubscriptionSchema,
  renewSubscriptionSchema,
  changePlanSchema,
  changePricingSchema,
  extendExpirySchema,
  actionWithReasonSchema,
} from "@/lib/admin/query";
import { wrapAdminAction } from "./_shared";

export interface SubscriptionActionState {
  success?: boolean;
  message?: string;
  subscriptionId?: string;
  _errors?: Record<string, string[]>;
}

export async function createSubscriptionAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    // Only the plan, the start date, an optional discount and a note are read
    // off the form. Price, duration, billing cycle, grace period, expiry and
    // the trial flag are deliberately never read here — they come from the plan
    // document, so a tampered or stale form cannot influence them.
    const parsed = createSubscriptionSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      planId: formData.get("planId"),
      discountAmountPaise: formData.get("discountAmountPaise"),
      startDate: formData.get("startDate"),
      notes: formData.get("notes"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const startedAt = parsed.data.startDate ? new Date(parsed.data.startDate) : undefined;
    const sub = await createSubscription({
      restaurantId: parsed.data.restaurantId,
      planId: parsed.data.planId,
      discountAmountPaise: parsed.data.discountAmountPaise ?? undefined,
      startDate: startedAt ?? new Date(),
      notes: parsed.data.notes ?? null,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}

export async function renewSubscriptionAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = renewSubscriptionSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      planId: formData.get("planId"),
      startDate: formData.get("startDate"),
      discountAmountPaise: formData.get("discountAmountPaise"),
      notes: formData.get("notes"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const sub = await renewSubscription({
      restaurantId: parsed.data.restaurantId,
      planId: parsed.data.planId ?? undefined,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      discountAmountPaise: parsed.data.discountAmountPaise ?? undefined,
      notes: parsed.data.notes ?? null,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}

export async function changeSubscriptionPlanAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = changePlanSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      planId: formData.get("planId"),
      discountAmountPaise: formData.get("discountAmountPaise"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const sub = await changeSubscriptionPlan({
      restaurantId: parsed.data.restaurantId,
      planId: parsed.data.planId,
      discountAmountPaise: parsed.data.discountAmountPaise ?? undefined,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}

export async function changeSubscriptionPricingAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    // Discount only. Any list price / final price posted alongside it is
    // ignored rather than read, so the plan stays the only source of price.
    const parsed = changePricingSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      discountAmountPaise: formData.get("discountAmountPaise"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const sub = await changeSubscriptionPricing({
      restaurantId: parsed.data.restaurantId,
      discountAmountPaise: parsed.data.discountAmountPaise ?? undefined,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}

export async function extendSubscriptionExpiryAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = extendExpirySchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      days: formData.get("days"),
      newExpiryDate: formData.get("newExpiryDate"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const sub = await extendSubscriptionExpiry({
      restaurantId: parsed.data.restaurantId,
      days: parsed.data.days ?? null,
      newExpiryDate: parsed.data.newExpiryDate ? new Date(parsed.data.newExpiryDate) : null,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}

export async function suspendSubscriptionAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = actionWithReasonSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const sub = await suspendSubscription({
      restaurantId: parsed.data.restaurantId,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}

export async function reactivateSubscriptionAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = actionWithReasonSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const sub = await reactivateSubscription({
      restaurantId: parsed.data.restaurantId,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}

export async function cancelSubscriptionAction(
  formData: FormData
): Promise<SubscriptionActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = actionWithReasonSchema.safeParse({
      restaurantId: formData.get("restaurantId"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const sub = await cancelSubscription({
      restaurantId: parsed.data.restaurantId,
      createdBy: admin.id,
      changedByRole: "SUPER_ADMIN",
      reason: parsed.data.reason ?? null,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/restaurants/${parsed.data.restaurantId}`);
    return { success: true, subscriptionId: sub.subscriptionId };
  });
}