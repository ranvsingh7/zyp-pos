import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// The dialog shell renders null on the server; stub it so renderToString
// exercises the form body itself (same approach as tests/menu-tax-ui.test.ts).
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
import { createMenuItem, updateMenuItem, getMenuItem } from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import { createOrder } from "@/lib/orders/order-service";
import { generateBill } from "@/lib/billing/bill-service";
import { buildBillHtml } from "@/lib/billing/print";
import { getRestaurantTaxSettings } from "@/lib/billing/tax-settings";
import { menuItemInputSchema, firstZodMessage } from "@/lib/menu/validation";
import { HSN_SAC_CODE_MAX } from "@/lib/menu/constants";
import { resolveHsnSacPayload } from "@/lib/menu/tax-visibility";
import { ItemForm } from "@/components/menu/item-form";
import type { MenuCategoryView, MenuItemView } from "@/lib/menu/types";
import type { MenuItemInput, MenuVariantInput } from "@/lib/menu/validation";
import type { TableInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_hsnsac_e2e";

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

function menuItemView(overrides: Partial<MenuItemView> = {}): MenuItemView {
  return {
    id: "i00000000000000000000001",
    categoryId: CATEGORY.id,
    categoryName: CATEGORY.name,
    name: "Paneer Tikka",
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
      enabled: false,
      taxRatePercent: null,
      taxMode: null,
      taxType: null,
    },
    variants: [],
    ...overrides,
  };
}

function renderItemForm(gstEnabled: boolean, initial: MenuItemView): string {
  return renderToString(
    React.createElement(ItemForm, {
      open: true,
      onClose: () => {},
      categories: [CATEGORY],
      initial,
      gstEnabled,
      onSaved: () => {},
    })
  );
}

async function createRestaurant(
  name: string,
  gstRegistered: boolean
): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `hsnsac-${Date.now()}-${Math.random()}@restopos.test`,
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
  if (gstRegistered) {
    await RestaurantSettingsModel.updateOne(
      { restaurantId: result.restaurantId },
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
  }
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

function table(name: string): TableInput {
  return {
    name,
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
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

async function seedCategory(id: string): Promise<string> {
  const cat = await createCategory(id, {
    name: "Mains",
    description: undefined,
    displayOrder: 0,
    isActive: true,
  });
  return cat.id;
}

describe("HSN/SAC: menu item storage and validation", () => {
  it(
    "A. saves a trimmed code for a GST-enabled restaurant and returns it on the view",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Coded Kitchen", true);
      const cat = await seedCategory(restaurantId);

      const created = await createMenuItem(
        restaurantId,
        item("Paneer Tikka", { categoryId: cat, hsnSacCode: "  996311  " })
      );
      expect(created.hsnSacCode).toBe("996311");

      const stored = await MenuItemModel.findOne({ _id: created.id }).lean();
      expect(stored?.hsnSacCode).toBe("996311");
    },
    30000
  );

  it(
    "B. saves successfully with no code at all (null, not an empty string)",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Uncoded Kitchen", true);
      const cat = await seedCategory(restaurantId);

      const created = await createMenuItem(
        restaurantId,
        item("Water Bottle", { categoryId: cat })
      );
      expect(created.hsnSacCode).toBeNull();

      const stored = await MenuItemModel.findOne({ _id: created.id }).lean();
      expect(stored?.hsnSacCode ?? null).toBeNull();
    },
    30000
  );

  it(
    "B2. clears a code when the field is emptied, and rejects over-long / non-string values",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Editing Kitchen", true);
      const cat = await seedCategory(restaurantId);

      const created = await createMenuItem(
        restaurantId,
        item("Paneer Tikka", { categoryId: cat, hsnSacCode: "996311" })
      );

      const cleared = await updateMenuItem(restaurantId, created.id, {
        ...item("Paneer Tikka", { categoryId: cat }),
        hsnSacCode: "   ",
      });
      expect(cleared.hsnSacCode).toBeNull();

      // Server-side validation: length ceiling, and no coercion of non-strings.
      const tooLong = menuItemInputSchema.safeParse({
        ...item("Paneer Tikka", { categoryId: cat }),
        hsnSacCode: "9".repeat(HSN_SAC_CODE_MAX + 1),
      });
      expect(tooLong.success).toBe(false);

      for (const bad of [123, 996311, true, { code: "996311" }, ["996311"]]) {
        const parsed = menuItemInputSchema.safeParse({
          ...item("Paneer Tikka", { categoryId: cat }),
          hsnSacCode: bad,
        });
        expect(parsed.success).toBe(false);
      }

      // A blank string and an absent key are both valid (optional).
      expect(
        menuItemInputSchema.safeParse({
          ...item("Paneer Tikka", { categoryId: cat }),
          hsnSacCode: "",
        }).success
      ).toBe(true);
      expect(
        menuItemInputSchema.safeParse(
          item("Paneer Tikka", { categoryId: cat })
        ).success
      ).toBe(true);

      // The failure message is user-facing, not a stack trace.
      const msg = tooLong.success ? "" : firstZodMessage(tooLong);
      expect(msg).toContain(String(HSN_SAC_CODE_MAX));
    },
    30000
  );

  it(
    "C. hides the HSN/SAC field entirely when the restaurant is not GST-registered",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Non-GST Kitchen", false);
      const taxSettings = await getRestaurantTaxSettings(restaurantId);
      expect(taxSettings.gstRegistered).toBe(false);
      expect(taxSettings.taxEnabled).toBe(false);

      // A GST-enabled venue renders the field, label and input.
      const shown = renderItemForm(true, menuItemView());
      expect(shown).toContain("HSN / SAC Code (optional)");
      expect(shown).toContain("item-hsn-sac");

      // A non-GST venue must not expose the control at all.
      const hidden = renderItemForm(false, menuItemView());
      expect(hidden).not.toContain("HSN / SAC Code (optional)");
      expect(hidden).not.toContain("item-hsn-sac");

      // Non-GST restaurants still save fine with no code (no requirement).
      const cat = await seedCategory(restaurantId);
      const created = await createMenuItem(
        restaurantId,
        item("Street Chow", { categoryId: cat })
      );
      expect(created.hsnSacCode).toBeNull();
    },
    30000
  );

  it(
    "C2. does not wipe a stored code when a non-GST edit hides the field",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Deregistered Kitchen", false);
      const cat = await seedCategory(restaurantId);
      const created = await createMenuItem(
        restaurantId,
        item("Paneer Tikka", { categoryId: cat, hsnSacCode: "996311" })
      );

      // Hidden field -> the resolver keeps whatever the document already has.
      expect(resolveHsnSacPayload(false, created.hsnSacCode, "")).toBe("996311");
      // GST-enabled -> the entered value wins, blank clears it.
      expect(resolveHsnSacPayload(true, "996311", "  210690  ")).toBe("210690");
      expect(resolveHsnSacPayload(true, "996311", "")).toBeUndefined();
    },
    30000
  );
});

describe("HSN/SAC: snapshot integrity across order and bill", () => {
  it(
    "D/E/F. copies the code into the order and bill, then keeps old bills frozen after a menu edit",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Snapshot Kitchen", true);
      const cat = await seedCategory(restaurantId);

      const tikka = await createMenuItem(
        restaurantId,
        item("Paneer Tikka", { categoryId: cat, hsnSacCode: "996311" })
      );
      const water = await createMenuItem(
        restaurantId,
        item("Water Bottle", { categoryId: cat })
      );

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [
          { menuItemId: tikka.id, quantity: 2 },
          { menuItemId: water.id, quantity: 1 },
        ],
      });

      // Guard: a silently-unreachable DB would make every DB assertion below
      // vacuously pass via the `available` early-returns.
      expect(available).toBe(true);

      // D — the order snapshot carries the code, and only where one exists.
      const orderDoc = await OrderModel.findOne({ _id: order.id }).lean();
      const lines = orderDoc?.items ?? [];
      const tikkaLine = lines.find((l) => String(l.menuItemId) === tikka.id);
      const waterLine = lines.find((l) => String(l.menuItemId) === water.id);
      expect(tikkaLine?.hsnSacCode).toBe("996311");
      expect(waterLine?.hsnSacCode ?? null).toBeNull();
      expect(order.items[0].hsnSacCode).toBe("996311");

      // E — the bill snapshot inherits it from the order line.
      const bill = await generateBill(restaurantId, order.id, BY);
      const billDoc = await BillModel.findOne({ _id: bill.id }).lean();
      const billLines = billDoc?.items ?? [];
      expect(
        billLines.find((l) => String(l.menuItemId) === tikka.id)?.hsnSacCode
      ).toBe("996311");
      expect(
        billLines.find((l) => String(l.menuItemId) === water.id)?.hsnSacCode ??
          null
      ).toBeNull();
      expect(bill.items[0].hsnSacCode).toBe("996311");
      expect(bill.items[1].hsnSacCode).toBeNull();

      // F — editing the menu item afterwards must not rewrite history.
      await updateMenuItem(restaurantId, tikka.id, {
        ...item("Paneer Tikka", { categoryId: cat, hsnSacCode: "999999" }),
      });
      const menuNow = await getMenuItem(restaurantId, tikka.id);
      expect(menuNow?.hsnSacCode).toBe("999999");

      const billAfter = await BillModel.findOne({ _id: bill.id }).lean();
      expect(
        billAfter?.items.find((l) => String(l.menuItemId) === tikka.id)
          ?.hsnSacCode
      ).toBe("996311");

      const orderAfter = await OrderModel.findOne({ _id: order.id }).lean();
      expect(
        orderAfter?.items.find((l) => String(l.menuItemId) === tikka.id)
          ?.hsnSacCode
      ).toBe("996311");

      // KOT snapshots are untouched by the menu edit too.
      const kots = await KotModel.find({ orderId: order.id }).lean();
      for (const kot of kots) {
        expect(JSON.stringify(kot.items)).not.toContain("999999");
      }

      // Re-reading the bill through the service still serves the old value.
      const reloaded = await BillModel.findById(bill.id).lean();
      expect(
        reloaded?.items.find((l) => String(l.menuItemId) === tikka.id)
          ?.hsnSacCode
      ).toBe("996311");
    },
    30000
  );

  it(
    "D2. a variant line inherits the parent item's code (no variant-level field)",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Variant Kitchen", true);
      const cat = await seedCategory(restaurantId);

      const thali = await createMenuItem(
        restaurantId,
        item("Thali", {
          categoryId: cat,
          hsnSacCode: "996311",
          hasVariants: true,
          basePriceRupees: null,
          variants: [variant("Full", 250), variant("Half", 150)],
        })
      );
      // Variants carry no code field of their own (the model has no such
      // key), so the parent item's code is the only source.
      const variantDocs = await MenuVariantModel.find({
        menuItemId: thali.id,
      }).lean();
      expect(variantDocs).toHaveLength(2);
      for (const doc of variantDocs) {
        expect(
          "hsnSacCode" in (doc as unknown as Record<string, unknown>)
        ).toBe(false);
      }

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [
          { menuItemId: thali.id, variantId: thali.variants[0].id, quantity: 1 },
          { menuItemId: thali.id, variantId: thali.variants[1].id, quantity: 1 },
        ],
      });
      expect(order.items.every((l) => l.hsnSacCode === "996311")).toBe(true);

      const bill = await generateBill(restaurantId, order.id, BY);
      expect(bill.items.every((l) => l.hsnSacCode === "996311")).toBe(true);
    },
    30000
  );

  it(
    "14. keeps one restaurant's codes out of another restaurant's order and bill",
    async () => {
      if (!available) return;
      const otherId = await createRestaurant("Rival Kitchen", true);
      restaurantId = await createRestaurant("Home Kitchen", true);
      const homeCat = await seedCategory(restaurantId);
      const rivalCat = await seedCategory(otherId);

      const homeItem = await createMenuItem(
        restaurantId,
        item("Paneer Tikka", { categoryId: homeCat, hsnSacCode: "111111" })
      );
      const rivalItem = await createMenuItem(
        otherId,
        item("Paneer Tikka", { categoryId: rivalCat, hsnSacCode: "222222" })
      );

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: homeItem.id, quantity: 1 }],
      });
      const bill = await generateBill(restaurantId, order.id, BY);
      expect(bill.items[0].hsnSacCode).toBe("111111");

      // The rival item is invisible to this tenant.
      const leaked = await OrderModel.findOne({
        _id: order.id,
        "items.menuItemId": rivalItem.id,
      }).lean();
      expect(leaked).toBeNull();

      const rivalOrder = await OrderModel.find({ restaurantId: otherId }).lean();
      expect(rivalOrder.every((o) => o.items.every((l) => String(l.menuItemId) === rivalItem.id))).toBe(true);
    },
    30000
  );
});

describe("HSN/SAC: presentation", () => {
  it(
    "G/H. prints the configured code and omits it entirely for un-coded lines",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Print Kitchen", true);
      const cat = await seedCategory(restaurantId);

      const tikka = await createMenuItem(
        restaurantId,
        item("Paneer Tikka", { categoryId: cat, hsnSacCode: "996311" })
      );
      const water = await createMenuItem(
        restaurantId,
        item("Water Bottle", { categoryId: cat })
      );

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [
          { menuItemId: tikka.id, quantity: 1 },
          { menuItemId: water.id, quantity: 2 },
        ],
      });
      const bill = await generateBill(restaurantId, order.id, BY);
      const html = buildBillHtml(bill, {
        name: "Print Kitchen",
        address: "1 Food St",
        city: "Mumbai",
        state: "MA",
        pincode: "400001",
        phone: "9876543210",
        gstin: "29ABCDE1234F1Z5",
      });

      // The coded line shows its code; the uncoded line contributes no row.
      expect(html).toContain("HSN/SAC: 996311");
      expect(html.split("HSN/SAC:").length - 1).toBe(1);

      // Existing layout content is untouched.
      expect(html).toContain("Paneer Tikka");
      expect(html).toContain("Water Bottle");
      expect(html).toContain("GSTIN: 29ABCDE1234F1Z5");
      expect(html).toContain("GRAND TOTAL");
      expect(html).toContain("CGST @");
      expect(html).toContain("SGST @");
    },
    30000
  );

  it(
    "G2. a bill of un-coded items prints exactly as before (no HSN/SAC markup)",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Plain Kitchen", true);
      const cat = await seedCategory(restaurantId);
      const plain = await createMenuItem(
        restaurantId,
        item("Dal Rice", { categoryId: cat })
      );

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: plain.id, quantity: 1 }],
      });
      const bill = await generateBill(restaurantId, order.id, BY);
      const html = buildBillHtml(bill, {
        name: "Plain Kitchen",
        address: null,
        city: null,
        state: null,
        pincode: null,
        phone: null,
        gstin: null,
      });
      expect(html).not.toContain("HSN/SAC");
    },
    30000
  );

  it(
    "H2. a non-GST restaurant's bill is unchanged and carries no code",
    async () => {
      if (!available) return;
      restaurantId = await createRestaurant("Cash Only Kitchen", false);
      const cat = await seedCategory(restaurantId);
      const plain = await createMenuItem(
        restaurantId,
        item("Street Chow", { categoryId: cat, basePriceRupees: 50 })
      );

      const t1 = await createTable(restaurantId, table("T1"));
      const order = await createOrder(restaurantId, BY, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: plain.id, quantity: 2 }],
      });
      const bill = await generateBill(restaurantId, order.id, BY);
      expect(bill.items[0].hsnSacCode).toBeNull();
      expect(bill.gstRegistered).toBe(false);
      expect(bill.totalTaxPaise).toBe(0);
      expect(bill.grandTotalPaise).toBe(10000);
    },
    30000
  );
});
