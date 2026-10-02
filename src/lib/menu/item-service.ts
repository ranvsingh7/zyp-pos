import "server-only";

import { connectDB } from "@/lib/db";
import { MenuItemModel, type MenuItem } from "@/models/MenuItem";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuVariantModel } from "@/models/MenuVariant";
import {
  MenuNotFoundError,
  MenuValidationError,
} from "@/lib/menu/errors";
import {
  exactCaseInsensitiveRegex,
} from "@/lib/menu/utils";
import {
  resolveVariantCode,
  assertUniqueVariantName,
  variantToView,
} from "@/lib/menu/variant-helpers";
import { rupeesToPaise } from "@/lib/menu/prices";
import { normalizeTaxOverride } from "@/lib/billing/tax-config";
import type { MenuItemInput, MenuVariantInput } from "@/lib/menu/validation";
import type { MenuItemView, MenuVariantView } from "@/lib/menu/types";

export interface ListItemsOptions {
  categoryId?: string | null;
}

export type MenuItemDoc = MenuItem & { _id: unknown };

function itemToView(
  doc: MenuItemDoc,
  categoryName: string | null,
  variants: MenuVariantView[]
): MenuItemView {
  return {
    id: String(doc._id),
    categoryId: String(doc.categoryId),
    categoryName,
    name: doc.name,
    description: doc.description ?? null,
    itemType: doc.itemType,
    vegType: doc.vegType,
    imageUrl: doc.imageUrl ?? null,
    hasVariants: doc.hasVariants,
    hsnSacCode: doc.hsnSacCode ?? null,
    basePrice: doc.basePrice ?? null,
    isAvailable: doc.isAvailable,
    isActive: doc.isActive,
    displayOrder: doc.displayOrder,
    taxOverride: normalizeTaxOverride(doc.taxOverride),
    variants,
  };
}

async function assertCategoryInRestaurant(
  restaurantId: string,
  categoryId: string
): Promise<void> {
  const category = await MenuCategoryModel.findOne({
    _id: categoryId,
    restaurantId,
  })
    .select("_id")
    .lean();
  if (!category) throw new MenuNotFoundError("Category not found.");
}

async function assertUniqueItemName(
  restaurantId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const query: Record<string, unknown> = {
    restaurantId,
    name: exactCaseInsensitiveRegex(name),
    isActive: true,
  };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await MenuItemModel.findOne(query).select("_id").lean();
  if (existing) {
    throw new MenuValidationError(`An item named "${name}" already exists.`);
  }
}

function toVariantDocument(
  restaurantId: string,
  menuItemId: string,
  input: MenuVariantInput,
  displayOrder: number
) {
  return {
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
  };
}

export async function getMenuItems(
  restaurantId: string,
  options: ListItemsOptions = {}
): Promise<MenuItemView[]> {
  await connectDB();

  const query: Record<string, unknown> = { restaurantId };
  if (options.categoryId) query.categoryId = options.categoryId;

  const [itemDocs, categoryDocs, variantDocs] = await Promise.all([
    MenuItemModel.find(query).sort({ displayOrder: 1, name: 1 }).lean(),
    MenuCategoryModel.find({ restaurantId }).select("_id name").lean(),
    MenuVariantModel.find({ restaurantId })
      .sort({ menuItemId: 1, displayOrder: 1, name: 1 })
      .lean(),
  ]);

  const categoryNameById = new Map(
    categoryDocs.map((c) => [String(c._id), String(c.name)])
  );
  const variantsByItem = new Map<string, MenuVariantView[]>();
  for (const v of variantDocs) {
    const key = String(v.menuItemId);
    const list = variantsByItem.get(key) ?? [];
    list.push(variantToView(v as unknown as Parameters<typeof variantToView>[0]));
    variantsByItem.set(key, list);
  }

  return itemDocs.map((itemDoc) =>
    itemToView(
      itemDoc as unknown as MenuItemDoc,
      categoryNameById.get(String(itemDoc.categoryId)) ?? null,
      variantsByItem.get(String(itemDoc._id)) ?? []
    )
  );
}

export async function getMenuItem(
  restaurantId: string,
  itemId: string
): Promise<MenuItemView | null> {
  await connectDB();
  const [itemDoc, variantDocs] = await Promise.all([
    MenuItemModel.findOne({ _id: itemId, restaurantId }).lean(),
    MenuVariantModel.find({ restaurantId, menuItemId: itemId })
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
  ]);

  if (!itemDoc) return null;

  const category = await MenuCategoryModel.findById(String(itemDoc.categoryId))
    .select("name")
    .lean();

  return itemToView(
    itemDoc as unknown as MenuItemDoc,
    category?.name ?? null,
    variantDocs.map((v) =>
      variantToView(v as unknown as Parameters<typeof variantToView>[0])
    )
  );
}

export async function createMenuItem(
  restaurantId: string,
  input: MenuItemInput
): Promise<MenuItemView> {
  await connectDB();

  const name = input.name.trim();
  await assertCategoryInRestaurant(restaurantId, input.categoryId);
  await assertUniqueItemName(restaurantId, name);

  const displayOrder =
    input.displayOrder ?? (await MenuItemModel.countDocuments({ restaurantId }));

  const item = await MenuItemModel.create({
    restaurantId,
    categoryId: input.categoryId,
    name,
    description: input.description?.trim() || null,
    itemType: input.itemType,
    vegType: input.vegType,
    imageUrl: input.imageUrl?.trim() || null,
    hasVariants: input.hasVariants,
    hsnSacCode: input.hsnSacCode?.trim() || null,
    basePrice: input.hasVariants ? null : rupeesToPaise(input.basePriceRupees!),
    isAvailable: input.isAvailable,
    isActive: input.isActive,
    displayOrder,
    taxOverride: normalizeTaxOverride(input.taxOverride),
  });

  const itemId = String(item._id);
  if (input.hasVariants && input.variants) {
    for (let i = 0; i < input.variants.length; i += 1) {
      const variant = input.variants[i];
      await assertUniqueVariantName(restaurantId, itemId, resolveVariantCode(variant));
      await MenuVariantModel.create(
        toVariantDocument(restaurantId, itemId, variant, i)
      );
    }
  }

  return getMenuItemUnchecked(restaurantId, itemId);
}

async function getMenuItemUnchecked(
  restaurantId: string,
  itemId: string
): Promise<MenuItemView> {
  const view = await getMenuItem(restaurantId, itemId);
  if (!view) throw new MenuNotFoundError("Item not found.");
  return view;
}

export async function updateMenuItem(
  restaurantId: string,
  itemId: string,
  input: MenuItemInput
): Promise<MenuItemView> {
  await connectDB();

  const existing = await MenuItemModel.findOne({ _id: itemId, restaurantId });
  if (!existing) throw new MenuNotFoundError("Item not found.");

  const name = input.name.trim();
  if (existing.categoryId.toString() !== input.categoryId) {
    await assertCategoryInRestaurant(restaurantId, input.categoryId);
  }
  await assertUniqueItemName(restaurantId, name, itemId);

  existing.name = name;
  existing.description = input.description?.trim() || null;
  existing.categoryId = input.categoryId as unknown as MenuItem["categoryId"];
  existing.itemType = input.itemType;
  existing.vegType = input.vegType;
  existing.imageUrl = input.imageUrl?.trim() || null;
  existing.hasVariants = input.hasVariants;
  existing.hsnSacCode = input.hsnSacCode?.trim() || null;
  existing.basePrice = input.hasVariants ? null : rupeesToPaise(input.basePriceRupees!);
  existing.isAvailable = input.isAvailable;
  existing.isActive = input.isActive;
  existing.displayOrder = input.displayOrder ?? existing.displayOrder;
  existing.taxOverride = normalizeTaxOverride(input.taxOverride);
  await existing.save();

  await reconcileVariants(restaurantId, itemId, input);

  return getMenuItemUnchecked(restaurantId, itemId);
}

async function reconcileVariants(
  restaurantId: string,
  menuItemId: string,
  input: MenuItemInput
): Promise<void> {
  const incoming = input.variants ?? [];

  const existing = await MenuVariantModel.find({
    restaurantId,
    menuItemId,
  }).lean();
  const existingById = new Map(existing.map((v) => [String(v._id), v]));

  const incomingIds: string[] = [];

  for (let i = 0; i < incoming.length; i += 1) {
    const variant = incoming[i];
    if (variant.id) {
      const current = existingById.get(variant.id);
      if (!current) {
        throw new MenuValidationError("One of the variants does not belong to this item.");
      }
      await assertUniqueVariantName(
        restaurantId,
        menuItemId,
        resolveVariantCode(variant),
        variant.id
      );
      incomingIds.push(variant.id);
      await MenuVariantModel.updateOne(
        { _id: variant.id, restaurantId, menuItemId },
        {
          $set: {
            ...toVariantDocument(
              restaurantId,
              menuItemId,
              variant,
              i
            ),
          },
        }
      );
    } else {
      await assertUniqueVariantName(restaurantId, menuItemId, resolveVariantCode(variant));
      const created = await MenuVariantModel.create(
        toVariantDocument(restaurantId, menuItemId, variant, i)
      );
      incomingIds.push(String(created._id));
    }
  }

  // Soft-remove variants of this item that are no longer listed (historical safety).
  await MenuVariantModel.updateMany(
    { restaurantId, menuItemId, _id: { $nin: incomingIds } },
    { $set: { isActive: false } }
  );
}

export async function deleteMenuItem(
  restaurantId: string,
  itemId: string
): Promise<void> {
  await connectDB();

  const item = await MenuItemModel.findOneAndUpdate(
    { _id: itemId, restaurantId },
    { $set: { isActive: false, isAvailable: false } },
    { returnDocument: "after" }
  );
  if (!item) throw new MenuNotFoundError("Item not found.");

  await MenuVariantModel.updateMany(
    { restaurantId, menuItemId: itemId },
    { $set: { isActive: false } }
  );
}

export async function toggleMenuItemAvailability(
  restaurantId: string,
  itemId: string,
  isAvailable: boolean
): Promise<MenuItemView> {
  await connectDB();
  const item = await MenuItemModel.findOneAndUpdate(
    { _id: itemId, restaurantId },
    { $set: { isAvailable } },
    { returnDocument: "after" }
  );
  if (!item) throw new MenuNotFoundError("Item not found.");
  return getMenuItemUnchecked(restaurantId, itemId);
}

export async function toggleMenuItemStatus(
  restaurantId: string,
  itemId: string,
  isActive: boolean
): Promise<MenuItemView> {
  await connectDB();
  // Deactivating also makes the item unavailable; activating makes it sellable
  // again immediately.
  const item = await MenuItemModel.findOneAndUpdate(
    { _id: itemId, restaurantId },
    { $set: { isActive, isAvailable: isActive } },
    { returnDocument: "after" }
  );
  if (!item) throw new MenuNotFoundError("Item not found.");
  return getMenuItemUnchecked(restaurantId, itemId);
}