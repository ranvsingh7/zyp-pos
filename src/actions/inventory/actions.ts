"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import {
  assertCanManageInventory,
  assertCanViewInventory,
} from "@/lib/inventory/permissions";
import {
  createInventoryCategory,
  createInventoryItem,
  getInventoryItem,
  listInventoryCategories,
  searchInventoryItems,
  setInventoryItemActive,
  updateInventoryCategory,
  updateInventoryItem,
} from "@/lib/inventory/inventory-service";
import {
  adjustStock,
  listItemMovements,
  recordConsumption,
  recordWastage,
} from "@/lib/inventory/stock-service";
import {
  createPurchase,
  getPurchaseById,
  reversePurchase,
} from "@/lib/inventory/purchase-service";
import {
  firstZodMessage,
  inventoryCategoryInputSchema,
  inventoryCategoryUpdateSchema,
  inventoryItemActivationSchema,
  inventoryItemInputSchema,
  inventoryItemUpdateSchema,
  purchaseInputSchema,
  stockAdjustmentSchema,
  stockConsumptionSchema,
  stockWastageSchema,
} from "@/lib/inventory/validation";
import type {
  InventoryCategoryView,
  InventoryItemView,
  PurchaseDetailView,
  StockMovementView,
} from "@/lib/inventory/types";
import {
  wrapDataAction,
  wrapInventoryAction,
  type ActionResult,
  type DataActionResult,
} from "./_shared";

async function requireViewContext() {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  assertCanViewInventory(user.role);
  return { restaurantId: String(restaurant.id), userId: String(user.id) };
}

async function requireManageContext() {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  assertCanManageInventory(user.role);
  return { restaurantId: String(restaurant.id), userId: String(user.id) };
}

/* -------------------------------------------------------------------------- */
/* Items                                                                      */
/* -------------------------------------------------------------------------- */

export async function createInventoryItemAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const parsed = inventoryItemInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const created = await createInventoryItem(restaurantId, userId, parsed.data);
    revalidatePath("/inventory");
    return {
      success: true,
      id: created.id,
      message: `${created.name} added to inventory.`,
    };
  });
}

export async function updateInventoryItemAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const parsed = inventoryItemUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const updated = await updateInventoryItem(
      restaurantId,
      userId,
      parsed.data.id,
      parsed.data
    );
    revalidatePath("/inventory");
    return {
      success: true,
      id: updated.id,
      message: `${updated.name} updated.`,
    };
  });
}

export async function setInventoryItemActiveAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const parsed = inventoryItemActivationSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const updated = await setInventoryItemActive(
      restaurantId,
      userId,
      parsed.data.id,
      parsed.data.isActive
    );
    revalidatePath("/inventory");
    return {
      success: true,
      id: updated.id,
      message: parsed.data.isActive
        ? `${updated.name} reactivated.`
        : `${updated.name} deactivated.`,
    };
  });
}

export async function searchInventoryItemsAction(
  term: unknown
): Promise<DataActionResult<InventoryItemView[]>> {
  return wrapDataAction(async () => {
    const { restaurantId } = await requireViewContext();
    const query = typeof term === "string" ? term : "";
    const rows = await searchInventoryItems(restaurantId, query, 20);
    return { success: true, data: rows };
  });
}

export async function getInventoryItemDetailAction(
  input: unknown
): Promise<
  DataActionResult<{ item: InventoryItemView; movements: StockMovementView[] }>
> {
  return wrapDataAction(async () => {
    const { restaurantId } = await requireViewContext();
    const id =
      typeof input === "object" && input !== null
        ? (input as { id?: unknown }).id
        : null;
    if (typeof id !== "string" || !id) {
      return { success: false, message: "Invalid item." };
    }
    const item = await getInventoryItem(restaurantId, id);
    const movements = await listItemMovements(restaurantId, id, 10);
    return { success: true, data: { item, movements } };
  });
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function createInventoryCategoryAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId } = await requireManageContext();
    const parsed = inventoryCategoryInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const created = await createInventoryCategory(restaurantId, parsed.data);
    revalidatePath("/inventory");
    return {
      success: true,
      id: created.id,
      message: `Category "${created.name}" added.`,
    };
  });
}

export async function updateInventoryCategoryAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId } = await requireManageContext();
    const parsed = inventoryCategoryUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const updated = await updateInventoryCategory(
      restaurantId,
      parsed.data.id,
      parsed.data
    );
    revalidatePath("/inventory");
    return {
      success: true,
      id: updated.id,
      message: `Category "${updated.name}" updated.`,
    };
  });
}

export async function listInventoryCategoriesAction(): Promise<
  DataActionResult<InventoryCategoryView[]>
> {
  return wrapDataAction(async () => {
    const { restaurantId } = await requireViewContext();
    const data = await listInventoryCategories(restaurantId);
    return { success: true, data };
  });
}

/* -------------------------------------------------------------------------- */
/* Stock movements                                                            */
/* -------------------------------------------------------------------------- */

export async function adjustStockAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const parsed = stockAdjustmentSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const result = await adjustStock(restaurantId, userId, parsed.data);
    revalidatePath("/inventory");
    revalidatePath("/inventory/movements");
    return {
      success: true,
      id: result.itemId,
      message: `${result.itemName}: now ${result.currentStockLabel}.`,
    };
  });
}

export async function recordWastageAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const parsed = stockWastageSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const result = await recordWastage(restaurantId, userId, parsed.data);
    revalidatePath("/inventory");
    revalidatePath("/inventory/movements");
    return {
      success: true,
      id: result.itemId,
      message: `Wastage recorded for ${result.itemName}.`,
    };
  });
}

export async function recordConsumptionAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const parsed = stockConsumptionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const result = await recordConsumption(restaurantId, userId, parsed.data);
    revalidatePath("/inventory");
    revalidatePath("/inventory/movements");
    return {
      success: true,
      id: result.itemId,
      message: `Consumption recorded for ${result.itemName}.`,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Purchases                                                                  */
/* -------------------------------------------------------------------------- */

export async function createPurchaseAction(
  input: unknown
): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const parsed = purchaseInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const purchase = await createPurchase(restaurantId, userId, parsed.data);
    revalidatePath("/inventory");
    revalidatePath("/inventory/purchases");
    revalidatePath("/inventory/movements");
    return {
      success: true,
      id: purchase.id,
      message: `Purchase ${purchase.purchaseNumber} recorded.`,
    };
  });
}

export async function getPurchaseDetailAction(
  input: unknown
): Promise<DataActionResult<PurchaseDetailView>> {
  return wrapDataAction(async () => {
    const { restaurantId } = await requireViewContext();
    const id =
      typeof input === "object" && input !== null
        ? (input as { id?: unknown }).id
        : null;
    if (typeof id !== "string" || !id) {
      return { success: false, message: "Invalid purchase." };
    }
    const purchase = await getPurchaseById(restaurantId, id);
    return { success: true, data: purchase };
  });
}

/**
 * Soft-reverses a POSTED purchase (OWNER/MANAGER only). The purchase is never
 * deleted; stock is returned via ADJUSTMENT_OUT ledger entries.
 */
export async function reversePurchaseAction(input: unknown): Promise<ActionResult> {
  return wrapInventoryAction(async () => {
    const { restaurantId, userId } = await requireManageContext();
    const raw =
      typeof input === "object" && input !== null ? (input as { id?: unknown; reason?: unknown }) : {};
    if (typeof raw.id !== "string" || !raw.id) {
      return { success: false, message: "Invalid purchase." };
    }
    const reason = typeof raw.reason === "string" ? raw.reason : undefined;
    const purchase = await reversePurchase(restaurantId, raw.id, userId, reason);
    revalidatePath("/inventory");
    revalidatePath("/inventory/purchases");
    revalidatePath(`/inventory/purchases/${purchase.id}`);
    return {
      success: true,
      id: purchase.id,
      message: `Purchase ${purchase.purchaseNumber} reversed.`,
    };
  });
}
