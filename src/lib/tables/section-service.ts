import "server-only";

import { connectDB } from "@/lib/db";
import { TableSectionModel } from "@/models/TableSection";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import {
  SectionNotFoundError,
  SectionValidationError,
  SectionInUseError,
} from "@/lib/tables/errors";
import { exactCaseInsensitiveRegex, naturalCompare } from "@/lib/tables/utils";
import type { SectionInput } from "@/lib/tables/validation";
import type { TableSectionView } from "@/lib/tables/types";

export interface ListSectionsOptions {
  includeInactive?: boolean;
}

interface SectionDoc {
  _id: unknown;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export function sectionToView(doc: SectionDoc): TableSectionView {
  return {
    id: String(doc._id),
    name: doc.name,
    displayOrder: doc.displayOrder,
    isActive: doc.isActive,
  };
}

export async function getSections(
  restaurantId: string,
  options: ListSectionsOptions = {}
): Promise<TableSectionView[]> {
  await connectDB();

  const query: Record<string, unknown> = { restaurantId };
  if (!options.includeInactive) query.isActive = true;

  const docs = await TableSectionModel.find(query)
    .sort({ displayOrder: 1 })
    .lean();
  return docs
    .map((d) => sectionToView(d as unknown as SectionDoc))
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        naturalCompare(a.name, b.name) ||
        a.id.localeCompare(b.id)
    );
}

async function assertUniqueSectionName(
  restaurantId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const query: Record<string, unknown> = {
    restaurantId,
    name: exactCaseInsensitiveRegex(name),
  };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await TableSectionModel.findOne(query).select("_id").lean();
  if (existing) {
    throw new SectionValidationError(
      `A section named "${name}" already exists.`
    );
  }
}

export async function createSection(
  restaurantId: string,
  input: SectionInput
): Promise<TableSectionView> {
  await connectDB();
  const name = input.name.trim();
  await assertUniqueSectionName(restaurantId, name);

  const displayOrder =
    input.displayOrder ??
    (await TableSectionModel.countDocuments({ restaurantId }));

  const doc = await TableSectionModel.create({
    restaurantId,
    name,
    displayOrder,
    isActive: input.isActive,
  });
  return sectionToView(doc as unknown as SectionDoc);
}

export async function updateSection(
  restaurantId: string,
  sectionId: string,
  input: SectionInput
): Promise<TableSectionView> {
  await connectDB();
  const existing = await TableSectionModel.findOne({
    _id: sectionId,
    restaurantId,
  });
  if (!existing) throw new SectionNotFoundError();

  const name = input.name.trim();
  await assertUniqueSectionName(restaurantId, name, sectionId);

  existing.name = name;
  existing.displayOrder = input.displayOrder ?? existing.displayOrder;
  existing.isActive = input.isActive;
  await existing.save();

  return sectionToView(existing as unknown as SectionDoc);
}

export async function setSectionActive(
  restaurantId: string,
  sectionId: string,
  isActive: boolean
): Promise<TableSectionView> {
  await connectDB();
  const doc = await TableSectionModel.findOneAndUpdate(
    { _id: sectionId, restaurantId },
    { $set: { isActive } },
    { returnDocument: "after" }
  );
  if (!doc) throw new SectionNotFoundError();
  return sectionToView(doc as unknown as SectionDoc);
}

/**
 * Non-destructive delete: sections with active tables are deactivated instead of
 * deleted. Precise deactivation equals "soft delete"; deactivateSection() is the
 * preferred path and deleteSection() always falls back to deactivation.
 */
export async function deleteSection(
  restaurantId: string,
  sectionId: string
): Promise<{ deleted: true; soft: boolean }> {
  await connectDB();
  const section = await TableSectionModel.findOne({
    _id: sectionId,
    restaurantId,
  });
  if (!section) throw new SectionNotFoundError();

  const activeTables = await RestaurantTableModel.countDocuments({
    restaurantId,
    sectionId: sectionId as never,
    isActive: true,
  });

  if (activeTables > 0) {
    throw new SectionInUseError();
  }

  const anyTables = await RestaurantTableModel.countDocuments({
    restaurantId,
    sectionId: sectionId as never,
  });
  if (anyTables > 0) {
    const doc = await TableSectionModel.findOneAndUpdate(
      { _id: sectionId, restaurantId },
      { $set: { isActive: false } },
      { returnDocument: "after" }
    );
    if (!doc) throw new SectionNotFoundError();
    return { deleted: true, soft: true };
  }

  const result = await TableSectionModel.deleteOne({
    _id: sectionId,
    restaurantId,
  });
  if (result.deletedCount === 0) throw new SectionNotFoundError();
  return { deleted: true, soft: false };
}

export async function reorderSections(
  restaurantId: string,
  orderedIds: string[]
): Promise<TableSectionView[]> {
  await connectDB();

  const docs = await TableSectionModel.find({ restaurantId })
    .select("_id")
    .lean();
  const allowed = new Set(docs.map((d) => String(d._id)));
  if (orderedIds.some((id) => !allowed.has(id))) {
    throw new SectionValidationError(
      "One or more sections do not belong to this restaurant."
    );
  }

  await Promise.all(
    orderedIds.map((id, index) =>
      TableSectionModel.updateOne(
        { _id: id, restaurantId },
        { $set: { displayOrder: index } }
      )
    )
  );

  return getSections(restaurantId, { includeInactive: true });
}