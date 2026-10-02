import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { TableSectionModel } from "@/models/TableSection";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import {
  createTable,
  updateTable,
  deleteTable,
  updateTableStatus,
  setTableActive,
  getTables,
  reorderTables,
} from "@/lib/tables/table-service";
import {
  createSection,
  updateSection,
  deleteSection,
  setSectionActive,
  reorderSections,
  getSections,
} from "@/lib/tables/section-service";
import {
  TableValidationError,
  TableNotFoundError,
  SectionValidationError,
  SectionInUseError,
} from "@/lib/tables/errors";
import { recordTableAudit } from "@/lib/tables/audit";
import type { TableInput, SectionInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_tables_e2e";

let available = false;
let restaurantId = "";

async function createRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `tables-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash,
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name,
    ownerName: "Owner",
    phone: "9876543210",
    address: "1 Food St",
    city: "Mumbai",
    state: "MA",
    pincode: "400001",
    gstRegistered: false,
    gstin: "",
    businessType: "Restaurant",
  });
  return result.restaurantId;
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    available = true;
  } catch {
    available = false;
  }
}, 15000);

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!available) return;
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
  await RestaurantTableModel.deleteMany({});
  await TableSectionModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
  restaurantId = await createRestaurant("Tables Test Kitchen");
});

function table(
  name: string,
  capacity: number,
  overrides: Partial<TableInput> = {}
): TableInput {
  return {
    name,
    capacity,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
    ...overrides,
  };
}

function section(
  name: string,
  overrides: Partial<SectionInput> = {}
): SectionInput {
  return { name, isActive: true, ...overrides };
}

describe("Table module services against real MongoDB", () => {
  it(
    "creates sections and tables, validates and lists naturally sorted",
    async () => {
      if (!available) return;

      const ground = await createSection(restaurantId, section("Ground Floor"));
      const first = await createSection(restaurantId, section("First Floor"));
      expect(first.displayOrder).toBe(1);

      // displayOrder ties (all 0) → natural name sort → T1, T2, T3, T10.
      const t1 = await createTable(restaurantId, {
        ...table("T1", 4),
        sectionId: ground.id,
        displayOrder: 0,
      });
      const t2 = await createTable(restaurantId, table("T2", 2, { displayOrder: 0 }));
      await createTable(restaurantId, table("T10", 6, { displayOrder: 0 }));
      await createTable(restaurantId, table("T3", 8, { displayOrder: 0 }));

      const all = await getTables(restaurantId);
      expect(all.map((t) => t.name)).toEqual(["T1", "T2", "T3", "T10"]);
      expect(all.find((t) => t.id === t1.id)?.sectionName).toBe("Ground Floor");
      expect(all.find((t) => t.id === t2.id)?.sectionName).toBeNull();

      // Duplicate table name rejected case-insensitively within restaurant
      // (even against a deactivated table).
      await setTableActive(restaurantId, t2.id, false);
      await expect(
        createTable(restaurantId, table("t2", 4))
      ).rejects.toThrow(TableValidationError);

      // Same name is fine for another restaurant.
      const other = await createRestaurant("Other Seating");
      const otherTable = await createTable(other, table("T2", 4));
      expect(otherTable.name).toBe("T2");
    },
    30000
  );

  it(
    "updates table fields with tenant + section enforcement",
    async () => {
      if (!available) return;
      const ground = await createSection(restaurantId, section("Main"));
      const other = await createRestaurant("Foreign Kitchen");
      const foreignSection = await createSection(other, section("Foreign"));
      const foreignTable = await createTable(other, table("FT1", 4));

      const t1 = await createTable(restaurantId, table("T1", 4));
      const updated = await updateTable(restaurantId, t1.id, {
        ...table("T1 (Back)", 6),
        sectionId: ground.id,
        status: "RESERVED",
        isActive: true,
      });
      expect(updated.name).toBe("T1 (Back)");
      expect(updated.capacity).toBe(6);
      expect(updated.sectionId).toBe(ground.id);
      expect(updated.status).toBe("RESERVED");

      // Editing a foreign table must fail, not silently mutate.
      await expect(
        updateTable(restaurantId, foreignTable.id, table("Renamed", 2))
      ).rejects.toThrow(TableNotFoundError);

      // Assigning a foreign section to our table must fail.
      await expect(
        updateTable(restaurantId, t1.id, {
          ...table("T1 (Back)", 6),
          sectionId: foreignSection.id,
        })
      ).rejects.toThrow(TableValidationError);

      await expect(
        updateTable(restaurantId, "0123456789abcdef01234567" as never, table("Ghost", 2))
      ).rejects.toThrow(TableNotFoundError);
    },
    30000
  );

  it(
    "changes status, soft-deletes and reactivates tables",
    async () => {
      if (!available) return;
      const t1 = await createTable(restaurantId, table("T1", 4));

      const occupied = await updateTableStatus(restaurantId, t1.id, "OCCUPIED");
      expect(occupied.status).toBe("OCCUPIED");

      // Status change blocked on an inactive (soft-deleted) table.
      await setTableActive(restaurantId, t1.id, false);
      await expect(
        updateTableStatus(restaurantId, t1.id, "AVAILABLE")
      ).rejects.toThrow(TableNotFoundError);

      // Soft delete keeps the row but hides it from default listing.
      const active = await getTables(restaurantId);
      expect(active.some((t) => t.id === t1.id)).toBe(false);
      const all = await getTables(restaurantId, { includeInactive: true });
      expect(all.some((t) => t.id === t1.id)).toBe(true);

      // Reactivate.
      const reactivated = await setTableActive(restaurantId, t1.id, true);
      expect(reactivated.isActive).toBe(true);
      const back = await getTables(restaurantId);
      expect(back.some((t) => t.id === t1.id)).toBe(true);
    },
    30000
  );

  it(
    "hard deletes only references-free tables",
    async () => {
      if (!available) return;
      const t1 = await createTable(restaurantId, table("T1", 4));
      await deleteTable(restaurantId, t1.id);
      const leftover = await RestaurantTableModel.findById(t1.id);
      expect(leftover).toBeNull();

      await expect(
        deleteTable(restaurantId, t1.id)
      ).rejects.toThrow(TableNotFoundError);
    },
    30000
  );

  it(
    "reorders tables and keeps displayOrder persistent",
    async () => {
      if (!available) return;
      const a = await createTable(restaurantId, table("A", 2));
      const b = await createTable(restaurantId, table("B", 2));
      const c = await createTable(restaurantId, table("C", 2));

      const reordered = await reorderTables(restaurantId, [c.id, a.id, b.id]);
      expect(reordered.map((t) => t.id)).toEqual([c.id, a.id, b.id]);

      const again = await getTables(restaurantId);
      expect(again.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    },
    30000
  );

  it(
    "manages sections: reorder, rename, deactivate, block in-use delete",
    async () => {
      if (!available) return;
      const ground = await createSection(restaurantId, section("Ground"));
      const first = await createSection(restaurantId, section("First"));
      const roof = await createSection(restaurantId, section("Roof"));

      // Duplicate name (case-insensitive) rejected.
      await expect(
        createSection(restaurantId, section("GROUND"))
      ).rejects.toThrow(SectionValidationError);

      // Rename.
      const renamed = await updateSection(restaurantId, ground.id, section("Lobby"));
      expect(renamed.name).toBe("Lobby");

      // Reorder.
      const reordered = await reorderSections(restaurantId, [
        roof.id,
        first.id,
        ground.id,
      ]);
      expect(reordered.map((s) => s.id)).toEqual([roof.id, first.id, ground.id]);

      // A section holding active tables can only be deactivated, never deleted.
      await createTable(restaurantId, { ...table("T1", 4), sectionId: first.id });
      await expect(deleteSection(restaurantId, first.id)).rejects.toThrow(
        SectionInUseError
      );

      // Soft-cleanup: deactivating the section is allowed.
      await setSectionActive(restaurantId, first.id, false);
      const activeSections = await getSections(restaurantId);
      expect(activeSections.some((s) => s.id === first.id)).toBe(false);

      // A section with only inactive tables can be soft-deleted.
      await setTableActive(restaurantId, (
        await getTables(restaurantId, { includeInactive: true })
      ).find((t) => t.sectionId === first.id)!.id, false);
      const removed = await deleteSection(restaurantId, first.id);
      expect(removed.soft).toBe(true);
      const doc = await TableSectionModel.findById(first.id);
      expect(doc?.isActive).toBe(false);

      // An empty section is hard-deleted.
      const empty = await createSection(restaurantId, section("Empty"));
      const removedEmpty = await deleteSection(restaurantId, empty.id);
      expect(removedEmpty.soft).toBe(false);
      expect(await TableSectionModel.findById(empty.id)).toBeNull();
    },
    30000
  );

  it(
    "enforces tenant isolation for sections and tables",
    async () => {
      if (!available) return;
      const other = await createRestaurant("Island Kitchen");
      const theirSection = await createSection(other, section("Their Floor"));
      await createTable(other, { ...table("T1", 4), sectionId: theirSection.id });

      // Other tenant's section/table invisible to us.
      const sections = await getSections(restaurantId, { includeInactive: true });
      expect(sections).toHaveLength(0);
      const tables = await getTables(restaurantId, { includeInactive: true });
      expect(tables).toHaveLength(0);

      // Foreign section id cannot be attached to our table.
      await expect(
        createTable(restaurantId, { ...table("T9", 2), sectionId: theirSection.id })
      ).rejects.toThrow(TableValidationError);

      // Reorders cannot include foreign ids.
      await expect(
        reorderSections(restaurantId, [theirSection.id])
      ).rejects.toThrow(SectionValidationError);
    },
    30000
  );

  it(
    "writes table audit entries without failing the operation",
    async () => {
      if (!available) return;
      const t1 = await createTable(restaurantId, table("T1", 4));
      await recordTableAudit({
        restaurantId,
        userId: "0123456789abcdef01234567",
        action: "TABLE_CREATED",
        entityType: "TABLE",
        entityId: t1.id,
        metadata: { name: t1.name, capacity: t1.capacity },
      });
      const entries = await TableAuditLogModel.find({
        restaurantId,
        entityId: t1.id,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("TABLE_CREATED");
    },
    30000
  );
});