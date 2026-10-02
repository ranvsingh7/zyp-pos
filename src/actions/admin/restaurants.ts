"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/permissions";
import {
  createRestaurantAdmin,
  updateRestaurant,
  suspendRestaurant,
  reactivateRestaurant,
  transferRestaurant,
} from "@/lib/admin/restaurant-admin-service";
import { createRestaurantSchema, updateRestaurantSchema } from "@/lib/admin/query";
import { wrapAdminAction } from "./_shared";

export interface RestaurantActionState {
  success?: boolean;
  message?: string;
  restaurantId?: string;
  _errors?: Record<string, string[]>;
}

/** Blank/absent form fields become undefined so optional schema fields and
 *  `.default()` values stay untouched. */
function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

/** Tri-state toggle: absent/blank (undefined) means "don't change". */
function optionalBoolean(value: FormDataEntryValue | null): boolean | undefined {
  if (value == null) return undefined;
  const text = String(value).trim().toLowerCase();
  if (text === "") return undefined;
  return text === "true" || text === "on" || text === "1";
}

export async function createRestaurantAction(
  formData: FormData
): Promise<RestaurantActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = createRestaurantSchema.safeParse({
      name: formData.get("name"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      address: formData.get("address"),
      city: formData.get("city"),
      state: formData.get("state"),
      pincode: formData.get("pincode"),
      businessType: formData.get("businessType"),
      gstRegistered: formData.get("gstRegistered") === "true" || formData.get("gstRegistered") === "on",
      gstin: emptyToUndefined(formData.get("gstin")),
      taxEnabled: optionalBoolean(formData.get("taxEnabled")),
      defaultTaxRate: emptyToUndefined(formData.get("defaultTaxRate")),
      taxInclusive: optionalBoolean(formData.get("taxInclusive")),
      gstScheme: emptyToUndefined(formData.get("gstScheme")),
      cgstRatePercent: emptyToUndefined(formData.get("cgstRatePercent")),
      sgstRatePercent: emptyToUndefined(formData.get("sgstRatePercent")),
      igstRatePercent: emptyToUndefined(formData.get("igstRatePercent")),
      ownerFullName: formData.get("ownerFullName"),
      ownerEmail: formData.get("ownerEmail"),
      ownerPhone: formData.get("ownerPhone"),
      password: formData.get("password"),
      planId: formData.get("planId"),
      isTrial: formData.get("isTrial") === "true" || formData.get("isTrial") === "on",
      discountAmountPaise: formData.get("discountAmountPaise"),
      finalPricePaise: formData.get("finalPricePaise"),
      durationDays: formData.get("durationDays"),
      gracePeriodDays: formData.get("gracePeriodDays"),
      notes: formData.get("notes"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    const result = await createRestaurantAdmin({
      ...parsed.data,
      createdBy: admin.id,
    });
    revalidatePath("/admin/restaurants");
    return { success: true, restaurantId: result.restaurantId };
  });
}

export async function updateRestaurantAction(
  restaurantId: string,
  formData: FormData
): Promise<RestaurantActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = updateRestaurantSchema.safeParse({
      name: formData.get("name"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      address: formData.get("address"),
      city: formData.get("city"),
      state: formData.get("state"),
      pincode: formData.get("pincode"),
      businessType: formData.get("businessType"),
      gstRegistered: formData.get("gstRegistered") === "true" || formData.get("gstRegistered") === "on",
      gstin: emptyToUndefined(formData.get("gstin")),
      taxEnabled: optionalBoolean(formData.get("taxEnabled")),
      defaultTaxRate: emptyToUndefined(formData.get("defaultTaxRate")),
      taxInclusive: optionalBoolean(formData.get("taxInclusive")),
      gstScheme: emptyToUndefined(formData.get("gstScheme")),
      cgstRatePercent: emptyToUndefined(formData.get("cgstRatePercent")),
      sgstRatePercent: emptyToUndefined(formData.get("sgstRatePercent")),
      igstRatePercent: emptyToUndefined(formData.get("igstRatePercent")),
      reason: formData.get("reason"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    await updateRestaurant(restaurantId, {
      ...parsed.data,
      editedBy: admin.id,
    });
    revalidatePath("/admin/restaurants");
    revalidatePath(`/admin/restaurants/${restaurantId}`);
    return { success: true, restaurantId };
  });
}

export async function suspendRestaurantAction(
  restaurantId: string,
  reason?: string
): Promise<RestaurantActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    await suspendRestaurant(restaurantId, { createdBy: admin.id, reason });
    revalidatePath("/admin/restaurants");
    revalidatePath(`/admin/restaurants/${restaurantId}`);
    return { success: true, restaurantId };
  });
}

export async function reactivateRestaurantAction(
  restaurantId: string,
  reason?: string
): Promise<RestaurantActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    await reactivateRestaurant(restaurantId, { createdBy: admin.id, reason });
    revalidatePath("/admin/restaurants");
    revalidatePath(`/admin/restaurants/${restaurantId}`);
    return { success: true, restaurantId };
  });
}

export async function transferRestaurantAction(
  restaurantId: string,
  newOwnerEmail: string
): Promise<RestaurantActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    await transferRestaurant(restaurantId, newOwnerEmail, { createdBy: admin.id });
    revalidatePath("/admin/restaurants");
    revalidatePath(`/admin/restaurants/${restaurantId}`);
    return { success: true, restaurantId };
  });
}