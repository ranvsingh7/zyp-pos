"use server";

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { assertCanEditMenu } from "@/lib/menu/permissions";
import {
  createVariant,
  updateVariant,
  deleteVariant,
  toggleVariantStatus,
  reorderVariants,
} from "@/lib/menu/variant-service";
import {
  menuVariantInputSchema,
  menuVariantReorderInputSchema,
  objectIdSchema,
  firstZodMessage,
} from "@/lib/menu/validation";
import { assertServiceForCurrentVenue } from "@/lib/services/access";
import { wrapMenuAction, type ActionResult } from "./_shared";

async function requireMenuContext() {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  // Service gate first, then role: every menu action passes through this
  // helper, so MENU cannot be bypassed by calling an action directly.
  await assertServiceForCurrentVenue("MENU");
  assertCanEditMenu(user.role);
  return String(restaurant.id);
}

export async function createVariantAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { menuItemId?: unknown }).menuItemId !== "string"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const parseId = objectIdSchema.safeParse(
      (input as { menuItemId: string }).menuItemId
    );
    if (!parseId.success) {
      return { success: false, message: "Invalid menu item id." };
    }
    const { menuItemId, ...fields } = input as { menuItemId: string } &
      Record<string, unknown>;
    const parsed = menuVariantInputSchema.safeParse(fields);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const created = await createVariant(restaurantId, menuItemId, parsed.data);
    return { success: true, id: created.id };
  });
}

export async function updateVariantAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const { id, ...fields } = input as { id: string } & Record<string, unknown>;
    const parsed = menuVariantInputSchema.safeParse(fields);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const updated = await updateVariant(restaurantId, id, parsed.data);
    return { success: true, id: updated.id };
  });
}

export async function deleteVariantAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string"
    ) {
      return { success: false, message: "Invalid input." };
    }
    await deleteVariant(restaurantId, (input as { id: string }).id);
    return { success: true };
  });
}

export async function toggleVariantStatusAction(
  input: unknown
): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string" ||
      typeof (input as { isActive?: unknown }).isActive !== "boolean"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const { id, isActive } = input as { id: string; isActive: boolean };
    await toggleVariantStatus(restaurantId, id, isActive);
    return { success: true, id };
  });
}

export async function reorderVariantsAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    const parsed = menuVariantReorderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    await reorderVariants(
      restaurantId,
      parsed.data.menuItemId,
      parsed.data.orderedIds
    );
    return { success: true };
  });
}