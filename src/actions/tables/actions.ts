"use server";

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { tableDataTag } from "@/lib/cache-tags";
import { invalidateNextTag } from "@/lib/next-cache";
import {
  assertCanEditTables,
  assertCanChangeTableStatus,
} from "@/lib/tables/permissions";
import {
  createTable,
  updateTable,
  deleteTable,
  setTableActive,
  updateTableStatus,
  reorderTables,
} from "@/lib/tables/table-service";
import {
  createSection,
  updateSection,
  deleteSection,
  setSectionActive,
  reorderSections,
} from "@/lib/tables/section-service";
import { recordTableAudit } from "@/lib/tables/audit";
import {
  tableInputSchema,
  tableUpdateSchema,
  tableStatusSchema,
  tableActivationSchema,
  sectionInputSchema,
  sectionUpdateSchema,
  sectionReorderSchema,
  firstZodMessage,
} from "@/lib/tables/validation";
import type { TableStatus } from "@/lib/tables/constants";
import { wrapTableAction, type ActionResult } from "./_shared";

async function requireTableContext(permission: "edit" | "status") {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  if (permission === "edit") assertCanEditTables(user.role);
  else assertCanChangeTableStatus(user.role);
  return {
    restaurantId: String(restaurant.id),
    userId: String(user.id),
  };
}

function readId(input: unknown): string | null {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof (input as { id?: unknown }).id !== "string"
  ) {
    return null;
  }
  return (input as { id: string }).id;
}

export async function createTableAction(input: unknown): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId, userId } = await requireTableContext("edit");
    const parsed = tableInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const created = await createTable(restaurantId, parsed.data);
    await recordTableAudit({
      restaurantId,
      userId,
      action: "TABLE_CREATED",
      entityType: "TABLE",
      entityId: created.id,
      metadata: {
        name: created.name,
        capacity: created.capacity,
        sectionId: created.sectionId,
        status: created.status,
      },
    });
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id: created.id };
  });
}

export async function updateTableAction(input: unknown): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId, userId } = await requireTableContext("edit");
    const parsed = tableUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { id, ...fields } = parsed.data;
    const updated = await updateTable(restaurantId, id, fields);
    await recordTableAudit({
      restaurantId,
      userId,
      action: "TABLE_UPDATED",
      entityType: "TABLE",
      entityId: updated.id,
      metadata: {
        name: updated.name,
        capacity: updated.capacity,
        sectionId: updated.sectionId,
        status: updated.status,
        isActive: updated.isActive,
      },
    });
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id: updated.id };
  });
}

export async function updateTableStatusAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId, userId } = await requireTableContext("status");
    const parsed = tableStatusSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { id, status } = parsed.data;
    const updated = await updateTableStatus(restaurantId, id, status);
    await recordTableAudit({
      restaurantId,
      userId,
      action: "TABLE_STATUS_CHANGED",
      entityType: "TABLE",
      entityId: updated.id,
      metadata: { status, name: updated.name },
    });
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id: updated.id };
  });
}

export async function setTableActiveAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId, userId } = await requireTableContext("edit");
    const parsed = tableActivationSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { id, isActive } = parsed.data;
    const updated = await setTableActive(restaurantId, id, isActive);
    await recordTableAudit({
      restaurantId,
      userId,
      action: isActive ? "TABLE_ACTIVATED" : "TABLE_DEACTIVATED",
      entityType: "TABLE",
      entityId: updated.id,
      metadata: { isActive, name: updated.name },
    });
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id: updated.id };
  });
}
export async function deleteTableAction(input: unknown): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId } = await requireTableContext("edit");
    const id = readId(input);
    if (!id) return { success: false, message: "Invalid input." };
    await deleteTable(restaurantId, id);
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id };
  });
}

export async function reorderTablesAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId } = await requireTableContext("edit");
    if (
      typeof input !== "object" ||
      input === null ||
      !Array.isArray((input as { orderedIds?: unknown }).orderedIds)
    ) {
      return { success: false, message: "Invalid input." };
    }
    await reorderTables(
      restaurantId,
      (input as { orderedIds: string[] }).orderedIds
    );
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true };
  });
}

export async function createSectionAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId, userId } = await requireTableContext("edit");
    const parsed = sectionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const created = await createSection(restaurantId, parsed.data);
    await recordTableAudit({
      restaurantId,
      userId,
      action: "SECTION_CREATED",
      entityType: "SECTION",
      entityId: created.id,
      metadata: { name: created.name },
    });
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id: created.id };
  });
}

export async function updateSectionAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId, userId } = await requireTableContext("edit");
    const parsed = sectionUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    const { id, ...fields } = parsed.data;
    const updated = await updateSection(restaurantId, id, fields);
    await recordTableAudit({
      restaurantId,
      userId,
      action: "SECTION_UPDATED",
      entityType: "SECTION",
      entityId: updated.id,
      metadata: { name: updated.name, isActive: updated.isActive },
    });
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id: updated.id };
  });
}

export async function setSectionActiveAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId, userId } = await requireTableContext("edit");
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { id?: unknown }).id !== "string" ||
      typeof (input as { isActive?: unknown }).isActive !== "boolean"
    ) {
      return { success: false, message: "Invalid input." };
    }
    const { id, isActive } = input as { id: string; isActive: boolean };
    const updated = await setSectionActive(restaurantId, id, isActive);
    await recordTableAudit({
      restaurantId,
      userId,
      action: isActive ? "SECTION_UPDATED" : "SECTION_DEACTIVATED",
      entityType: "SECTION",
      entityId: updated.id,
      metadata: { name: updated.name, isActive },
    });
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true, id: updated.id };
  });
}

export async function deleteSectionAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId } = await requireTableContext("edit");
    const id = readId(input);
    if (!id) return { success: false, message: "Invalid input." };
    const result = await deleteSection(restaurantId, id);
    invalidateNextTag(tableDataTag(restaurantId));
    return {
      success: true,
      message: result.soft ? "Section deactivated." : "Section deleted.",
    };
  });
}

export async function reorderSectionsAction(
  input: unknown
): Promise<ActionResult> {
  return wrapTableAction(async () => {
    const { restaurantId } = await requireTableContext("edit");
    const parsed = sectionReorderSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed) };
    }
    await reorderSections(restaurantId, parsed.data.orderedIds);
    invalidateNextTag(tableDataTag(restaurantId));
    return { success: true };
  });
}

export type { TableStatus };