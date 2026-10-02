"use server";

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import {
  assertCanEditMenu,
  assertCanToggleAvailability,
} from "@/lib/menu/permissions";
import {
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleMenuItemAvailability,
  toggleMenuItemStatus,
} from "@/lib/menu/item-service";
import {
  menuItemInputSchema,
  menuItemUpdateSchema,
  firstZodMessage,
} from "@/lib/menu/validation";
import { assertServiceForCurrentVenue } from "@/lib/services/access";
import { wrapMenuAction, type ActionResult } from "./_shared";

async function requireMenuContext(
  permission: "edit" | "availability" = "edit"
) {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  // Service gate first, then role: every menu action passes through this
  // helper, so MENU cannot be bypassed by calling an action directly.
  await assertServiceForCurrentVenue("MENU");
  if (permission === "edit") {
    assertCanEditMenu(user.role);
  } else {
    assertCanToggleAvailability(user.role);
  }
  return String(restaurant.id);
}

export async function createMenuItemAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext("edit");
    const parsed = menuItemInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const created = await createMenuItem(restaurantId, parsed.data);
    return { success: true, id: created.id };
  });
}

export async function updateMenuItemAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext("edit");
    const parsed = menuItemUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const updated = await updateMenuItem(
      restaurantId,
      parsed.data.id,
      parsed.data
    );
    return { success: true, id: updated.id };
  });
}

export async function deleteMenuItemAction(input: unknown): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext("edit");
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string"
    ) {
      return { success: false, message: "Invalid input." };
    }
    await deleteMenuItem(restaurantId, (input as { id: string }).id);
    return { success: true };
  });
}

export async function toggleMenuItemAvailabilityAction(
  input: unknown
): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext("availability");
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string" ||
      typeof (input as { isAvailable?: unknown }).isAvailable !== "boolean"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const { id, isAvailable } = input as { id: string; isAvailable: boolean };
    await toggleMenuItemAvailability(restaurantId, id, isAvailable);
    return { success: true, id };
  });
}

export async function toggleMenuItemStatusAction(
  input: unknown
): Promise<ActionResult> {
  return wrapMenuAction(async () => {
    const restaurantId = await requireMenuContext("edit");
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string" ||
      typeof (input as { isActive?: unknown }).isActive !== "boolean"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const { id, isActive } = input as { id: string; isActive: boolean };
    await toggleMenuItemStatus(restaurantId, id, isActive);
    return { success: true, id };
  });
}