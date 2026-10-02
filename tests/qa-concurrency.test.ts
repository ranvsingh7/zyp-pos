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
import { SubscriptionModel } from "@/models/Subscription";
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
import { printPendingKot } from "@/lib/orders/kot-service";
import {
  generateBill,
  recordPayment,
} from "@/lib/billing/bill-service";
import { BillValidationError } from "@/lib/billing/errors";
import { OrderNotFoundError } from "@/lib/orders/errors";

const MONGODB_QA_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_qa";

let available = false;
let restaurantId = "";
let otherRestaurantId = "";
const userId = "0123456789abcdef01234567";

async function makeRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "QA Owner",
    email: `qa-conc-${Date.now()}-${Math.random()}@restopos.test`,
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

async function seedFor(rid: string) {
  const cat = await createCategory(rid, {
    name: "QA",
    description: undefined,
    displayOrder: 0,
    isActive: true,
  });
  const plain = await createMenuItem(rid, {
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
  const t1 = await createTable(rid, {
    name: "QT1",
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
  });
  return { cat, plain, t1 };
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
  restaurantId = await makeRestaurant("QA Kitchen A");
  otherRestaurantId = await makeRestaurant("QA Kitchen B");
});

describe("QA: KOT concurrency", () => {
  it(
    "double-click PRINT KOT creates exactly one KOT document",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedFor(restaurantId);
      const order = await createOrder(restaurantId, userId, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: plain.id, quantity: 2 }],
      });

      const [a, b] = await Promise.all([
        printPendingKot(restaurantId, order.id, userId),
        printPendingKot(restaurantId, order.id, userId),
      ]);

      expect(a.kot).toBeTruthy();
      expect(b.kot).toBeTruthy();
      expect(a.kot?.id).toBe(b.kot?.id);
      const count = await KotModel.countDocuments({ restaurantId, orderId: order.id });
      expect(count).toBe(1);
    },
    30000
  );

  it(
    "no new KOT when nothing is pending after a print",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedFor(restaurantId);
      const order = await createOrder(restaurantId, userId, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: plain.id, quantity: 1 }],
      });
      await printPendingKot(restaurantId, order.id, userId);
      const second = await printPendingKot(restaurantId, order.id, userId);
      expect(second.hasPending).toBe(false);
      expect(second.kot).toBeNull();
      const count = await KotModel.countDocuments({ restaurantId, orderId: order.id });
      expect(count).toBe(1);
    },
    30000
  );
});

describe("QA: payment double-submit + idempotency", () => {
  it(
    "concurrent payments with the same idempotency key charge exactly once",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedFor(restaurantId);
      const order = await createOrder(restaurantId, userId, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: plain.id, quantity: 2 }], // ₹200
      });
      const bill = await generateBill(restaurantId, order.id, userId);
      const total = bill.grandTotalPaise;

      await Promise.all([
        recordPayment(restaurantId, bill.id, userId, {
          method: "UPI",
          amountPaise: total,
          idempotencyKey: "pay-uuid-1",
        }),
        recordPayment(restaurantId, bill.id, userId, {
          method: "CASH",
          amountPaise: total,
          idempotencyKey: "pay-uuid-1",
        }),
      ]);

      const payments = await PaymentModel.find({ restaurantId, billId: bill.id });
      expect(payments.length).toBe(1);
      expect(["UPI", "CASH"]).toContain(payments[0].method);

      const refreshed = await BillModel.findById(bill.id).lean();
      expect(refreshed?.paidAmountPaise).toBe(total);
      expect(refreshed?.status).toBe("PAID");
    },
    30000
  );

  it(
    "an idempotency key cannot be replayed against a different bill",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedFor(restaurantId);
      const o1 = await createOrder(restaurantId, userId, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [{ menuItemId: plain.id, quantity: 1 }],
      });
      const b1 = await generateBill(restaurantId, o1.id, userId);
      await recordPayment(restaurantId, b1.id, userId, {
        method: "CASH",
        amountPaise: b1.grandTotalPaise,
        idempotencyKey: "shared-key",
      });

      // Second table/order via the same staff flow.
      const t2 = await createTable(restaurantId, {
        name: "QT2",
        capacity: 4,
        sectionId: null,
        status: "AVAILABLE",
        isActive: true,
      });
      const o2 = await createOrder(restaurantId, userId, {
        orderType: "DINE_IN",
        tableId: t2.id,
        items: [{ menuItemId: plain.id, quantity: 1 }],
      });
      const b2 = await generateBill(restaurantId, o2.id, userId);

      await expect(
        recordPayment(restaurantId, b2.id, userId, {
          method: "CASH",
          amountPaise: b2.grandTotalPaise,
          idempotencyKey: "shared-key",
        })
      ).rejects.toBeInstanceOf(BillValidationError);

      const b2payments = await PaymentModel.find({ billId: b2.id });
      expect(b2payments.length).toBe(0);
    },
    30000
  );
});

describe("QA: tenant isolation", () => {
  it(
    "restaurant A can never read or mutate restaurant B resources",
    async () => {
      if (!available) return;
      await seedFor(restaurantId);
      const b = await seedFor(otherRestaurantId);

      const orderB = await createOrder(otherRestaurantId, userId, {
        orderType: "DINE_IN",
        tableId: b.t1.id,
        items: [{ menuItemId: b.plain.id, quantity: 1 }],
      });
      const kotB = (await printPendingKot(otherRestaurantId, orderB.id, userId)).kot!;

      // Cross-tenant lookups must be invisible.
      await expect(
        createOrder(restaurantId, userId, {
          orderType: "DINE_IN",
          tableId: b.t1.id, // table from B
          items: [{ menuItemId: b.plain.id, quantity: 1 }], // item from B
        })
      ).rejects.toThrow();

      // getOrder across tenants -> null
      const crossRead = await import("@/lib/orders/order-service").then((m) =>
        m.getOrder(restaurantId, orderB.id)
      );
      expect(crossRead).toBeNull();

      // updateOrder / hold / cancel across tenants -> not found
      await expect(
        import("@/lib/orders/order-service").then((m) =>
          m.updateOrder(restaurantId, orderB.id, {
            items: [{ menuItemId: b.plain.id, quantity: 2 }],
          })
        )
      ).rejects.toBeInstanceOf(OrderNotFoundError);
      await expect(
        import("@/lib/orders/order-service").then((m) => m.holdOrder(restaurantId, orderB.id))
      ).rejects.toBeInstanceOf(OrderNotFoundError);
      await expect(
        import("@/lib/orders/order-service").then((m) =>
          m.cancelOrder(restaurantId, orderB.id, userId)
        )
      ).rejects.toBeInstanceOf(OrderNotFoundError);

      // KOT operations across tenants -> not found
      await expect(
        import("@/lib/orders/kot-service").then((m) => m.markKotPrinted(restaurantId, kotB.id))
      ).rejects.toThrow();
      await expect(
        import("@/lib/orders/kot-service").then((m) => m.cancelKot(restaurantId, kotB.id, userId))
      ).rejects.toThrow();
      const crossKots = await import("@/lib/orders/kot-service").then((m) =>
        m.listOrderKots(restaurantId, orderB.id)
      );
      expect(crossKots).toEqual([]);

      // Billing across tenants -> order not found
      await expect(
        generateBill(restaurantId, orderB.id, userId)
      ).rejects.toBeInstanceOf(BillValidationError);

      // Reporting: A's aggregate must not include B's order.
      const billB = await generateBill(otherRestaurantId, orderB.id, userId);
      await recordPayment(otherRestaurantId, billB.id, userId, {
        method: "CASH",
        amountPaise: billB.grandTotalPaise,
      });
      const { getDashboardSummary } = await import("@/lib/reports/dashboard-service");
      const [summaryA, summaryB] = await Promise.all([
        getDashboardSummary(restaurantId, { date: "today" }),
        getDashboardSummary(otherRestaurantId, { date: "today" }),
      ]);
      expect(summaryA.kpis.totalSalesPaise).toBe(0);
      expect(summaryB.kpis.totalSalesPaise).toBeGreaterThan(0);
    },
    30000
  );

  it(
    "identical table names in A and B coexist and never interfere",
    async () => {
      if (!available) return;
      await seedFor(restaurantId);
      const b = await seedFor(otherRestaurantId);
      const tableB = await import("@/lib/tables/table-service").then((m) =>
        m.getTables(otherRestaurantId)
      );
      expect(tableB.some((t) => t.id === b.t1.id)).toBe(true);
      const tableA = await import("@/lib/tables/table-service").then((m) =>
        m.getTables(restaurantId)
      );
      expect(tableA.some((t) => t.id === b.t1.id)).toBe(false);
    },
    30000
  );

  it(
    "the DB rejects a second restaurant for the same owner (onboarding race guard)",
    async () => {
      if (!available) return;
      const passwordHash = await hashPassword("Password123!");
      const user = await UserModel.create({
        fullName: "Race Owner",
        email: `qa-owner-${Date.now()}-${Math.random()}@restopos.test`,
        passwordHash,
        isActive: true,
      });
      await RestaurantModel.create({
        name: "First Venue",
        ownerId: user._id,
        phone: "9876543210",
        address: "1 St",
        city: "Mumbai",
        state: "MA",
        pincode: "400001",
        gstRegistered: false,
        businessType: "Restaurant",
        isActive: true,
      });
      await expect(
        RestaurantModel.create({
          name: "Second Venue",
          ownerId: user._id,
          phone: "9876543211",
          address: "2 St",
          city: "Mumbai",
          state: "MA",
          pincode: "400001",
          gstRegistered: false,
          businessType: "Restaurant",
          isActive: true,
        })
      ).rejects.toMatchObject({ code: 11000 });
    },
    30000
  );

  it(
    "the DB rejects a second subscription for the same restaurant",
    async () => {
      if (!available) return;
      await SubscriptionModel.syncIndexes();
      await SubscriptionModel.create({
        restaurantId,
        planId: new mongoose.Types.ObjectId(),
        listPricePaise: 0,
        finalPricePaise: 0,
        billingCycle: "MONTHLY",
        startDate: new Date(),
        expiryDate: new Date(Date.now() + 30 * 86400000),
        status: "TRIAL",
      });
      await expect(
        SubscriptionModel.create({
          restaurantId,
          planId: new mongoose.Types.ObjectId(),
          listPricePaise: 0,
          finalPricePaise: 0,
          billingCycle: "MONTHLY",
          startDate: new Date(),
          expiryDate: new Date(Date.now() + 30 * 86400000),
          status: "TRIAL",
        })
      ).rejects.toMatchObject({ code: 11000 });
    },
    30000
  );
});