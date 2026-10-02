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
import { KotModel } from "@/models/KitchenOrderTicket";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import { createMenuItem } from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import { createOrder } from "@/lib/orders/order-service";

// QA concurrency audit. Runs against a dedicated DB on the isolated test Mongo
// (27018) — same pattern as the other e2e suites, but with a DB name of its own
// so it never interferes with the main e2e data.
const MONGODB_QA_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_qa_race";

let available = false;
let restaurantId = "";

async function createRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "QA Owner",
    email: `qa-race-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash,
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name,
    ownerName: "QA Owner",
    phone: "9876543210",
    address: "1 QA St",
    city: "Mumbai",
    state: "MA",
    pincode: "400001",
    gstRegistered: false,
    gstin: "",
    businessType: "Restaurant",
  });
  return result.restaurantId;
}

async function seed() {
  const cat = await createCategory(restaurantId, {
    name: "QA",
    description: undefined,
    displayOrder: 0,
    isActive: true,
  });
  const plain = await createMenuItem(restaurantId, {
    name: "QA Item",
    description: undefined,
    categoryId: cat.id,
    itemType: "FOOD",
    vegType: "VEG",
    hasVariants: false,
    basePriceRupees: 100,
    isAvailable: true,
    isActive: true,
    variants: [],
  });
  const t1 = await createTable(restaurantId, {
    name: "QT1",
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
  });
  const t2 = await createTable(restaurantId, {
    name: "QT2",
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
  });
  return { plain, t1, t2 };
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_QA_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    await OrderModel.syncIndexes();
    await KotModel.syncIndexes();
    await BillModel.syncIndexes();
    await PaymentModel.syncIndexes();
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
  await PaymentModel.deleteMany({});
  restaurantId = await createRestaurant("QA Race Kitchen");
});

describe("QA: order-number concurrency", () => {
  it(
    "concurrent TAKEAWAY creates never produce duplicate order numbers",
    async () => {
      if (!available) return;
      const { plain } = await seed();
      const userId = "0123456789abcdef01234567";

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          createOrder(restaurantId, userId, {
            orderType: "TAKEAWAY",
            items: [{ menuItemId: plain.id, quantity: 1 }],
          })
        )
      );

      const numbers = results.map((o) => o.orderNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(Math.max(...numbers) - Math.min(...numbers) + 1).toBe(numbers.length);
    },
    60000
  );

  it(
    "concurrent DINE_IN creates at different tables never produce duplicate order numbers",
    async () => {
      if (!available) return;
      const { plain } = await seed();
      const userId = "0123456789abcdef01234567";

      const tables = await Promise.all(
        Array.from({ length: 24 }, (_, i) =>
          createTable(restaurantId, {
            name: `RACET${i}`,
            capacity: 4,
            sectionId: null,
            status: "AVAILABLE",
            isActive: true,
          })
        )
      );

      const results = await Promise.all(
        tables.map((t) =>
          createOrder(restaurantId, userId, {
            orderType: "DINE_IN",
            tableId: t.id,
            items: [{ menuItemId: plain.id, quantity: 1 }],
          })
        )
      );

      const numbers = results.map((o) => o.orderNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    },
    60000
  );
});