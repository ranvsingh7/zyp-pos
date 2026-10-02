import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// The dialog shell is mounted client-side by Base UI (renders null on the
// server). Stub it out so renderToString exercises the form body itself.
vi.mock("@/components/ui/dialog", () => {
  function Pass({ children }: { children?: import("react").ReactNode }) {
    return children;
  }
  return {
    Dialog: Pass,
    DialogPopup: Pass,
    DialogHeader: Pass,
    DialogBody: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
  };
});

import mongoose from "mongoose";
import React from "react";
import { renderToString } from "react-dom/server";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { TableSectionModel } from "@/models/TableSection";
import { OrderModel } from "@/models/Order";
import { KotModel } from "@/models/KitchenOrderTicket";
import { BillModel } from "@/models/Bill";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import { createMenuItem } from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import { createOrder } from "@/lib/orders/order-service";
import { generateBill } from "@/lib/billing/bill-service";
import { getRestaurantTaxSettings } from "@/lib/billing/tax-settings";
import { resolveTaxOverridePayload } from "@/lib/menu/tax-visibility";
import { ItemForm } from "@/components/menu/item-form";
import type { MenuCategoryView, MenuItemView } from "@/lib/menu/types";
import type { MenuItemInput, MenuVariantInput } from "@/lib/menu/validation";
import type { TableInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_menutax_e2e";

const BY = "0123456789abcdef01234567";

let available = false;
let restaurantId = "";

const CATEGORY: MenuCategoryView = {
  id: "c00000000000000000000001",
  name: "Mains",
  description: null,
  displayOrder: 0,
  isActive: true,
};

const OVERRIDDEN_ITEM: MenuItemView = {
      id: "i00000000000000000000001",
      categoryId: CATEGORY.id,
      categoryName: CATEGORY.name,
      name: "Premium",
      description: null,
      itemType: "FOOD",
      vegType: "VEG",
      imageUrl: null,
      hasVariants: false,
      hsnSacCode: null,
  basePrice: 10000,
  isAvailable: true,
  isActive: true,
  displayOrder: 0,
  taxOverride: {
    enabled: true,
    taxRatePercent: 18,
    taxMode: "EXCLUSIVE",
    taxType: "IGST",
  },
  variants: [],
};

function renderItemForm(gstEnabled: boolean): string {
  return renderToString(
    React.createElement(ItemForm, {
      open: true,
      onClose: () => {},
      categories: [CATEGORY],
      initial: OVERRIDDEN_ITEM,
      gstEnabled,
      onSaved: () => {},
    })
  );
}

async function createRestaurant(name: string, gstRegistered: boolean): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `menutax-${Date.now()}-${Math.random()}@restopos.test`,
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
    gstRegistered,
    gstin: gstRegistered ? "29ABCDE1234F1Z5" : "",
    businessType: "Restaurant",
  });
  return result.restaurantId;
}

function item(name: string, overrides: Partial<MenuItemInput> = {}): MenuItemInput {
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

function variant(
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

function table(name: string, overrides: Partial<TableInput> = {}): TableInput {
  return {
    name,
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
    ...overrides,
  };
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
  await RestaurantTableModel.deleteMany({});
  await TableSectionModel.deleteMany({});
  await OrderModel.deleteMany({});
  await KotModel.deleteMany({});
  await BillModel.deleteMany({});
});

describe("Menu item/variant tax controls follow the restaurant GST status", () => {
  it(
    "gate the Tax (GST) Override UI on effective GST status",
    async () => {
      // No GST registration -> the override controls are completely absent,
      // even for an item that already carries a stored override.
      const hidden = renderItemForm(false);
      expect(hidden).not.toContain("Tax (GST) Override");
      expect(hidden).not.toContain("GST Rate");
      expect(hidden).not.toContain("Tax Mode");
      expect(hidden).not.toContain("Tax Type");
      expect(hidden).not.toContain("Enable item GST override");

      // GST-registered -> the full override section is rendered.
      const shown = renderItemForm(true);
      expect(shown).toContain("Tax (GST) Override");
      expect(shown).toContain("GST Rate");
      expect(shown).toContain("Tax Mode");
      expect(shown).toContain("Tax Type");
    },
    15000
  );

  it(
    "never charges GST and preserves stored overrides while GST registration is off",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Unregistered Kitchen", false);

      // Rogue/legacy state: settings claim tax is enabled at 18%, but the
      // restaurant is not GST-registered. Registration must win everywhere.
      await RestaurantSettingsModel.updateOne(
        { restaurantId },
        {
          $set: {
            taxEnabled: true,
            defaultTaxRate: 18,
            gstScheme: "INTER_STATE",
            taxInclusive: false,
            cgstRatePercent: 0,
            sgstRatePercent: 0,
            igstRatePercent: 18,
          },
        }
      );

      // The page derives the form's gstEnabled from the effective tax status.
      const taxSettings = await getRestaurantTaxSettings(restaurantId);
      expect(taxSettings.gstRegistered).toBe(false);
      expect(taxSettings.taxEnabled).toBe(false);

      const cat = await createCategory(restaurantId, {
        name: "Mains",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const overridden = await createMenuItem(
        restaurantId,
        item("Premium", {
          categoryId: cat.id,
          basePriceRupees: 100,
          taxOverride: {
            enabled: true,
            taxRatePercent: 18,
            taxMode: "EXCLUSIVE",
            taxType: "IGST",
          },
        })
      );

      // Editing never erases the stored override (hidden controls, data kept).
      const stored = await MenuItemModel.findOne({ _id: overridden.id }).lean();
      expect(stored?.taxOverride).toMatchObject({
        enabled: true,
        taxRatePercent: 18,
        taxMode: "EXCLUSIVE",
        taxType: "IGST",
      });

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: overridden.id, quantity: 1 }],
      });
      const bill = await generateBill(restaurantId, order.id, BY);
      expect(bill.gstRegistered).toBe(false);
      expect(bill.totalTaxPaise).toBe(0);
      expect(bill.cgstAmountPaise).toBe(0);
      expect(bill.sgstAmountPaise).toBe(0);
      expect(bill.igstAmountPaise).toBe(0);
      expect(bill.grandTotalPaise).toBe(10000);
      expect(bill.items[0].taxRatePercent).toBe(0);
    },
    30000
  );

  it(
    "charges the override and keeps the override UI live once the restaurant is GST-registered",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Registered Kitchen", true);
      await RestaurantSettingsModel.updateOne(
        { restaurantId },
        {
          $set: {
            taxEnabled: true,
            defaultTaxRate: 5,
            gstScheme: "INTRA_STATE",
            taxInclusive: false,
            cgstRatePercent: 2.5,
            sgstRatePercent: 2.5,
            igstRatePercent: 5,
          },
        }
      );

      const taxSettings = await getRestaurantTaxSettings(restaurantId);
      expect(taxSettings.gstRegistered).toBe(true);
      expect(taxSettings.taxEnabled).toBe(true);

      const cat = await createCategory(restaurantId, {
        name: "Mains",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const overridden = await createMenuItem(
        restaurantId,
        item("Premium", {
          categoryId: cat.id,
          hasVariants: true,
          basePriceRupees: null,
          variants: [
            variant("Full", 100, {
              taxOverride: {
                enabled: true,
                taxRatePercent: 18,
                taxMode: "EXCLUSIVE",
                taxType: "CGST_SGST",
              },
            }),
          ],
        })
      );
      const variantId = overridden.variants[0].id;

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: overridden.id, variantId, quantity: 1 }],
      });
      const bill = await generateBill(restaurantId, order.id, BY);
      expect(bill.gstRegistered).toBe(true);
      expect(bill.items[0].taxRatePercent).toBe(18);
      expect(bill.totalTaxPaise).toBe(1800);
      expect(bill.grandTotalPaise).toBe(11800);
    },
    30000
  );
});

describe("resolveTaxOverridePayload", () => {
  const existing = {
    enabled: true,
    taxRatePercent: 18,
    taxMode: "EXCLUSIVE" as const,
    taxType: "IGST" as const,
  };

  it("preserves stored overrides when GST is not enabled", () => {
    expect(resolveTaxOverridePayload(false, existing, {
      taxOverrideEnabled: false,
      taxRatePercent: "",
      taxMode: "",
      taxType: "",
    })).toEqual(existing);

    expect(resolveTaxOverridePayload(false, undefined, {
      taxOverrideEnabled: false,
      taxRatePercent: "",
      taxMode: "",
      taxType: "",
    })).toEqual({ enabled: false, taxRatePercent: null, taxMode: null, taxType: null });
  });

  it("applies the form fields when GST is enabled", () => {
    expect(resolveTaxOverridePayload(true, existing, {
      taxOverrideEnabled: true,
      taxRatePercent: "12",
      taxMode: "INCLUSIVE",
      taxType: "CGST_SGST",
    })).toEqual({
      enabled: true,
      taxRatePercent: 12,
      taxMode: "INCLUSIVE",
      taxType: "CGST_SGST",
    });

    expect(resolveTaxOverridePayload(true, existing, {
      taxOverrideEnabled: false,
      taxRatePercent: "",
      taxMode: "",
      taxType: "",
    })).toEqual({ enabled: false, taxRatePercent: null, taxMode: null, taxType: null });
  });
});