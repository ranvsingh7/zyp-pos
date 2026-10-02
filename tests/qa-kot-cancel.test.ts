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
import { SubscriptionModel } from "@/models/Subscription";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import { createMenuItem } from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import {
  createOrder,
  updateOrder,
  getOrder,
} from "@/lib/orders/order-service";
import {
  printPendingKot,
  cancelKot,
  listOrderKots,
  markKotPrinted,
} from "@/lib/orders/kot-service";
import { OrderValidationError } from "@/lib/orders/errors";

// Own dedicated DB: a parallel vitest file sharing the same DB would wipe
// this file's fixtures in beforeEach (see qa-order-number-race for the fix).
const MONGODB_QA_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_qa_kot_cancel";

let available = false;
let restaurantId = "";
const userId = "0123456789abcdef01234567";

async function seedBasic() {
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
  return { plain };
}

async function seedTable() {
  return createTable(restaurantId, {
    name: "QT1",
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
  });
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_QA_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    await OrderModel.syncIndexes();
    await KotModel.syncIndexes();
    await BillModel.syncIndexes();
    await PaymentModel.syncIndexes();
    await RestaurantModel.syncIndexes();
    await SubscriptionModel.syncIndexes();
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
  await SubscriptionModel.deleteMany({});
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "QA Cashier",
    email: `qa-kot-cancel-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash,
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name: "QA Kitchen Cancel",
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
  restaurantId = result.restaurantId;
});

describe("QA: CANCELLED KOT history/timeline", () => {
  it(
    "cancel persists CANCELLED metadata that KOT history refetch returns (badge source)",
    async () => {
      if (!available) return;
      const { plain } = await seedBasic();
      const order = await createOrder(restaurantId, userId, {
        orderType: "TAKEAWAY",
        items: [{ menuItemId: plain.id, quantity: 2 }],
      });
      const printed = await printPendingKot(restaurantId, order.id, userId);
      expect(printed.kot).toBeTruthy();
      const kot = printed.kot!;

      const result = await cancelKot(restaurantId, kot.id, userId, {
        reason: "Printed by mistake",
      });
      expect(result.orderCancelled).toBe(true);

      // The exact payload rendered by KOT history (listOrderKots == refetch
      // after cancel; no page reload / table re-selection required). The KOT
      // stays visible in history — it is never hidden.
      const kots = await listOrderKots(restaurantId, order.id);
      expect(kots).toHaveLength(1);
      expect(kots[0].id).toBe(kot.id);
      expect(kots[0].status).toBe("CANCELLED");
      expect(kots[0].kotNumber).toBe(kot.kotNumber);
      expect(kots[0].cancelledAt).toBeTruthy();
      expect(kots[0].cancelledBy).toBe(userId);
      expect(kots[0].cancellationReason).toBe("Printed by mistake");

      // A later refetch (table switch / reload) still sees CANCELLED.
      const again = await listOrderKots(restaurantId, order.id);
      expect(again[0].status).toBe("CANCELLED");
      expect(again[0].cancelledAt).toBe(kots[0].cancelledAt);
    },
    30000
  );

  it(
    "active order excludes cancelled quantities; subtotal / pending print recompute",
    async () => {
      if (!available) return;
      const { plain } = await seedBasic();
      const order = await createOrder(restaurantId, userId, {
        orderType: "TAKEAWAY",
        items: [{ menuItemId: plain.id, quantity: 2 }],
      });
      const first = await printPendingKot(restaurantId, order.id, userId);
      expect(first.kot).toBeTruthy();

      // Incremental flow: add a second line, print only the delta.
      await updateOrder(restaurantId, order.id, {
        items: [
          { menuItemId: plain.id, quantity: 2 },
          { menuItemId: plain.id, quantity: 1 },
        ],
      });
      const second = await printPendingKot(restaurantId, order.id, userId);
      expect(second.kot).toBeTruthy();

      await cancelKot(restaurantId, first.kot!.id, userId, {
        reason: "Wrong quantity",
      });

      const refreshed = await getOrder(restaurantId, order.id);
      expect(refreshed).toBeTruthy();
      if (!refreshed) throw new Error("Expected the order to survive the cancel.");
      expect(refreshed.items).toHaveLength(1);
      expect(refreshed.items[0].quantity).toBe(1);
      expect(refreshed.totalPaise).toBe(10000); // ₹100 (basePriceRupees=100)

      // Nothing left to print: the cancelled KOT's quantities are excluded
      // from the pending delta (subtotal / billing run off this view too).
      const next = await printPendingKot(restaurantId, order.id, userId);
      expect(next.hasPending).toBe(false);

      const kots = await listOrderKots(restaurantId, order.id);
      expect(kots).toHaveLength(2);
      expect(kots.find((k) => k.id === first.kot!.id)?.status).toBe("CANCELLED");
      expect(kots.find((k) => k.id === second.kot!.id)?.status).toBe("ACTIVE");
    },
    30000
  );

  it(
    "emptied order auto-cancels and its table is released (lifecycle unchanged)",
    async () => {
      if (!available) return;
      const { plain } = await seedBasic();
      const t1 = await seedTable();
      const order = await createOrder(restaurantId, userId, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: plain.id, quantity: 1 }],
      });
      const printed = await printPendingKot(restaurantId, order.id, userId);
      expect(printed.kot).toBeTruthy();

      const occupied = await RestaurantTableModel.findById(t1.id).lean();
      expect(occupied?.status).toBe("OCCUPIED");

      const result = await cancelKot(restaurantId, printed.kot!.id, userId, {
        reason: "No stock",
      });
      expect(result.orderCancelled).toBe(true);

      const doc = await OrderModel.findById(order.id).lean();
      expect(doc?.status).toBe("CANCELLED");
      expect(doc?.totalPaise).toBe(0);
      expect(doc?.cancelledBy).toBeTruthy();

      const released = await RestaurantTableModel.findById(t1.id).lean();
      expect(released?.status).toBe("AVAILABLE");

      // The cancelled KOT is still in history for the cancelled order.
      const kots = await listOrderKots(restaurantId, order.id);
      expect(kots[0].status).toBe("CANCELLED");
    },
    30000
  );

  it(
    "a cancelled KOT cannot be reprinted; active KOTs still print (reprint flow unchanged)",
    async () => {
      if (!available) return;
      const { plain } = await seedBasic();
      const order = await createOrder(restaurantId, userId, {
        orderType: "TAKEAWAY",
        items: [{ menuItemId: plain.id, quantity: 2 }],
      });
      const first = await printPendingKot(restaurantId, order.id, userId);
      expect(first.kot).toBeTruthy();

      // Add a line, then print only the incremental delta.
      await updateOrder(restaurantId, order.id, {
        items: [
          { menuItemId: plain.id, quantity: 2 },
          { menuItemId: plain.id, quantity: 1 },
        ],
      });
      const second = await printPendingKot(restaurantId, order.id, userId);
      expect(second.kot).toBeTruthy();

      await cancelKot(restaurantId, first.kot!.id, userId, { reason: "Test" });

      await expect(
        markKotPrinted(restaurantId, first.kot!.id)
      ).rejects.toBeInstanceOf(OrderValidationError);

      const reprinted = await markKotPrinted(restaurantId, second.kot!.id);
      expect(reprinted.status).toBe("ACTIVE");
      expect(reprinted.printedCount).toBe(2);
    },
    30000
  );

  it(
    "double-cancel is rejected (idempotent, no duplicate state)",
    async () => {
      if (!available) return;
      const { plain } = await seedBasic();
      const order = await createOrder(restaurantId, userId, {
        orderType: "TAKEAWAY",
        items: [{ menuItemId: plain.id, quantity: 1 }],
      });
      const printed = await printPendingKot(restaurantId, order.id, userId);
      expect(printed.kot).toBeTruthy();
      const kotId = printed.kot!.id;

      await cancelKot(restaurantId, kotId, userId, { reason: "once" });
      await expect(
        cancelKot(restaurantId, kotId, userId, { reason: "twice" })
      ).rejects.toBeInstanceOf(OrderValidationError);

      const kots = await listOrderKots(restaurantId, order.id);
      expect(kots).toHaveLength(1);
      expect(kots[0].status).toBe("CANCELLED");
      expect(kots[0].cancellationReason).toBe("once");
    },
    30000
  );
});