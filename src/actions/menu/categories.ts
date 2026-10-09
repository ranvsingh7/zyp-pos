"use server";

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { menuDataTag } from "@/lib/cache-tags";
import { invalidateNextTag } from "@/lib/next-cache";
import { assertCanEditMenu } from "@/lib/menu/permissions";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  reorderCategories,
  type DeleteCategoryResult,
} from "@/lib/menu/category-service";
import {
  menuCategoryInputSchema,
  menuReorderInputSchema,
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

export async function createCategoryAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    const parsed = menuCategoryInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const created = await createCategory(restaurantId, parsed.data);
    invalidateNextTag(menuDataTag(restaurantId));
    return { success: true, id: created.id };
  });
}

export async function updateCategoryAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    if (
      typeof input !== "object" ||
      input === null ||
      !("id" in input) ||
      typeof (input as { id: unknown }).id !== "string"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const { id, ...fields } = input as { id: string } & Record<string, unknown>;
    const parsed = menuCategoryInputSchema.safeParse(fields);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const updated = await updateCategory(restaurantId, id, parsed.data);
    invalidateNextTag(menuDataTag(restaurantId));
    return { success: true, id: updated.id };
  });
}

export async function deleteCategoryAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const result: DeleteCategoryResult = await deleteCategory(
      restaurantId,
      (input as { id: string }).id
    );
    invalidateNextTag(menuDataTag(restaurantId));
    return { success: true, message: result.soft ? "Category deactivated." : "Category deleted." };
  });
}

export async function toggleCategoryStatusAction(input: unknown): Promise<ActionResult> {
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
    await toggleCategoryStatus(restaurantId, id, isActive);
    invalidateNextTag(menuDataTag(restaurantId));
    return { success: true, id };
  });
}

export async function reorderCategoriesAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext();
    const parsed = menuReorderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    await reorderCategories(restaurantId, parsed.data.orderedIds);
    invalidateNextTag(menuDataTag(restaurantId));
    return { success: true };
  });
}