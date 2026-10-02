import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  reorderCategories,
  getMenuCategories,
} from "@/lib/menu/category-service";
import {
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleMenuItemAvailability,
  toggleMenuItemStatus,
  getMenuItems,
} from "@/lib/menu/item-service";
import {
  createVariant,
  updateVariant,
  deleteVariant,
  toggleVariantStatus,
  getVariantsForItem,
} from "@/lib/menu/variant-service";
import {
  MenuNotFoundError,
  MenuValidationError,
  MenuCategoryInUseError,
} from "@/lib/menu/errors";
import type { MenuCategoryInput, MenuItemInput, MenuVariantInput } from "@/lib/menu/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_menu_e2e";

let available = false;
let restaurantId = "";

async function createRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `menu-${Date.now()}-${Math.random()}@restopos.test`,
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
  await MenuCategoryModel.deleteMany({});
  await MenuItemModel.deleteMany({});
  await MenuVariantModel.deleteMany({});
  restaurantId = await createRestaurant("Menu Test Kitchen");
});

function categoryInput(name: string, extra: Partial<MenuCategoryInput> = {}): MenuCategoryInput {
  return { name, description: undefined, displayOrder: undefined, isActive: true, ...extra };
}

function itemInput(
  name: string,
  overrides: Partial<MenuItemInput> = {}
): MenuItemInput {
  return {
    name,
    description: undefined,
    categoryId: "",
    itemType: "FOOD",
    vegType: "VEG",
    hasVariants: false,
    basePriceRupees: 100,
    isAvailable: true,
    isActive: true,
    variants: [],
    ...overrides,
  };
}

function variantInput(
  displayName: string,
  priceRupees: number,
  overrides: Partial<MenuVariantInput> = {}
): MenuVariantInput {
  return {
    displayName,
    priceRupees,
    sizeValue: null,
    sizeUnit: null,
    displayOrder: 0,
    isActive: true,
    ...overrides,
  };
}

describe("Menu module E2E against real MongoDB", () => {
  it(
    "creates, reads, updates, reorders and deletes categories",
    async () => {
      if (!available) return;

      const starters = await createCategory(restaurantId, categoryInput("Starters"));
      const mains = await createCategory(restaurantId, categoryInput("Main Course"));
      const desserts = await createCategory(restaurantId, categoryInput("Desserts"));
      expect(mains.displayOrder).toBe(1);

      const all = await getMenuCategories(restaurantId, { includeInactive: true });
      expect(all.map((c) => c.name).sort()).toEqual([
        "Desserts",
        "Main Course",
        "Starters",
      ]);

      // Duplicate name (case-insensitive) rejected among active categories.
      await expect(
        createCategory(restaurantId, categoryInput("starters"))
      ).rejects.toThrow(MenuValidationError);

      // Rename + reorder.
      const renamed = await updateCategory(restaurantId, starters.id, {
        ...categoryInput("Sides"),
      });
      expect(renamed.name).toBe("Sides");

      const moved = await reorderCategories(restaurantId, [
        desserts.id,
        mains.id,
        starters.id,
      ]);
      expect(moved.map((c) => c.id)).toEqual([desserts.id, mains.id, starters.id]);

      // Toggle off.
      const toggled = await toggleCategoryStatus(restaurantId, starters.id, false);
      expect(toggled.isActive).toBe(false);
      const activeOnly = await getMenuCategories(restaurantId);
      expect(activeOnly.some((c) => c.id === starters.id)).toBe(false);

      // Delete a category with no items (hard delete).
      const empty = await createCategory(restaurantId, categoryInput("Empty"));
      const result = await deleteCategory(restaurantId, empty.id);
      expect(result.deleted).toBe(true);
      expect(result.soft).toBe(false);
      await expect(
        getMenuCategories(restaurantId, { includeInactive: true })
      ).resolves.not.toThrow();
    },
    30000
  );

  it(
    "blocks category deletion while active items exist",
    async () => {
      if (!available) return;
      const cat = await createCategory(restaurantId, categoryInput("Drinks"));
      await createMenuItem(
        restaurantId,
        itemInput("Chai", { categoryId: cat.id, basePriceRupees: 10 })
      );
      await expect(deleteCategory(restaurantId, cat.id)).rejects.toThrow(
        MenuCategoryInUseError
      );
    },
    30000
  );

  it(
    "creates an item with variants and reconciles updates",
    async () => {
      if (!available) return;
      const cat = await createCategory(restaurantId, categoryInput("Breads"));

      const created = await createMenuItem(restaurantId, {
        ...itemInput("Butter Naan", {
          categoryId: cat.id,
          hasVariants: true,
          basePriceRupees: null,
          variants: [
            variantInput("Whole", 60),
            variantInput("Half", 30, { sizeValue: 1, sizeUnit: "PCS" }),
          ],
        }),
      });
      expect(created.hasVariants).toBe(true);
      expect(created.basePrice).toBeNull();
      expect(created.variants).toHaveLength(2);

      const half = created.variants.find((v) => v.displayName === "Half");
      expect(half?.pricePaise).toBe(3000);
      expect(half?.sizeUnit).toBe("PCS");

      // Update: rename a variant, add a new one; "Half" stays, add 1 extra.
      const whole = created.variants.find((v) => v.displayName === "Whole");
      const updated = await updateMenuItem(restaurantId, created.id, {
        ...itemInput("Butter Naan", {
          categoryId: cat.id,
          hasVariants: true,
          basePriceRupees: null,
          variants: [
            { ...variantInput("Whole", 60), id: whole!.id },
            { ...variantInput("Quarter", 20), id: half!.id },
            variantInput("Mini", 15),
          ],
        }),
      });
      expect(updated.variants).toHaveLength(3);
      expect(updated.variants.map((v) => v.displayName)).toEqual([
        "Whole",
        "Quarter",
        "Mini",
      ]);
      expect(updated.variants.find((v) => v.displayName === "Quarter")?.pricePaise).toBe(2000);

      const items = await getMenuItems(restaurantId);
      expect(items.length).toBe(1);
      expect(items[0].variants.length).toBe(3);
    },
    30000
  );

  it(
    "soft-deletes items and variants; toggle availability and status",
    async () => {
      if (!available) return;

      const cat = await createCategory(restaurantId, categoryInput("Starters"));
      const item = await createMenuItem(
        restaurantId,
        itemInput("Samosa", {
          categoryId: cat.id,
          hasVariants: true,
          basePriceRupees: null,
          variants: [variantInput("1 pc", 20), variantInput("2 pc", 35)],
        })
      );

      // Toggle availability (no permission check at service layer — caller checks).
      const unavailable = await toggleMenuItemAvailability(restaurantId, item.id, false);
      expect(unavailable.isAvailable).toBe(false);

      // Toggle status.
      const deactivated = await toggleMenuItemStatus(restaurantId, item.id, false);
      expect(deactivated.isActive).toBe(false);
      expect(deactivated.isAvailable).toBe(false);

      // Delete: soft-delete.
      await deleteMenuItem(restaurantId, item.id);
      const docs = await MenuItemModel.findOne({ _id: item.id });
      expect(docs?.isActive).toBe(false);
      const variantDocs = await MenuVariantModel.find({ menuItemId: item.id });
      expect(variantDocs.every((v) => !v.isActive)).toBe(true);

      // Standing-it-up again exports as active + available.
      const reactivated = await toggleMenuItemStatus(restaurantId, item.id, true);
      expect(reactivated.isActive).toBe(true);
      expect(reactivated.isAvailable).toBe(true);
    },
    30000
  );

  it(
    "enforces tenant isolation across restaurants",
    async () => {
      if (!available) return;

      const otherRestaurantId = await createRestaurant("Other Kitchen");

      const catA = await createCategory(restaurantId, categoryInput("Sweets"));
      await createMenuItem(
        restaurantId,
        itemInput("Gulab Jamun", { categoryId: catA.id, basePriceRupees: 30 })
      );

      const otherCat = await createCategory(otherRestaurantId, categoryInput("Starters"));
      await createMenuItem(
        otherRestaurantId,
        itemInput("Chicken Wings", { categoryId: otherCat.id, basePriceRupees: 150 })
      );

      // Foreign ops on the other tenant's data must fail.
      await expect(
        updateCategory(restaurantId, otherCat.id, categoryInput("Renamed"))
      ).rejects.toThrow(MenuNotFoundError);
      await expect(
        deleteCategory(restaurantId, otherCat.id)
      ).rejects.toThrow(MenuNotFoundError);

      const items = await getMenuItems(restaurantId);
      expect(items.map((i) => i.name)).toEqual(["Gulab Jamun"]);
      const itemsB = await getMenuItems(otherRestaurantId);
      expect(itemsB.map((i) => i.name)).toEqual(["Chicken Wings"]);

      // Duplicate item names are scoped per restaurant.
      const catB = await createCategory(restaurantId, categoryInput("Mains"));
      await createMenuItem(restaurantId, itemInput("Paneer", { categoryId: catA.id }));
      await expect(
        createMenuItem(restaurantId, itemInput("paneer", { categoryId: catB.id }))
      ).rejects.toThrow(MenuValidationError);
      await createMenuItem(otherRestaurantId, itemInput("Paneer", { categoryId: otherCat.id }));
    },
    30000
  );

  it(
    "exposes standalone variant operations scoped to an item",
    async () => {
      if (!available) return;
      const cat = await createCategory(restaurantId, categoryInput("Beverages"));
      const item = await createMenuItem(
        restaurantId,
        itemInput("Cold Drink", {
          categoryId: cat.id,
          hasVariants: true,
          basePriceRupees: null,
          variants: [variantInput("250 ml", 20)],
        })
      );

      const added = await createVariant(
        restaurantId,
        item.id,
        variantInput("500 ml", 30)
      );
      expect(added.pricePaise).toBe(3000);

      const renamed = await updateVariant(restaurantId, added.id, {
        ...variantInput("600 ml", 35, { sizeValue: 600, sizeUnit: "ML" }),
      });
      expect(renamed.displayName).toBe("600 ml");
      expect(renamed.sizeUnit).toBe("ML");

      const toggled = await toggleVariantStatus(restaurantId, added.id, false);
      expect(toggled.isActive).toBe(false);

      const list = await getVariantsForItem(restaurantId, item.id);
      expect(list).toHaveLength(2);
      expect(list.find((v) => v.id === added.id)?.isActive).toBe(false);

      await deleteVariant(restaurantId, added.id);
      const after = await getVariantsForItem(restaurantId, item.id);
      expect(after.find((v) => v.id === added.id)?.isActive).toBe(false);

      await expect(
        getVariantsForItem(restaurantId, "000000000000000000000000")
      ).rejects.toThrow(MenuNotFoundError);
    },
    30000
  );
});