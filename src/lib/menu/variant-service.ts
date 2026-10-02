import "server-only";

import { connectDB } from "@/lib/db";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { MenuNotFoundError, MenuValidationError } from "@/lib/menu/errors";
import {
  resolveVariantCode,
  assertUniqueVariantName,
  variantToView,
} from "@/lib/menu/variant-helpers";
import { rupeesToPaise } from "@/lib/menu/prices";
import { normalizeTaxOverride } from "@/lib/billing/tax-config";
import type { MenuVariantInput } from "@/lib/menu/validation";
import type { MenuVariantView } from "@/lib/menu/types";

async function assertItemInRestaurant(
  restaurantId: string,
  menuItemId: string
): Promise<void> {
  const item = await MenuItemModel.findOne({ _id: menuItemId, restaurantId })
    .select("_id")
    .lean();
  if (!item) throw new MenuNotFoundError("Menu item not found.");
}

export async function getVariantsForItem(
  restaurantId: string,
  menuItemId: string
): Promise<MenuVariantView[]> {
  await connectDB();
  await assertItemInRestaurant(restaurantId, menuItemId);
  const docs = await MenuVariantModel.find({ restaurantId, menuItemId })
    .sort({ displayOrder: 1, name: 1 })
    .lean();
  return docs.map((d) => variantToView(d as unknown as Parameters<typeof variantToView>[0]));
}

export async function createVariant(
  restaurantId: string,
  menuItemId: string,
  input: MenuVariantInput
): Promise<MenuVariantView> {
  await connectDB();
  await assertItemInRestaurant(restaurantId, menuItemId);
  await assertUniqueVariantName(restaurantId, menuItemId, resolveVariantCode(input));

  const displayOrder =
    await MenuVariantModel.countDocuments({ restaurantId, menuItemId });

  const doc = await MenuVariantModel.create({
    restaurantId,
    menuItemId,
    name: resolveVariantCode(input),
    displayName: input.displayName.trim(),
    price: rupeesToPaise(input.priceRupees),
    description: input.description?.trim() || null,
    sku: input.sku?.trim() || null,
    sizeValue: input.sizeValue ?? null,
    sizeUnit: input.sizeUnit ?? null,
    displayOrder,
    isActive: input.isActive,
    taxOverride: normalizeTaxOverride(input.taxOverride),
  });

  return variantToView(doc);
}

export async function updateVariant(
  restaurantId: string,
  variantId: string,
  input: MenuVariantInput
): Promise<MenuVariantView> {
  await connectDB();

  const existing = await MenuVariantModel.findOne({ _id: variantId, restaurantId });
  if (!existing) throw new MenuNotFoundError("Variant not found.");

  await assertUniqueVariantName(
    restaurantId,
    String(existing.menuItemId),
    resolveVariantCode(input),
    variantId
  );

  existing.name = resolveVariantCode(input);
  existing.displayName = input.displayName.trim();
  existing.price = rupeesToPaise(input.priceRupees);
  existing.description = input.description?.trim() || null;
  existing.sku = input.sku?.trim() || null;
  existing.sizeValue = input.sizeValue ?? null;
  existing.sizeUnit = input.sizeUnit ?? null;
  existing.displayOrder = input.displayOrder ?? existing.displayOrder;
  existing.isActive = input.isActive;
  existing.taxOverride = normalizeTaxOverride(input.taxOverride);
  await existing.save();

  return variantToView(existing);
}

export async function toggleVariantStatus(
  restaurantId: string,
  variantId: string,
  isActive: boolean
): Promise<MenuVariantView> {
  await connectDB();
  const doc = await MenuVariantModel.findOneAndUpdate(
    { _id: variantId, restaurantId },
    { $set: { isActive } },
    { returnDocument: "after" }
  );
  if (!doc) throw new MenuNotFoundError("Variant not found.");
  return variantToView(doc);
}

export async function deleteVariant(
  restaurantId: string,
  variantId: string
): Promise<void> {
  await connectDB();
  const result = await MenuVariantModel.updateOne(
    { _id: variantId, restaurantId },
    { $set: { isActive: false } }
  );
  if (result.matchedCount === 0) throw new MenuNotFoundError("Variant not found.");
}

export async function reorderVariants(
  restaurantId: string,
  menuItemId: string,
  orderedIds: string[]
): Promise<MenuVariantView[]> {
  await connectDB();
  await assertItemInRestaurant(restaurantId, menuItemId);

  const docs = await MenuVariantModel.find({ restaurantId, menuItemId })
    .select("_id")
    .lean();
  const allowed = new Set(docs.map((d) => String(d._id)));
  if (orderedIds.some((id) => !allowed.has(id))) {
    throw new MenuValidationError("One or more variants do not belong to this item.");
  }

  await Promise.all(
    orderedIds.map((id, index) =>
      MenuVariantModel.updateOne(
        { _id: id, restaurantId, menuItemId },
        { $set: { displayOrder: index } }
      )
    )
  );

  return getVariantsForItem(restaurantId, menuItemId);
}