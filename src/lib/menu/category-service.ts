import "server-only";

import { connectDB } from "@/lib/db";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import {
  MenuNotFoundError,
  MenuValidationError,
  MenuCategoryInUseError,
} from "@/lib/menu/errors";
import {
  exactCaseInsensitiveRegex,
} from "@/lib/menu/utils";
import type { MenuCategoryInput } from "@/lib/menu/validation";
import type { MenuCategoryView } from "@/lib/menu/types";

export interface DeleteCategoryResult {
  deleted: true;
  soft: boolean;
}

function toView(doc: {
  _id: unknown;
  name: string;
  description?: string | null;
  displayOrder: number;
  isActive: boolean;
}): MenuCategoryView {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description ?? null,
    displayOrder: doc.displayOrder,
    isActive: doc.isActive,
  };
}

export interface ListCategoriesOptions {
  includeInactive?: boolean;
}

export async function getMenuCategories(
  restaurantId: string,
  options: ListCategoriesOptions = {}
): Promise<MenuCategoryView[]> {
  await connectDB();
  const query: Record<string, unknown> = { restaurantId };
  if (!options.includeInactive) query.isActive = true;

  const docs = await MenuCategoryModel.find(query)
    .sort({ displayOrder: 1, name: 1 })
    .lean();
  return docs.map((doc) => toView(doc as unknown as Parameters<typeof toView>[0]));
}

async function assertUniqueName(
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

  const existing = await MenuCategoryModel.findOne(query).select("_id").lean();
  if (existing) {
    throw new MenuValidationError(`A category named "${name}" already exists.`);
  }
}

export async function createCategory(
  restaurantId: string,
  input: MenuCategoryInput
): Promise<MenuCategoryView> {
  await connectDB();
  const name = input.name.trim();
  await assertUniqueName(restaurantId, name);

  const displayOrder =
    input.displayOrder ??
    (await MenuCategoryModel.countDocuments({ restaurantId }));

  const doc = await MenuCategoryModel.create({
    restaurantId,
    name,
    description: input.description?.trim() || null,
    displayOrder,
    isActive: input.isActive,
  });
  return toView(doc);
}

export async function updateCategory(
  restaurantId: string,
  categoryId: string,
  input: MenuCategoryInput
): Promise<MenuCategoryView> {
  await connectDB();
  const existing = await MenuCategoryModel.findOne({
    _id: categoryId,
    restaurantId,
  });
  if (!existing) throw new MenuNotFoundError("Category not found.");

  const name = input.name.trim();
  await assertUniqueName(restaurantId, name, categoryId);

  existing.name = name;
  existing.description = input.description?.trim() || null;
  existing.displayOrder = input.displayOrder ?? existing.displayOrder;
  existing.isActive = input.isActive;
  await existing.save();

  return toView(existing);
}

export async function toggleCategoryStatus(
  restaurantId: string,
  categoryId: string,
  isActive: boolean
): Promise<MenuCategoryView> {
  await connectDB();
  const doc = await MenuCategoryModel.findOneAndUpdate(
    { _id: categoryId, restaurantId },
    { $set: { isActive } },
    { returnDocument: "after" }
  );
  if (!doc) throw new MenuNotFoundError("Category not found.");
  return toView(doc);
}

export async function deleteCategory(
  restaurantId: string,
  categoryId: string
): Promise<DeleteCategoryResult> {
  await connectDB();

  const activeItems = await MenuItemModel.countDocuments({
    restaurantId,
    categoryId,
    isActive: true,
  });
  if (activeItems > 0) {
    throw new MenuCategoryInUseError();
  }

  const anyItems = await MenuItemModel.countDocuments({
    restaurantId,
    categoryId,
  });

  if (anyItems > 0) {
    // Category still referenced by historical (soft-deleted) items — soft delete.
    const doc = await MenuCategoryModel.findOneAndUpdate(
      { _id: categoryId, restaurantId },
      { $set: { isActive: false } },
      { returnDocument: "after" }
    );
    if (!doc) throw new MenuNotFoundError("Category not found.");
    return { deleted: true, soft: true };
  }

  const result = await MenuCategoryModel.deleteOne({ _id: categoryId, restaurantId });
  if (result.deletedCount === 0) {
    throw new MenuNotFoundError("Category not found.");
  }
  return { deleted: true, soft: false };
}

export async function reorderCategories(
  restaurantId: string,
  orderedIds: string[]
): Promise<MenuCategoryView[]> {
  await connectDB();

  const docs = await MenuCategoryModel.find({ restaurantId })
    .select("_id")
    .lean();
  const allowed = new Set(docs.map((d) => String(d._id)));
  if (orderedIds.some((id) => !allowed.has(id))) {
    throw new MenuValidationError("One or more categories do not belong to this restaurant.");
  }

  await Promise.all(
    orderedIds.map((id, index) =>
      MenuCategoryModel.updateOne(
        { _id: id, restaurantId },
        { $set: { displayOrder: index } }
      )
    )
  );

  return getMenuCategories(restaurantId, { includeInactive: true });
}