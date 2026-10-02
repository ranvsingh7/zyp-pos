import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { TableSectionModel } from "@/models/TableSection";
import { OrderModel } from "@/models/Order";
import { KotModel, type KotItem } from "@/models/KitchenOrderTicket";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import {
  createMenuItem,
  updateMenuItem,
  toggleMenuItemStatus,
} from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import { getTables } from "@/lib/tables/table-service";
import {
  createOrder,
  updateOrder,
  holdOrder,
  resumeOrder,
  cancelOrder,
  sendOrderToKitchen,
  moveOrderToTable,
  getActiveOrders,
  getHeldOrders,
  getActiveOrderForTable,
  getOrder,
  validateMenuItemForOrder,
  validateVariantForOrder,
  validateTableForOrder,
} from "@/lib/orders/order-service";
import {
  OrderValidationError,
  OrderNotFoundError,
} from "@/lib/orders/errors";
import {
  printPendingKot,
  markKotPrinted,
  markKotSent,
  cancelKot,
  buildKotHtml,
  listOrderKots,
  listKots,
  pendingKitchenKind,
  toKotPrintedLine,
} from "@/lib/orders/kot-service";
import type { MenuItemInput, MenuVariantInput } from "@/lib/menu/validation";
import type { TableInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_orders_e2e";

let available = false;
let restaurantId = "";

async function createRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `orders-${Date.now()}-${Math.random()}@restopos.test`,
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

function item(
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

function variant(displayName: string, priceRupees: number, overrides: Partial<MenuVariantInput> = {}): MenuVariantInput {
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

function line(menuItemId: string, overrides: Record<string, unknown> = {}) {
  return { menuItemId, quantity: 1, ...overrides };
}

async function seed() {
  const cat = await createCategory(restaurantId, {
    name: "Mains",
    description: undefined,
    displayOrder: 0,
    isActive: true,
  });
  const plain = await createMenuItem(
    restaurantId,
    item("Plain", { categoryId: cat.id, basePriceRupees: 100 })
  );
  const fancy = await createMenuItem(
    restaurantId,
    item("Fancy", {
      categoryId: cat.id,
      hasVariants: true,
      basePriceRupees: null,
      variants: [variant("Half", 180), variant("Full", 320)],
    })
  );
  const other = await createMenuItem(
    restaurantId,
    item("Other", {
      categoryId: cat.id,
      hasVariants: true,
      basePriceRupees: null,
      variants: [variant("Small", 10)],
    })
  );
  const soldOut = await createMenuItem(
    restaurantId,
    item("SoldOut", { categoryId: cat.id, basePriceRupees: 50, isAvailable: false })
  );
  const doomed = await createMenuItem(
    restaurantId,
    item("Doomed", { categoryId: cat.id, basePriceRupees: 75 })
  );
  const t1 = await createTable(restaurantId, table("T1"));
  const t2 = await createTable(restaurantId, table("T2"));
  const t3 = await createTable(restaurantId, table("T3"));
  return { cat, plain, fancy, other, soldOut, doomed, t1, t2, t3 };
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    await KotModel.syncIndexes();
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
  restaurantId = await createRestaurant("Orders Test Kitchen");
});

describe("Orders module E2E against real MongoDB", () => {
  it(
    "creates a dine-in order with server snapshots, sequential order numbers and an occupied table",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();

      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });
      expect(created.orderNumber).toBe(1001);
      expect(created.status).toBe("OPEN");
      expect(created.tableId).toBe(t1.id);
      expect(created.tableNameSnapshot).toBe("T1");
      expect(created.items.length).toBe(1);
      expect(created.items[0].nameSnapshot).toBe("Plain");
      expect(created.items[0].unitPricePaise).toBe(10000);
      expect(created.items[0].quantity).toBe(2);
      expect(created.items[0].lineTotalPaise).toBe(20000);
      expect(created.totalPaise).toBe(20000);

      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("OCCUPIED");

      const second = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t2.id,
        items: [line(plain.id)],
      });
      expect(second.orderNumber).toBe(1002);

      const active = await getActiveOrders(restaurantId);
      expect(active.map((o) => o.orderNumber).sort((a, b) => b - a)).toEqual([
        1002, 1001,
      ]);
    },
    30000
  );

  it(
    "blocks a second active order for the same table (reopen, never duplicate)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      expect((await getActiveOrderForTable(restaurantId, t1.id))?.id).toBe(created.id);

      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "DINE_IN",
          tableId: t1.id,
          items: [line(plain.id)],
        })
      ).rejects.toThrow(OrderValidationError);

      expect(await OrderModel.countDocuments({ restaurantId, tableId: t1.id })).toBe(1);
    },
    30000
  );

  it(
    "races double-submit on an available table and still creates exactly one order",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();

      const results = await Promise.allSettled([
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "DINE_IN",
          tableId: t1.id,
          items: [line(plain.id)],
        }),
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "DINE_IN",
          tableId: t1.id,
          items: [line(plain.id)],
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBe(1);
      expect(await OrderModel.countDocuments({ restaurantId, tableId: t1.id })).toBe(1);
      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("OCCUPIED");
    },
    30000
  );

  it(
    "prices variant lines from the DB and requires the variant for variant items",
    async () => {
      if (!available) return;
      const { fancy, other, plain } = await seed();
      const half = fancy.variants.find((v) => v.displayName === "Half")!;

      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "QUICK_SALE",
        items: [line(fancy.id, { variantId: half.id })],
      });
      expect(created.items[0].variantNameSnapshot).toBe("Half");
      expect(created.items[0].unitPricePaise).toBe(18000);
      expect(created.totalPaise).toBe(18000);

      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "QUICK_SALE",
          items: [line(fancy.id)],
        })
      ).rejects.toThrow(/variant/i);

      // A variant id on a plain item is invalid too.
      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "QUICK_SALE",
          items: [line(plain.id, { variantId: half.id })],
        })
      ).rejects.toThrow(OrderValidationError);

      // A variant belonging to another item is rejected.
      const otherVariant = other.variants[0];
      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "QUICK_SALE",
          items: [line(fancy.id, { variantId: otherVariant.id })],
        })
      ).rejects.toThrow(OrderValidationError);
    },
    30000
  );

  it(
    "rejects unavailable, inactive and missing menu items",
    async () => {
      if (!available) return;
      const { soldOut, doomed } = await seed();

      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "QUICK_SALE",
          items: [line(soldOut.id)],
        })
      ).rejects.toThrow(/unavailable/i);

      await toggleMenuItemStatus(restaurantId, doomed.id, false);
      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "QUICK_SALE",
          items: [line(doomed.id)],
        })
      ).rejects.toThrow(/no longer on the menu/i);

      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "QUICK_SALE",
          items: [line("0123456789abcdef01234599")],
        })
      ).rejects.toThrow(OrderValidationError);
    },
    30000
  );

  it(
    "keeps historical snapshots immutable after the menu price changes",
    async () => {
      if (!available) return;
      const { cat, plain, t1 } = await seed();

      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      expect(order.items[0].unitPricePaise).toBe(10000);

      await updateMenuItem(
        restaurantId,
        plain.id,
        item("Plain", { categoryId: cat.id, basePriceRupees: 250 })
      );

      const reloaded = await getOrder(restaurantId, order.id);
      expect(reloaded?.items[0].unitPricePaise).toBe(10000);
      expect(reloaded?.totalPaise).toBe(10000);

      // Editing the order re-captures the current price.
      const updated = await updateOrder(restaurantId, order.id, {
        items: [line(plain.id)],
      });
      expect(updated.items[0].unitPricePaise).toBe(25000);
      expect(updated.totalPaise).toBe(25000);
    },
    30000
  );

  it(
    "stores optional customer info on takeaway and none on quick sale",
    async () => {
      if (!available) return;
      const { plain } = await seed();

      const takeaway = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "TAKEAWAY",
        customerName: "Ravi",
        customerPhone: "9876500000",
        orderNote: "Packed separately",
        items: [line(plain.id)],
      });
      expect(takeaway.orderType).toBe("TAKEAWAY");
      expect(takeaway.tableId).toBeNull();
      expect(takeaway.customerName).toBe("Ravi");
      expect(takeaway.customerPhone).toBe("9876500000");
      expect(takeaway.orderNote).toBe("Packed separately");

      const quick = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "QUICK_SALE",
        items: [line(plain.id)],
      });
      expect(quick.orderType).toBe("QUICK_SALE");
      expect(quick.tableId).toBeNull();
      expect(quick.customerName).toBeNull();
      expect(quick.customerPhone).toBeNull();
    },
    30000
  );

  it(
    "holds an order, frees the table and preserves every field for resume",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();

      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        customerName: "Meera",
        orderNote: "No onions",
        items: [line(plain.id, { note: "Extra spicy" })],
      });

      const held = await holdOrder(restaurantId, created.id);
      expect(held.status).toBe("HELD");
      expect(held.heldAt).not.toBeNull();
      expect(held.tableId).toBe(t1.id);
      expect(held.customerName).toBe("Meera");
      expect(held.orderNote).toBe("No onions");
      expect(held.items[0].note).toBe("Extra spicy");
      expect(held.items[0].nameSnapshot).toBe("Plain");

      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("AVAILABLE");

      const heldList = await getHeldOrders(restaurantId);
      expect(heldList.map((o) => o.id)).toContain(created.id);
      expect((await getActiveOrders(restaurantId)).map((o) => o.id)).not.toContain(
        created.id
      );
    },
    30000
  );

  it(
    "resumes a held order and re-occupies the table",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      await holdOrder(restaurantId, created.id);

      const resumed = await resumeOrder(restaurantId, created.id);
      expect(resumed.status).toBe("OPEN");
      expect(resumed.resumedAt).not.toBeNull();
      expect(resumed.tableId).toBe(t1.id);

      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("OCCUPIED");

      await expect(resumeOrder(restaurantId, created.id)).rejects.toThrow(
        /only held/i
      );
    },
    30000
  );

  it(
    "refuses to resume when the table is taken by another order",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();
      const held = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      await holdOrder(restaurantId, held.id);

      // t1 is free again; a new party takes it.
      await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      await expect(resumeOrder(restaurantId, held.id)).rejects.toThrow(
        OrderValidationError
      );

      // Resuming at a fresh table via move is not part of the resume flow.
      void t2;
    },
    30000
  );

  it(
    "cancels an open order with a reason and frees its table without deleting it",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      const cancelled = await cancelOrder(
        restaurantId,
        created.id,
        "0123456789abcdef01234570",
        "Customer walked out"
      );
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(cancelled.cancellationReason).toBe("Customer walked out");

      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("AVAILABLE");

      const doc = await OrderModel.findById(created.id);
      expect(doc).not.toBeNull();
      expect(doc?.status).toBe("CANCELLED");

      // Cancelled orders are not "active" anymore.
      expect((await getActiveOrders(restaurantId)).map((o) => o.id)).not.toContain(
        created.id
      );
    },
    30000
  );

  it(
    "cancels a held order too",
    async () => {
      if (!available) return;
      const { plain, t2 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t2.id,
        items: [line(plain.id)],
      });
      await holdOrder(restaurantId, created.id);
      const cancelled = await cancelOrder(restaurantId, created.id, "0123456789abcdef01234570");
      expect(cancelled.status).toBe("CANCELLED");
    },
    30000
  );

  it(
    "cannot cancel an order after it was sent to the kitchen",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      await sendOrderToKitchen(restaurantId, created.id);
      await expect(
        cancelOrder(restaurantId, created.id, "0123456789abcdef01234570")
      ).rejects.toThrow(OrderValidationError);
    },
    30000
  );

  it(
    "updates items, total, note and customer on an open order",
    async () => {
      if (!available) return;
      const { plain, fancy, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;

      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      const updated = await updateOrder(restaurantId, created.id, {
        items: [line(fancy.id, { variantId: full.id, quantity: 2 })],
        orderNote: "Window seat",
        customerName: "Kavya",
      });
      expect(updated.items.length).toBe(1);
      expect(updated.items[0].nameSnapshot).toBe("Fancy");
      expect(updated.totalPaise).toBe(64000);
      expect(updated.orderNote).toBe("Window seat");
      expect(updated.customerName).toBe("Kavya");
    },
    30000
  );

  it(
    "blocks edits after the order leaves OPEN (held / sent / cancelled)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();

      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      await holdOrder(restaurantId, order.id);
      await expect(
        updateOrder(restaurantId, order.id, { items: [line(plain.id)] })
      ).rejects.toThrow(OrderValidationError);

      await resumeOrder(restaurantId, order.id);
      await sendOrderToKitchen(restaurantId, order.id);
      await expect(
        updateOrder(restaurantId, order.id, { items: [line(plain.id)] })
      ).rejects.toThrow(OrderValidationError);
    },
    30000
  );

  it(
    "sends an open order to the kitchen once and stamps the timestamp",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      const sent = await sendOrderToKitchen(restaurantId, created.id);
      expect(sent.status).toBe("KOT_SENT");
      expect(sent.sentToKitchenAt).not.toBeNull();

      await expect(sendOrderToKitchen(restaurantId, created.id)).rejects.toThrow(
        /only open/i
      );

      const held = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "TAKEAWAY",
        items: [line(plain.id)],
      });
      await holdOrder(restaurantId, held.id);
      await expect(sendOrderToKitchen(restaurantId, held.id)).rejects.toThrow(
        /only open/i
      );
    },
    30000
  );

  it(
    "moves a dine-in order between tables and frees the source",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      const moved = await moveOrderToTable(restaurantId, created.id, t2.id);
      expect(moved.tableId).toBe(t2.id);
      expect(moved.tableNameSnapshot).toBe("T2");

      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("AVAILABLE");
      expect(tables.find((t) => t.id === t2.id)?.status).toBe("OCCUPIED");

      // Same table / occupied destination / non-dine-in / held are all rejected.
      await expect(
        moveOrderToTable(restaurantId, created.id, t2.id)
      ).rejects.toThrow(OrderValidationError);

      const other = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      await expect(
        moveOrderToTable(restaurantId, other.id, t2.id)
      ).rejects.toThrow(/active order/i);

      const quick = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "QUICK_SALE",
        items: [line(plain.id)],
      });
      await expect(
        moveOrderToTable(restaurantId, quick.id, t1.id)
      ).rejects.toThrow(/only dine-in/i);
    },
    30000
  );

  it(
    "enforces tenant isolation for orders, tables and menu items",
    async () => {
      if (!available) return;
      const { plain } = await seed();
      const other = await createRestaurant("Foreign Kitchen");
      const otherCat = await createCategory(other, {
        name: "Foreign",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const otherItem = await createMenuItem(
        other,
        item("Foreign Dish", { categoryId: otherCat.id, basePriceRupees: 999 })
      );
      const otherTable = await createTable(other, table("FT1"));
      await createOrder(other, "0123456789abcdef01234560", {
        orderType: "DINE_IN",
        tableId: otherTable.id,
        items: [line(otherItem.id)],
      });

      // Our restaurant never sees the foreign order.
      expect(await getActiveOrders(restaurantId)).toHaveLength(0);
      expect(await getHeldOrders(restaurantId)).toHaveLength(0);

      // We can't use the foreign table or item.
      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "DINE_IN",
          tableId: otherTable.id,
          items: [line(plain.id)],
        })
      ).rejects.toThrow(OrderValidationError);

      await expect(
        createOrder(restaurantId, "0123456789abcdef01234567", {
          orderType: "QUICK_SALE",
          items: [line(otherItem.id)],
        })
      ).rejects.toThrow(OrderValidationError);

      // Validators are tenant-scoped.
      expect(await validateMenuItemForOrder(restaurantId, otherItem.id)).toBeNull();
      expect(await validateTableForOrder(restaurantId, otherTable.id)).toBeNull();

      // Order numbering is per restaurant.
      const our = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "QUICK_SALE",
        items: [line(plain.id)],
      });
      expect(our.orderNumber).toBe(1001);
      const theirs = await createOrder(other, "0123456789abcdef01234560", {
        orderType: "QUICK_SALE",
        items: [line(otherItem.id)],
      });
      expect(theirs.orderNumber).toBe(1002);
    },
    30000
  );

  it(
    "validators return server-trusted details for sellable items",
    async () => {
      if (!available) return;
      const { plain, fancy, soldOut, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;

      const itemInfo = await validateMenuItemForOrder(restaurantId, plain.id);
      expect(itemInfo?.name).toBe("Plain");
      expect(itemInfo?.basePrice).toBe(10000);

      const variantInfo = await validateVariantForOrder(restaurantId, fancy.id, full.id);
      expect(variantInfo?.pricePaise).toBe(32000);

      expect(await validateMenuItemForOrder(restaurantId, soldOut.id)).toBeNull();
      expect((await validateTableForOrder(restaurantId, t1.id))?.status).toBe(
        "AVAILABLE"
      );
    },
    30000
  );

  it(
    "throws OrderNotFoundError for unknown orders",
    async () => {
      if (!available) return;
      await expect(
        holdOrder(restaurantId, "0123456789abcdef01234599")
      ).rejects.toThrow(OrderNotFoundError);
      await expect(
        getOrder(restaurantId, "0123456789abcdef01234599")
      ).resolves.toBeNull();
    },
    30000
  );

  it(
    "keeps an occupied table claimable after cancel so a fresh dine-in works",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const created = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      await cancelOrder(restaurantId, created.id, "0123456789abcdef01234570", "Re-seat");

      const fresh = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      expect(fresh.orderNumber).toBe(1002);
      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("OCCUPIED");
    },
    30000
  );
});

describe("KOT printing E2E against real MongoDB", () => {
  it(
    "saving an order neither prints nor marks any quantity, keeps it OPEN and the table occupied",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();

      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      expect(order.status).toBe("OPEN");
      expect(order.sentToKitchenAt).toBeNull();
      expect(await KotModel.countDocuments({ restaurantId })).toBe(0);
      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("OCCUPIED");
    },
    30000
  );

  it(
    "prints a first KOT as a complete order snapshot",
    async () => {
      if (!available) return;
      const { plain, fancy, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        orderNote: "No onions",
        items: [
          line(plain.id, { quantity: 2, note: "Extra spicy" }),
          line(fancy.id, { variantId: full.id }),
        ],
      });

      const { kot, hasPending } = await printPendingKot(
        restaurantId,
        order.id,
        "0123456789abcdef01234567"
      );

      expect(hasPending).toBe(true);
      expect(kot?.kotNumber).toBe("K-001");
      expect(kot?.type).toBe("NEW");
      expect(kot?.orderNumber).toBe(order.orderNumber);
      expect(kot?.orderType).toBe("DINE_IN");
      expect(kot?.tableName).toBe("T1");
      expect(kot?.orderNote).toBe("No onions");
      expect(kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 2, note: "Extra spicy", action: "ADDED" },
        { name: "Fancy", variant: "Full", quantity: 1, note: null, action: "ADDED" },
      ]);
      expect(kot?.printedCount).toBe(1);
      expect(kot?.printedAt).not.toBeNull();

      // Printing never changes the order's status.
      const reloaded = await getOrder(restaurantId, order.id);
      expect(reloaded?.status).toBe("OPEN");
      expect(reloaded?.sentToKitchenAt).toBeNull();
      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("OCCUPIED");
    },
    30000
  );

  it(
    "a second print creates an INCREMENTAL KOT with only the newly added lines",
    async () => {
      if (!available) return;
      const { plain, fancy, other, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.kotNumber).toBe("K-001");
      expect(first.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" },
      ]);

      // Order updated with two more lines.
      await updateOrder(restaurantId, order.id, {
        items: [
          line(plain.id),
          line(fancy.id, { variantId: full.id }),
          line(other.id, { variantId: other.variants[0].id }),
        ],
      });

      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(second.hasPending).toBe(true);
      expect(second.kot?.kotNumber).toBe("K-002");
      // Only brand-new lines (Fancy, Other) — nothing in the delta edits the
      // accumulated printed KOT, so the revision KOT stays NEW (not "Updated").
      expect(second.kot?.type).toBe("NEW");
      // Only the delta: Plain was already printed on K-001, so it is NOT repeated.
      expect(second.kot?.items).toEqual([
        { name: "Fancy", variant: "Full", quantity: 1, note: null, action: "ADDED" },
        { name: "Other", variant: "Small", quantity: 1, note: null, action: "ADDED" },
      ]);

      expect(await KotModel.countDocuments({ restaurantId })).toBe(2);
    },
    30000
  );

  it(
    "a quantity increase prints only the DELTA quantity",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.items).toEqual([{ name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" }]);

      // Roti × 2 printed, now Roti × 4 → only the extra 2 are pending.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 4 })],
      });

      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(second.kot?.kotNumber).toBe("K-002");
      expect(second.kot?.type).toBe("NEW");
      expect(second.kot?.items).toEqual([{ name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" }]);
    },
    30000
  );

  it(
    "reprint uses the stored KOT snapshot, never the current order",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });
      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.kotNumber).toBe("K-001");

      // Later the order grows to 4, but reprinting K-001 must still show 2.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 4 })],
      });

      const reprinted = await markKotPrinted(restaurantId, first.kot!.id);
      expect(reprinted.kotNumber).toBe("K-001");
      expect(reprinted.items).toEqual([{ name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" }]);
      expect(reprinted.printedCount).toBe(2);
    },
    30000
  );

  it(
    "printing with no changes reports hasPending:false and creates no KOT",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.hasPending).toBe(true);

      const again = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(again.hasPending).toBe(false);
      expect(again.kot).toBeNull();
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "rapid double-prints create exactly one KOT (server-side idempotency)",
    async () => {
      if (!available) return;
      const { fancy, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(fancy.id, { variantId: full.id, quantity: 2 })],
      });

      const results = await Promise.allSettled([
        printPendingKot(restaurantId, order.id, "0123456789abcdef01234567"),
        printPendingKot(restaurantId, order.id, "0123456789abcdef01234567"),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof printPendingKot>>> =>
          r.status === "fulfilled"
      );
      expect(fulfilled.length).toBe(2);
      expect(fulfilled.every((r) => r.value.hasPending)).toBe(true);
      const ids = new Set(fulfilled.map((r) => r.value.kot?.id));
      expect(ids.size).toBe(1);
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "treats each item + variant line as its own printed track",
    async () => {
      if (!available) return;
      const { fancy, t1 } = await seed();
      const half = fancy.variants.find((v) => v.displayName === "Half")!;
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(fancy.id, { variantId: full.id })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      await markKotSent(restaurantId, first.kot!.id);
      await updateOrder(restaurantId, order.id, {
        items: [
          line(fancy.id, { variantId: full.id }),
          line(fancy.id, { variantId: half.id }),
        ],
      });

      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      // Fancy Full was already printed on K-001 — only the new Half is pending.
      expect(second.kot?.items).toEqual([
        { name: "Fancy", variant: "Half", quantity: 1, note: null, action: "ADDED" },
      ]);
    },
    30000
  );

  it(
    "a note-only change on a fully-printed line prints nothing (never re-prints)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2, note: "Crispy" })],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      // The 2 units are printed; the printed budget is tracked per item, so
      // editing ONLY the note must not re-print that quantity.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 2, note: "Extra crispy" })],
      });

      const next = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(next.hasPending).toBe(false);
      expect(next.kot).toBeNull();
      // No K-002 was created; the printed KOT is untouched.
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "a note added to a partially-printed line re-prints only the unprinted portion",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 1, note: "Crispy" })],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      // Keep the printed line and add a NEW noted line for the same item. The
      // item/variant budget already covers the printed unit, so only the new
      // noted quantity is sent.
      await updateOrder(restaurantId, order.id, {
        items: [
          line(plain.id, { quantity: 1, note: "Crispy" }),
          line(plain.id, { quantity: 1, note: "Extra crispy" }),
        ],
      });

      const next = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(next.hasPending).toBe(true);
      expect(next.kot?.kotNumber).toBe("K-002");
      expect(next.kot?.type).toBe("NEW");
      expect(next.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 1, note: "Extra crispy", action: "ADDED" },
      ]);

      const same = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(same.hasPending).toBe(false);
      expect(same.kot).toBeNull();
    },
    30000
  );

  it(
    "a quantity decrease prints nothing — removals/decreases never reprint the old quantity",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 4 })],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      // Printed 4, now the order has 2 → nothing new to send to the kitchen.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 2 })],
      });

      const next = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(next.hasPending).toBe(false);
      expect(next.kot).toBeNull();
      // No K-002 was created; the printed KOT is untouched.
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "is tenant-scoped and rejects cancelled or unknown orders",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();

      // Foreign restaurant's order is invisible to ours.
      const other = await createRestaurant("Foreign Kitchen");
      const otherCat = await createCategory(other, {
        name: "Foreign",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const otherItem = await createMenuItem(
        other,
        item("Foreign Dish", { categoryId: otherCat.id, basePriceRupees: 999 })
      );
      const otherTable = await createTable(other, table("FT1"));
      const foreignOrder = await createOrder(other, "0123456789abcdef01234560", {
        orderType: "DINE_IN",
        tableId: otherTable.id,
        items: [line(otherItem.id)],
      });
      await expect(
        printPendingKot(restaurantId, foreignOrder.id, "0123456789abcdef01234567")
      ).rejects.toThrow(OrderNotFoundError);

      // Cancelled orders cannot print a fresh KOT.
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      await cancelOrder(restaurantId, order.id, "0123456789abcdef01234570", "Walkout");
      await expect(
        printPendingKot(restaurantId, order.id, "0123456789abcdef01234567")
      ).rejects.toThrow(/cancelled/i);

      // Unknown order.
      await expect(
        printPendingKot(restaurantId, "0123456789abcdef01234599", "0123456789abcdef01234567")
      ).rejects.toThrow(OrderNotFoundError);
    },
    30000
  );

  it(
    "prints takeaway and quick-sale KOTs with the right type header",
    async () => {
      if (!available) return;
      const { plain } = await seed();

      const takeaway = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "TAKEAWAY",
        customerName: "Ravi",
        items: [line(plain.id, { note: "No ice" })],
      });
      const tk = await printPendingKot(restaurantId, takeaway.id, "0123456789abcdef01234567");
      expect(tk.kot?.orderType).toBe("TAKEAWAY");
      expect(tk.kot?.tableName).toBeNull();
      expect(tk.kot?.customerName).toBe("Ravi");
      expect(tk.kot?.items[0].note).toBe("No ice");
      expect(tk.kot?.kotNumber).toBe("K-001");
      expect(buildKotHtml({ restaurantName: "T", kot: tk.kot! })).toContain("Takeaway");

      const quick = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "QUICK_SALE",
        items: [line(plain.id)],
      });
      const qk = await printPendingKot(restaurantId, quick.id, "0123456789abcdef01234567");
      expect(qk.kot?.orderType).toBe("QUICK_SALE");
      expect(qk.kot?.tableName).toBeNull();
      expect(qk.kot?.kotNumber).toBe("K-002");
      expect(buildKotHtml({ restaurantName: "T", kot: qk.kot! })).toContain("Quick Sale");
    },
    30000
  );

  it(
    "KOT history holds isolated snapshots and buildKotHtml renders one without prices",
    async () => {
      if (!available) return;
      const { plain, fancy, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        orderNote: "No onions",
        items: [
          line(plain.id, { quantity: 2, note: "Extra spicy" }),
          line(fancy.id, { variantId: full.id }),
        ],
      });

      const kot = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(kot.kot?.kotNumber).toBe("K-001");
      const html = buildKotHtml({ restaurantName: "Orders Test Kitchen", kot: kot.kot! });

      expect(html).toContain("Orders Test Kitchen");
      expect(html).toContain("K-001");
      expect(html).toContain(`#${order.orderNumber}`);
      expect(html).toContain("KITCHEN ORDER TICKET");
      expect(html).toContain("Table T1");
      expect(html).toContain("2 × Plain");
      expect(html).toContain("Full");
      expect(html).toContain("Extra spicy");
      expect(html).toContain("No onions");
      expect(html).not.toMatch(/[₹$£€¥]/);
      expect(html).not.toContain("10000");

      // After adding a new line, K-001's snapshot must not gain it and the new
      // print must carry only the genuinely new quantities (delta).
      await updateOrder(restaurantId, order.id, {
        items: [
          line(plain.id, { quantity: 2, note: "Extra spicy" }),
          line(fancy.id, { variantId: full.id }),
          line(plain.id, { quantity: 3 }),
        ],
      });
      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(second.kot?.kotNumber).toBe("K-002");
      expect(second.kot?.type).toBe("NEW");
      // Only the brand-new line (Plain, no note, ×3) — the printed lines from
      // K-001 are not repeated.
      expect(second.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 3, note: null, action: "ADDED" },
      ]);
      const secondHtml = buildKotHtml({ restaurantName: "T", kot: second.kot! });
      expect(secondHtml).toContain("KITCHEN ORDER TICKET");

      const history = await listOrderKots(restaurantId, order.id);
      expect(history.length).toBe(2);
      expect(history[0].kotNumber).toBe("K-001");
      expect(history[0].type).toBe("NEW");
      expect(history[0].items).toEqual([
        { name: "Plain", variant: null, quantity: 2, note: "Extra spicy", action: "ADDED" },
        { name: "Fancy", variant: "Full", quantity: 1, note: null, action: "ADDED" },
      ]);
      expect(history[1].kotNumber).toBe("K-002");
      expect(history[1].type).toBe("NEW");
      expect(history[1].items).toEqual([
        { name: "Plain", variant: null, quantity: 3, note: null, action: "ADDED" },
      ]);
    },
    30000
  );

  it(
    "intermediate edits collapse — 5→4→6 prints only the DELTA of 1 (TEST 1)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 5 })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.kotNumber).toBe("K-001");
      expect(first.kot?.items).toEqual([{ name: "Plain", variant: null, quantity: 5, note: null, action: "ADDED" }]);

      // Edited to 4 then 6 BEFORE the kitchen print — never saw either.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 4 })],
      });
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 6 })],
      });

      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(second.hasPending).toBe(true);
      expect(second.kot?.kotNumber).toBe("K-002");
      expect(second.kot?.type).toBe("NEW");
      // 5 were printed; the 6th is the only new quantity.
      expect(second.kot?.items).toEqual([{ name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" }]);
    },
    30000
  );

  it(
    "intermediate edits collapse — 5→3→4 prints nothing (TEST 2)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 5 })],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 3 })],
      });
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 4 })],
      });

      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      // 4 remaining is fewer than the 5 printed — nothing new to send.
      expect(second.hasPending).toBe(false);
      expect(second.kot).toBeNull();
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "remove then re-add between prints nets to same order — prints nothing (TEST 3)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.kotNumber).toBe("K-001");

      await updateOrder(restaurantId, order.id, { items: [] });
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 2 })],
      });

      const next = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(next.hasPending).toBe(false);
      expect(next.kot).toBeNull();
      // No K-002 was ever created.
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "a fully removed line prints nothing — the kitchen keeps the original KOT (TEST 4)",
    async () => {
      if (!available) return;
      const { plain, fancy, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [
          line(plain.id, { quantity: 3 }),
          line(fancy.id, { variantId: full.id }),
        ],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      // Plain is dropped entirely; Fancy stays untouched. Both were printed, so
      // there is no new quantity to send.
      await updateOrder(restaurantId, order.id, {
        items: [line(fancy.id, { variantId: full.id })],
      });

      const next = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(next.hasPending).toBe(false);
      expect(next.kot).toBeNull();
      const again = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(again.hasPending).toBe(false);
    },
    30000
  );

  it(
    "mixed increase + decrease in one edit prints only the increased delta (TEST 5)",
    async () => {
      if (!available) return;
      const { plain, fancy, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [
          line(plain.id, { quantity: 2 }),
          line(fancy.id, { variantId: full.id }),
        ],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      await updateOrder(restaurantId, order.id, {
        items: [
          line(plain.id, { quantity: 1 }),
          line(fancy.id, { variantId: full.id, quantity: 3 }),
        ],
      });

      const next = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(next.kot?.kotNumber).toBe("K-002");
      expect(next.kot?.type).toBe("NEW");
      // Plain went DOWN (2 printed → 1) → silent. Fancy went UP (1 → 3) → only
      // the extra 2 are printed.
      expect(next.kot?.items).toEqual([
        { name: "Fancy", variant: "Full", quantity: 2, note: null, action: "ADDED" },
      ]);
      const html = buildKotHtml({ restaurantName: "T", kot: next.kot! });
      expect(html).toContain("KITCHEN ORDER TICKET");
    },
    30000
  );

  it(
    "remove + re-add of two identical lines — same order prints nothing (TEST 6)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id), line(plain.id)],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" },
        { name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" },
      ]);

      await updateOrder(restaurantId, order.id, { items: [] });
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id), line(plain.id)],
      });

      const next = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(next.hasPending).toBe(false);
      expect(next.kot).toBeNull();
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "pendingKitchenKind labels the POS button ADD (first print) / MODIFY (new quantities) / null",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });

      // Fresh order: nothing printed yet → ADD (first print).
      const raw = await OrderModel.findById(order.id).lean();
      expect(pendingKitchenKind(
        { items: raw?.items, orderNote: raw?.orderNote } as Record<string, unknown>
      )).toBe("ADD");

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      // The printed ledger = every printed KOT item line.
      const printed = await KotModel.find({
        restaurantId,
        orderId: order.id,
        printedAt: { $ne: null },
      })
        .select("items")
        .lean();
      const printedLines = (printed as unknown as { items: KotItem[] }[]).flatMap(
        (kot) => kot.items.map(toKotPrintedLine)
      );

      // Nothing pending → null.
      expect(pendingKitchenKind(
        { items: raw?.items, orderNote: raw?.orderNote } as Record<string, unknown>,
        printedLines
      )).toBeNull();

      // A quantity DECREASE is silent (never reprints the old quantity) → null.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 1 })],
      });
      const rawDecreased = await OrderModel.findById(order.id).lean();
      expect(pendingKitchenKind(
        { items: rawDecreased?.items, orderNote: rawDecreased?.orderNote } as Record<string, unknown>,
        printedLines
      )).toBeNull();

      // A quantity INCREASE is pending (a revised delta KOT) → MODIFY.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 4 })],
      });
      const rawIncreased = await OrderModel.findById(order.id).lean();
      expect(pendingKitchenKind(
        { items: rawIncreased?.items, orderNote: rawIncreased?.orderNote } as Record<string, unknown>,
        printedLines
      )).toBe("MODIFY");
    },
    30000
  );

  it(
    "exposes a single derived pending delta without creating a KOT until printed",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 1 })],
      });

      // First print creates K-001 and clears the pending state.
      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenPrint).toBeNull();
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenItems).toEqual([]);
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);

      // Updating the order does NOT create a KOT record; the pending delta is
      // derived from persisted state, so it is visible after a reload.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 2 })],
      });
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenPrint).toBe(
        "MODIFY"
      );
      // 1 printed, 2 current → the surplus 1 is the pending delta.
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenItems).toEqual([
        { name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" },
      ]);

      // Multiple edits before printing still collapse to ONE pending delta that
      // only carries the surplus over what was already printed.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 3 })],
      });
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenPrint).toBe(
        "MODIFY"
      );
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenItems).toEqual([
        { name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" },
      ]);
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);

      // Printing creates exactly one NEW KOT with the pending delta.
      // Incremental KOTs are never marked UPDATED.
      const printed = await printPendingKot(
        restaurantId,
        order.id,
        "0123456789abcdef01234567"
      );
      expect(printed.kot?.type).toBe("NEW");
      expect(printed.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" },
      ]);
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenPrint).toBeNull();
      expect(await KotModel.countDocuments({ restaurantId })).toBe(2);

      // Returning the order to (or below) the printed quantities clears the
      // pending delta — old quantities are never re-sent.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 3 })],
      });
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenPrint).toBeNull();
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 2 })],
      });
      expect((await getOrder(restaurantId, order.id))?.pendingKitchenPrint).toBeNull();
    },
    30000
  );

  it(
    "REQUIRED 1: print Coffee+Tea, add Ban Maska, print again → only Ban Maska x1",
    async () => {
      if (!available) return;
      const { plain, fancy, other, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const small = other.variants.find((v) => v.displayName === "Small")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id), line(fancy.id, { variantId: full.id })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" },
        { name: "Fancy", variant: "Full", quantity: 1, note: null, action: "ADDED" },
      ]);

      await updateOrder(restaurantId, order.id, {
        items: [
          line(plain.id),
          line(fancy.id, { variantId: full.id }),
          line(other.id, { variantId: small.id }),
        ],
      });

      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      // Only the NEW item — Coffee and Tea are not repeated.
      expect(second.kot?.type).toBe("NEW");
      expect(second.kot?.items).toEqual([
        { name: "Other", variant: "Small", quantity: 1, note: null, action: "ADDED" },
      ]);
    },
    30000
  );

  it(
    "REQUIRED 2: print Roti x2, change to x5, print again → only Roti x3",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.items).toEqual([{ name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" }]);

      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 5 })],
      });

      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      // Only the surplus 3 arrive on a later KOT. Incremental KOTs are NEW —
      // never marked UPDATED (that label only existed for the removed EDIT path).
      expect(second.kot?.type).toBe("NEW");
      expect(second.kot?.items).toEqual([{ name: "Plain", variant: null, quantity: 3, note: null, action: "ADDED" }]);
    },
    30000
  );

  it(
    "REQUIRED 3: no changes after printing → no new KOT is created",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      const again = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(again.hasPending).toBe(false);
      expect(again.kot).toBeNull();
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);
    },
    30000
  );

  it(
    "REQUIRED 4: add Tea then Ban Maska before printing → ONE pending delta (both, Coffee excluded)",
    async () => {
      if (!available) return;
      const { plain, fancy, other, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const small = other.variants.find((v) => v.displayName === "Small")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id), line(fancy.id, { variantId: full.id })],
      });
      await updateOrder(restaurantId, order.id, {
        items: [
          line(plain.id),
          line(fancy.id, { variantId: full.id }),
          line(other.id, { variantId: small.id }),
        ],
      });

      // The two edits collapse into one derived pending state.
      const view = await getOrder(restaurantId, order.id);
      expect(view?.pendingKitchenPrint).toBe("MODIFY");
      expect(view?.pendingKitchenItems).toEqual([
        { name: "Fancy", variant: "Full", quantity: 1, note: null, action: "ADDED" },
        { name: "Other", variant: "Small", quantity: 1, note: null, action: "ADDED" },
      ]);
      expect(await KotModel.countDocuments({ restaurantId })).toBe(1);

      // Printing emits exactly one KOT carrying Coffee-free delta lines.
      const kot = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(kot.kot?.kotNumber).toBe("K-002");
      expect(kot.kot?.items).toEqual([
        { name: "Fancy", variant: "Full", quantity: 1, note: null, action: "ADDED" },
        { name: "Other", variant: "Small", quantity: 1, note: null, action: "ADDED" },
      ]);
    },
    30000
  );

  it(
    "REQUIRED 5: reprint uses the exact original printed snapshot",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });
      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      // The order changes, but the stored K-001 snapshot is immutable.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 4 })],
      });

      const reprinted = await markKotPrinted(restaurantId, first.kot!.id);
      expect(reprinted.kotNumber).toBe("K-001");
      expect(reprinted.items).toEqual([{ name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" }]);
    },
    30000
  );

  it(
    "listKots is a tenant-scoped newest-first feed",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      await updateOrder(restaurantId, order.id, { items: [line(plain.id, { quantity: 3 })] });
      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      const feed = await listKots(restaurantId);
      expect(feed.map((k) => k.kotNumber)).toEqual([second.kot?.kotNumber, first.kot?.kotNumber]);

      const limited = await listKots(restaurantId, 1);
      expect(limited.map((k) => k.kotNumber)).toEqual([second.kot?.kotNumber]);

      const otherRid = await createRestaurant("No Kot Feed");
      expect(await listKots(otherRid)).toEqual([]);
    },
    30000
  );

  it(
    "cancelKot marks the KOT CANCELLED, removes the items from the order, and cancels an emptied order",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(first.kot?.type).toBe("NEW");
      expect(first.kot?.status).toBe("ACTIVE");

      const cancelled = await cancelKot(restaurantId, first.kot!.id, "0123456789abcdef01234567", {
        reason: "Printed by mistake",
      });
      expect(cancelled.kot.status).toBe("CANCELLED");
      expect(cancelled.kot.cancellationReason).toBe("Printed by mistake");
      expect(cancelled.kot.cancelledAt).not.toBeNull();
      expect(cancelled.kot.cancelledBy).toBe("0123456789abcdef01234567");
      // The immutable snapshot is preserved.
      expect(cancelled.kot.items).toEqual([{ name: "Plain", variant: null, quantity: 2, note: null, action: "ADDED" }]);

      // The cancelled KOT's quantities leave the order: this was the only KOT,
      // so the order is emptied, cancelled in turn, and its table released.
      expect(cancelled.orderId).toBe(order.id);
      expect(cancelled.orderCancelled).toBe(true);
      const after = await getOrder(restaurantId, order.id);
      expect(after?.status).toBe("CANCELLED");
      expect(after?.items).toEqual([]);
      expect(after?.totalPaise).toBe(0);
      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("AVAILABLE");

      // A cancelled KOT still appears in the order KOT history.
      const history = await listOrderKots(restaurantId, order.id);
      expect(history.length).toBe(1);
      expect(history[0].kotNumber).toBe("K-001");
      expect(history[0].status).toBe("CANCELLED");

      // Double-cancel is rejected.
      await expect(
        cancelKot(restaurantId, first.kot!.id, "0123456789abcdef01234567")
      ).rejects.toThrow(OrderValidationError);

      // Rerepinting a cancelled KOT is rejected (server-side guard).
      await expect(
        markKotPrinted(restaurantId, first.kot!.id)
      ).rejects.toThrow(OrderValidationError);
    },
    30000
  );

  it(
    "a cancelled KOT never counts as printed — re-added items print again",
    async () => {
      if (!available) return;
      const { plain, other, t1 } = await seed();
      const small = other.variants.find((v) => v.displayName === "Small")!;
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id), line(other.id, { variantId: small.id })],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      // Add one more Plain and print the incremental delta.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 2 }), line(other.id, { variantId: small.id })],
      });
      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(second.kot?.kotNumber).toBe("K-002");
      expect(second.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" },
      ]);

      // Cancelling K-001 removes its quantities: one Plain + one Other Small
      // drop out of the order and the total is recomputed.
      const cancelled = await cancelKot(restaurantId, first.kot!.id, "0123456789abcdef01234567");
      expect(cancelled.orderId).toBe(order.id);
      expect(cancelled.orderCancelled).toBe(false);
      const live = await getOrder(restaurantId, order.id);
      expect(live?.status).toBe("OPEN");
      expect(live?.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity }))).toEqual([
        { name: "Plain", quantity: 1 },
      ]);
      expect(live?.totalPaise).toBe(10000);

      // Re-adding the cancelled Plain: cancellation is not a printed baseline,
      // so the re-added quantity must be sent to the kitchen again.
      await updateOrder(restaurantId, order.id, {
        items: [line(plain.id, { quantity: 2 }), line(other.id, { variantId: small.id })],
      });
      const third = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      expect(third.kot?.kotNumber).toBe("K-003");
      expect(third.kot?.type).toBe("NEW");
      expect(third.kot?.items).toEqual([
        { name: "Plain", variant: null, quantity: 1, note: null, action: "ADDED" },
        { name: "Other", variant: "Small", quantity: 1, note: null, action: "ADDED" },
      ]);
    },
    30000
  );

  it(
    "cancelled KOTs are excluded from the kitchen feed but stay in order history",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, "0123456789abcdef01234567", {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });

      const first = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");
      await updateOrder(restaurantId, order.id, { items: [line(plain.id, { quantity: 2 })] });
      const second = await printPendingKot(restaurantId, order.id, "0123456789abcdef01234567");

      await cancelKot(restaurantId, first.kot!.id, "0123456789abcdef01234567");

      // The kitchen feed excludes cancelled KOTs...
      const feed = await listKots(restaurantId);
      expect(feed.map((k) => k.kotNumber)).toEqual([second.kot?.kotNumber]);

      // ...while the order's KOT history still shows both snapshots.
      const history = await listOrderKots(restaurantId, order.id);
      expect(history.map((k) => k.kotNumber)).toEqual(["K-001", "K-002"]);
      expect(history.find((k) => k.kotNumber === "K-001")?.status).toBe("CANCELLED");
      expect(history.find((k) => k.kotNumber === "K-002")?.status).toBe("ACTIVE");
      expect(history.find((k) => k.kotNumber === "K-002")?.type).toBe("NEW");
    },
    30000
  );
});