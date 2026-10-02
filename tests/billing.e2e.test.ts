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
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import { createMenuItem, updateMenuItem } from "@/lib/menu/item-service";
import { createTable, getTables } from "@/lib/tables/table-service";
import { createOrder, getOrder, holdOrder, cancelOrder } from "@/lib/orders/order-service";
import {
  generateBill,
  getBill,
  getBillForOrder,
  listBills,
  recordPayment,
  completePayment,
  cancelBill,
  markBillPrinted,
} from "@/lib/billing/bill-service";
import {
  BillAlreadyPaidError,
  BillNotFoundError,
  BillNotPayableError,
  BillValidationError,
  OverpaymentError,
} from "@/lib/billing/errors";
import type { MenuItemInput, MenuVariantInput } from "@/lib/menu/validation";
import type { TableInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_billing_e2e";

let available = false;
let restaurantId = "";

const OWNER = "0123456789abcdef01234567";
const CASHIER = "0123456789abcdef01234568";

async function createRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `billing-${Date.now()}-${Math.random()}@restopos.test`,
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
  // Explicit zero-tax fixture: the shared flow below exercises the no-GST
  // path, independent of the onboarding default (5% enabled).
  await RestaurantSettingsModel.updateOne(
    { restaurantId: result.restaurantId },
    {
      $set: {
        taxEnabled: false,
        defaultTaxRate: 0,
        cgstRatePercent: 0,
        sgstRatePercent: 0,
        igstRatePercent: 0,
      },
    }
  );
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
  const t1 = await createTable(restaurantId, table("T1"));
  const t2 = await createTable(restaurantId, table("T2"));
  return { cat, plain, fancy, t1, t2 };
}

async function dineInOrder(menuItemId: string, tableId: string, extra: Record<string, unknown> = {}) {
  return createOrder(restaurantId, OWNER, {
    orderType: "DINE_IN",
    tableId,
    items: [line(menuItemId)],
    ...extra,
  });
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
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
  await TableAuditLogModel.collection.deleteMany({});
  restaurantId = await createRestaurant("Billing Test Kitchen");
});

describe("Billing module E2E against real MongoDB", () => {
  it(
    "onboards new restaurants with 5% GST (CGST 2.5 + SGST 2.5) enabled by default",
    async () => {
      if (!available) return;
      const passwordHash = await hashPassword("Password123!");
      const user = await UserModel.create({
        fullName: "Owner",
        email: `billing-default-tax-${Date.now()}-${Math.random()}@restopos.test`,
        passwordHash,
        isActive: true,
      });
      const result = await createRestaurantForUser(String(user._id), {
        name: "Default Tax Kitchen",
        ownerName: "Owner",
        phone: "9876543210",
        address: "1 Food St",
        city: "Mumbai",
        state: "MA",
        pincode: "400001",
        gstRegistered: true,
        gstin: "29ABCDE1234F1Z5",
        businessType: "Restaurant",
      });
      const rid = result.restaurantId;
      const settings = await RestaurantSettingsModel.findOne({ restaurantId: rid }).lean();
      expect(settings).toMatchObject({
        taxEnabled: true,
        defaultTaxRate: 5,
        cgstRatePercent: 2.5,
        sgstRatePercent: 2.5,
        igstRatePercent: 5,
      });

      const by = String(user._id);
      const cat = await createCategory(rid, {
        name: "Mains",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const plain = await createMenuItem(
        rid,
        item("Plain", { categoryId: cat.id, basePriceRupees: 100 })
      );
      const t1 = await createTable(rid, table("T1"));
      const order = await createOrder(rid, by, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id)],
      });
      const bill = await generateBill(rid, order.id, by);
      expect(bill.taxRatePercent).toBe(5);
      expect(bill.cgstRatePercent).toBe(2.5);
      expect(bill.sgstRatePercent).toBe(2.5);
      expect(bill.igstRatePercent).toBe(5);
      expect(bill.cgstAmountPaise).toBe(250);
      expect(bill.sgstAmountPaise).toBe(250);
      expect(bill.totalTaxPaise).toBe(500);
      expect(bill.grandTotalPaise).toBe(10500);
    },
    30000
  );

  it(
    "generates a snapshotted UNPAID bill with a sequential number and is idempotent on double submit",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);

      const bill = await generateBill(restaurantId, order.id, OWNER);
      expect(bill.billNumber).toBe("BILL-000001");
      expect(bill.status).toBe("UNPAID");
      expect(bill.paymentStatus).toBe("UNPAID");
      expect(bill.orderNumber).toBe(order.orderNumber);
      expect(bill.orderType).toBe("DINE_IN");
      expect(bill.tableNameSnapshot).toBe("T1");
      expect(bill.items).toHaveLength(1);
      expect(bill.items[0].nameSnapshot).toBe("Plain");
      expect(bill.items[0].unitPricePaise).toBe(10000);
      expect(bill.grandTotalPaise).toBe(10000);
      expect(bill.dueAmountPaise).toBe(10000);
      expect(bill.paidAmountPaise).toBe(0);
      expect(bill.gstRegistered).toBe(false);
      expect(bill.totalTaxPaise).toBe(0);

      // Double click creates nothing new.
      const again = await generateBill(restaurantId, order.id, OWNER);
      expect(again.id).toBe(bill.id);
      expect(await BillModel.countDocuments({ restaurantId })).toBe(1);

      // Second order gets the next number in the sequence.
      const order2 = await dineInOrder(plain.id, t2.id);
      const bill2 = await generateBill(restaurantId, order2.id, OWNER);
      expect(bill2.billNumber).toBe("BILL-000002");
    },
    30000
  );

  it(
    "keeps the order status untouched on generate and rejects non-billable orders",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);
      expect(bill.status).toBe("UNPAID");
      expect((await getOrder(restaurantId, order.id))?.status).toBe("OPEN");
      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("OCCUPIED");

      // A held order can still be billed.
      const held = await dineInOrder(plain.id, t2.id);
      await holdOrder(restaurantId, held.id);
      await expect(generateBill(restaurantId, held.id, OWNER)).resolves.toMatchObject({
        status: "UNPAID",
      });

      // Cancelled orders are terminal.
      const cancelled = await dineInOrder(plain.id, t2.id);
      await cancelOrder(restaurantId, cancelled.id, OWNER, "Walkout");
      await expect(generateBill(restaurantId, cancelled.id, OWNER)).rejects.toThrow(
        BillValidationError
      );

      // Unknown order.
      await expect(
        generateBill(restaurantId, "0123456789abcdef01234599", OWNER)
      ).rejects.toThrow(/Order not found/i);
    },
    30000
  );

  it(
    "carries snapshot lines (name/variant/price) into the bill and keeps them after a menu price change",
    async () => {
      if (!available) return;
      const { cat, plain, fancy, t1 } = await seed();
      const full = fancy.variants.find((v) => v.displayName === "Full")!;
      const order = await createOrder(restaurantId, OWNER, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id), line(fancy.id, { variantId: full.id })],
      });
      expect(order.totalPaise).toBe(42000);

      const bill = await generateBill(restaurantId, order.id, OWNER);
      expect(bill.grandTotalPaise).toBe(42000);
      expect(bill.items.map((i) => i.nameSnapshot)).toEqual(["Plain", "Fancy"]);
      expect(bill.items.map((i) => i.variantNameSnapshot)).toEqual([null, "Full"]);
      expect(bill.items.map((i) => i.unitPricePaise)).toEqual([10000, 32000]);

      // Menu prices move after the table was served; the bill must not follow.
      await updateMenuItem(
        restaurantId,
        plain.id,
        item("Plain", { categoryId: cat.id, basePriceRupees: 250 })
      );

      const reloaded = await getBill(restaurantId, bill.id);
      expect(reloaded?.grandTotalPaise).toBe(42000);
      expect(reloaded?.items[0].unitPricePaise).toBe(10000);
    },
    30000
  );

  it(
    "applies a bill-time discount exactly once, splitting it across lines",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await createOrder(restaurantId, OWNER, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 3 })],
      });
      expect(order.totalPaise).toBe(30000);
      expect(order.discountPaise).toBe(0);

      const bill = await generateBill(restaurantId, order.id, OWNER, {
        discountType: "FIXED",
        discountValue: 15,
        discountReason: "Round off",
      });
      expect(bill.subtotalPaise).toBe(30000);
      expect(bill.discountPaise).toBe(1500);
      expect(bill.grandTotalPaise).toBe(28500);
      expect(bill.items.reduce((sum, i) => sum + i.discountAmountPaise, 0)).toBe(1500);

      // The discount lives on the bill snapshot only; the order stays untouched.
      const reloadedOrder = await getOrder(restaurantId, order.id);
      expect(reloadedOrder?.discountPaise).toBe(0);
      expect(bill.dueAmountPaise).toBe(28500);
    },
    30000
  );

  it(
    "applies a bill-time structured discount and taxes the discounted value",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();

      // GST-registered, intra-state, 5% tax-exclusive.
      await RestaurantModel.updateOne({ _id: restaurantId }, { $set: { gstRegistered: true } });
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

      const order = await createOrder(restaurantId, OWNER, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });
      expect(order.totalPaise).toBe(20000);
      expect(order.discountPaise).toBe(0);

      const bill = await generateBill(restaurantId, order.id, OWNER, {
        discountType: "PERCENTAGE",
        discountValue: 10,
        discountReason: "Festival offer",
      });
      expect(bill.subtotalPaise).toBe(20000);
      expect(bill.discountPaise).toBe(2000);
      expect(bill.discountType).toBe("PERCENTAGE");
      expect(bill.discountValue).toBe(10);
      expect(bill.discountReason).toBe("Festival offer");
      // Tax is computed on the discounted, taxable base.
      expect(bill.taxableAmountPaise).toBe(18000);
      expect(bill.totalTaxPaise).toBe(900);
      expect(bill.grandTotalPaise).toBe(18900);

      // Tax-inclusive: the discount still lands before GST is back-computed.
      await RestaurantSettingsModel.updateOne(
        { restaurantId },
        { $set: { gstScheme: "INTER_STATE", taxInclusive: true } }
      );
      const order2 = await createOrder(restaurantId, OWNER, {
        orderType: "DINE_IN",
        tableId: t2.id,
        items: [line(plain.id, { quantity: 2 })],
      });
      expect(order2.discountPaise).toBe(0);
      const bill2 = await generateBill(restaurantId, order2.id, OWNER, {
        discountType: "FIXED",
        discountValue: 50,
        discountReason: "Freebie",
      });
      expect(bill2.discountPaise).toBe(5000);
      expect(bill2.discountType).toBe("FIXED");
      expect(bill2.discountValue).toBe(50);
      // gross after discount = 20000 - 5000 = 15000; 5% inclusive -> taxable 14286, tax 714, grand 15000.
      expect(bill2.taxableAmountPaise).toBe(14286);
      expect(bill2.totalTaxPaise).toBe(714);
      expect(bill2.grandTotalPaise).toBe(15000);
    },
    30000
  );

  it(
    "falls back to a legacy order discount snapshot when no bill discount is given",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();
      const order = await createOrder(restaurantId, OWNER, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [line(plain.id, { quantity: 2 })],
      });

      // Simulate a pre-refactor order carrying an absolute-paise discount.
      await OrderModel.updateOne(
        { _id: order.id },
        { $set: { discountPaise: 1500, discountType: null, discountValue: null } }
      );

      const bill = await generateBill(restaurantId, order.id, OWNER);
      expect(bill.subtotalPaise).toBe(20000);
      expect(bill.discountPaise).toBe(1500);
      expect(bill.discountType).toBeNull();
      expect(bill.grandTotalPaise).toBe(18500);

      // An explicit "no discount" overrides the legacy fallback.
      const order2 = await createOrder(restaurantId, OWNER, {
        orderType: "DINE_IN",
        tableId: t2.id,
        items: [line(plain.id, { quantity: 2 })],
      });
      await OrderModel.updateOne(
        { _id: order2.id },
        { $set: { discountPaise: 1500, discountType: null, discountValue: null } }
      );
      const bill2 = await generateBill(restaurantId, order2.id, OWNER, {
        discountType: null,
        discountValue: null,
        discountReason: null,
      });
      expect(bill2.discountPaise).toBe(0);
      expect(bill2.grandTotalPaise).toBe(20000);
    },
    30000
  );

  it(
    "records a full payment: bill PAID, order PAID and the table released",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);

      const paid = await recordPayment(restaurantId, bill.id, CASHIER, {
        method: "CASH",
        amountPaise: bill.grandTotalPaise,
      });
      expect(paid.status).toBe("PAID");
      expect(paid.paidAmountPaise).toBe(10000);
      expect(paid.dueAmountPaise).toBe(0);
      expect(paid.paidAt).not.toBeNull();
      expect(paid.payments).toHaveLength(1);
      expect(paid.payments[0].method).toBe("CASH");
      expect(paid.payments[0].receivedBy).toBe(CASHIER);

      // Order settled and table back on the floor.
      const reloaded = await getOrder(restaurantId, order.id);
      expect(reloaded?.status).toBe("PAID");
      expect(reloaded?.paidAt).not.toBeNull();
      const tables = await getTables(restaurantId);
      expect(tables.find((t) => t.id === t1.id)?.status).toBe("AVAILABLE");

      // A second payment is rejected outright.
      await expect(
        recordPayment(restaurantId, bill.id, CASHIER, { method: "UPI", amountPaise: 1 })
      ).rejects.toThrow(BillAlreadyPaidError);
    },
    30000
  );

  it(
    "splits one bill across two methods (CASH + UPI) with exact balance intact",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      await generateBill(restaurantId, order.id, OWNER);
      const bill = await getBillForOrder(restaurantId, order.id);
      expect(bill?.grandTotalPaise).toBe(10000);

      const first = await recordPayment(restaurantId, bill!.id, CASHIER, {
        method: "CASH",
        amountPaise: 4000,
      });
      expect(first.status).toBe("PARTIAL");
      expect(first.dueAmountPaise).toBe(6000);
      // A partial payment leaves the order in its current state.
      expect((await getOrder(restaurantId, order.id))?.status).toBe("OPEN");

      const second = await recordPayment(restaurantId, bill!.id, CASHIER, {
        method: "UPI",
        amountPaise: 6000,
      });
      expect(second.status).toBe("PAID");
      expect(second.dueAmountPaise).toBe(0);
      expect(second.payments).toHaveLength(2);
      expect(second.payments.map((p) => p.method)).toEqual(["CASH", "UPI"]);
      expect(second.payments.reduce((sum, p) => sum + p.amountPaise, 0)).toBe(10000);

      const reloaded = await getOrder(restaurantId, order.id);
      expect(reloaded?.status).toBe("PAID");
    },
    30000
  );

  it(
    "completes a partial bill idempotently and never records a duplicate",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);

      await recordPayment(restaurantId, bill.id, CASHIER, {
        method: "CASH",
        amountPaise: 5000,
      });
      const completed = await completePayment(restaurantId, bill.id, CASHIER, {
        method: "UPI",
      });
      expect(completed.status).toBe("PAID");
      expect(completed.payments.reduce((sum, p) => sum + p.amountPaise, 0)).toBe(10000);
      expect(completed.payments.map((p) => p.method)).toEqual(["CASH", "UPI"]);

      // Settling an already-paid bill is a no-op, not an error or a duplicate.
      const paymentsBefore = await PaymentModel.countDocuments({ restaurantId });
      const again = await completePayment(restaurantId, bill.id, CASHIER, {
        method: "CARD",
      });
      expect(again.status).toBe("PAID");
      expect(again.payments).toHaveLength(2);
      expect(await PaymentModel.countDocuments({ restaurantId })).toBe(paymentsBefore);
    },
    30000
  );

  it(
    "rejects overpayment atomically and leaves the bill payable with no stray payments",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);

      await expect(
        recordPayment(restaurantId, bill.id, CASHIER, {
          method: "CASH",
          amountPaise: bill.grandTotalPaise + 1,
        })
      ).rejects.toThrow(OverpaymentError);

      const reloaded = await getBill(restaurantId, bill.id);
      expect(reloaded?.status).toBe("UNPAID");
      expect(reloaded?.paidAmountPaise).toBe(0);
      expect(reloaded?.dueAmountPaise).toBe(10000);
      expect(await PaymentModel.countDocuments({ restaurantId })).toBe(0);
      expect((await getOrder(restaurantId, order.id))?.status).toBe("OPEN");
    },
    30000
  );

  it(
    "deduplicates a double-clicked payment sharing one idempotency key",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);

      const results = await Promise.allSettled([
        recordPayment(restaurantId, bill.id, CASHIER, {
          method: "CASH",
          amountPaise: 10000,
          idempotencyKey: "pay-dup-001",
        }),
        recordPayment(restaurantId, bill.id, CASHIER, {
          method: "CASH",
          amountPaise: 10000,
          idempotencyKey: "pay-dup-001",
        }),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof recordPayment>>> =>
          r.status === "fulfilled"
      );
      expect(fulfilled.length).toBe(2);
      expect(fulfilled.every((r) => r.value.status === "PAID")).toBe(true);

      expect(await PaymentModel.countDocuments({ restaurantId })).toBe(1);
      const billReloaded = await getBill(restaurantId, bill.id);
      expect(billReloaded?.paidAmountPaise).toBe(10000);
    },
    30000
  );

  it(
    "two un-keyed rapid full-payment attempts still charge exactly once",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);

      const results = await Promise.allSettled([
        recordPayment(restaurantId, bill.id, CASHIER, { method: "CASH", amountPaise: 10000 }),
        recordPayment(restaurantId, bill.id, CASHIER, { method: "CASH", amountPaise: 10000 }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      // The atomic $expr guard lets exactly one land; the other is an overpay.
      expect(fulfilled.length + rejected.length).toBe(2);
      expect(rejected.some((r) => (r as PromiseRejectedResult).reason instanceof OverpaymentError)).toBe(
        true
      );

      expect(await PaymentModel.countDocuments({ restaurantId })).toBe(1);
      const reloaded = await getBill(restaurantId, bill.id);
      expect(reloaded?.status).toBe("PAID");
      expect(reloaded?.paidAmountPaise).toBe(10000);
    },
    30000
  );

  it(
    "bills and settles takeaway orders without any table involved",
    async () => {
      if (!available) return;
      const { plain } = await seed();
      const order = await createOrder(restaurantId, OWNER, {
        orderType: "TAKEAWAY",
        customerName: "Ravi",
        items: [line(plain.id)],
      });
      const bill = await generateBill(restaurantId, order.id, OWNER);
      expect(bill.tableId).toBeNull();
      expect(bill.customerName).toBe("Ravi");

      const paid = await completePayment(restaurantId, bill.id, CASHIER, { method: "UPI" });
      expect(paid.status).toBe("PAID");
      expect((await getOrder(restaurantId, order.id))?.status).toBe("PAID");
      // Both seeded tables remain free — no order claimed one.
      const tables = await getTables(restaurantId);
      expect(tables).toHaveLength(2);
      expect(tables.every((t) => t.status === "AVAILABLE")).toBe(true);
    },
    30000
  );

  it(
    "applies taxes per the restaurant settings and routes GST by scheme",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();

      // Restaurant registered for GST, intra-state, 5% tax-exclusive.
      await RestaurantModel.updateOne({ _id: restaurantId }, { $set: { gstRegistered: true } });
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
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);
      expect(bill.gstRegistered).toBe(true);
      expect(bill.taxRatePercent).toBe(5);
      expect(bill.cgstRatePercent).toBe(2.5);
      expect(bill.sgstRatePercent).toBe(2.5);
      expect(bill.igstRatePercent).toBe(5);
      expect(bill.taxInclusive).toBe(false);
      expect(bill.gstScheme).toBe("INTRA_STATE");
      expect(bill.subtotalPaise).toBe(10000);
      expect(bill.taxableAmountPaise).toBe(10000);
      expect(bill.cgstAmountPaise).toBe(250);
      expect(bill.sgstAmountPaise).toBe(250);
      expect(bill.igstAmountPaise).toBe(0);
      expect(bill.totalTaxPaise).toBe(500);
      expect(bill.grandTotalPaise).toBe(10500);

      // Inter-state, tax-inclusive, 5%: the item price already carries the GST.
      await RestaurantSettingsModel.updateOne(
        { restaurantId },
        { $set: { gstScheme: "INTER_STATE", taxInclusive: true } }
      );
      const order2 = await dineInOrder(plain.id, t2.id);
      const bill2 = await generateBill(restaurantId, order2.id, OWNER);
      expect(bill2.gstScheme).toBe("INTER_STATE");
      expect(bill2.grandTotalPaise).toBe(10000); // inclusive: item price already carries GST
      expect(bill2.taxableAmountPaise).toBe(9524);
      expect(bill2.totalTaxPaise).toBe(476);
      expect(bill2.cgstAmountPaise).toBe(0);
      expect(bill2.sgstAmountPaise).toBe(0);
      expect(bill2.igstAmountPaise).toBe(476);

      const paid = await completePayment(restaurantId, bill2.id, CASHIER, { method: "CARD" });
      expect(paid.status).toBe("PAID");
      expect(paid.paidAmountPaise).toBe(10000);
    },
    30000
  );

  it(
    "resolves per-line GST overrides (variant > item > restaurant) when generating a bill",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();

      // GST-registered restaurant, intra-state, 5% tax-exclusive default.
      await RestaurantModel.updateOne({ _id: restaurantId }, { $set: { gstRegistered: true } });
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

      const cat = await createCategory(restaurantId, {
        name: "Overrides",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });

      // 1. Legacy line: no override -> restaurant default 5%.
      const legacy = await createMenuItem(
        restaurantId,
        item("Legacy", { categoryId: cat.id, basePriceRupees: 100 })
      );
      // 2. Item override: 18% CGST+SGST, exclusive.
      const fancy = await createMenuItem(
        restaurantId,
        item("Premium", {
          categoryId: cat.id,
          basePriceRupees: 100,
          taxOverride: {
            enabled: true,
            taxRatePercent: 18,
            taxMode: "EXCLUSIVE",
            taxType: "CGST_SGST",
          },
        })
      );
      // 3. Variant override: 12% inclusive; the item itself has no override.
      const sized = await createMenuItem(
        restaurantId,
        item("Sized", {
          categoryId: cat.id,
          basePriceRupees: 100,
          hasVariants: true,
          variants: [
            variant("Large", 100, {
              taxOverride: {
                enabled: true,
                taxRatePercent: 12,
                taxMode: "INCLUSIVE",
                taxType: "CGST_SGST",
              },
            }),
          ],
        })
      );
      const largeVariantId = sized.variants[0].id;

      const order = await createOrder(restaurantId, OWNER, {
        orderType: "DINE_IN",
        tableId: t1.id,
        items: [
          line(legacy.id),
          line(fancy.id),
          { menuItemId: sized.id, variantId: largeVariantId, quantity: 1 },
        ],
      });
      const bill = await generateBill(restaurantId, order.id, OWNER);

      // Per-line snapshot carries the resolved rate.
      expect(bill.items[0].taxRatePercent).toBe(5);
      expect(bill.items[1].taxRatePercent).toBe(18);
      expect(bill.items[2].taxRatePercent).toBe(12);

      // 500 (default) + 1800 (18% override) + 1071 (12% inclusive, embedded).
      expect(bill.totalTaxPaise).toBe(3371);
      expect(bill.cgstAmountPaise + bill.sgstAmountPaise).toBe(3371);
      expect(bill.taxableAmountPaise).toBe(28929);
      // 10500 + 11800 + 10000 (inclusive line keeps its price).
      expect(bill.grandTotalPaise).toBe(32300);

      // The bill-level summary snapshot still reports the restaurant defaults.
      expect(bill.taxRatePercent).toBe(5);
      expect(bill.cgstRatePercent).toBe(2.5);
      expect(bill.sgstRatePercent).toBe(2.5);

      // Legacy items keep the exact historical result when nothing overrides.
      const legacyOrder = await dineInOrder(plain.id, t2.id);
      const legacyBill = await generateBill(restaurantId, legacyOrder.id, OWNER);
      expect(legacyBill.totalTaxPaise).toBe(500);
      expect(legacyBill.grandTotalPaise).toBe(10500);
      expect(legacyBill.items[0].taxRatePercent).toBe(5);
    },
    30000
  );

  it(
    "keeps the restaurant master tax switch authoritative over item overrides",
    async () => {
      if (!available) return;
      const { t1 } = await seed();

      const cat = await createCategory(restaurantId, {
        name: "Disabled",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const overridden = await createMenuItem(
        restaurantId,
        item("Overridden", {
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

      // taxEnabled is false (the seeded restaurant): an override must not tax.
      const order = await dineInOrder(overridden.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);
      expect(bill.totalTaxPaise).toBe(0);
      expect(bill.grandTotalPaise).toBe(10000);
    },
    30000
  );

  it(
    "never charges GST for an unregistered restaurant even when tax is enabled or overrides say otherwise",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();

      // Simulate a legacy/rogue state: settings claim tax is enabled at 18%,
      // but the restaurant is NOT GST-registered. GST registration is the
      // master control and must win at billing time.
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

      const cat = await createCategory(restaurantId, {
        name: "MasterControl",
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

      const noOverride = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, noOverride.id, OWNER);
      expect(bill.gstRegistered).toBe(false);
      expect(bill.taxRatePercent).toBe(0);
      expect(bill.totalTaxPaise).toBe(0);
      expect(bill.cgstAmountPaise).toBe(0);
      expect(bill.sgstAmountPaise).toBe(0);
      expect(bill.igstAmountPaise).toBe(0);
      expect(bill.grandTotalPaise).toBe(10000);

      const withOverride = await dineInOrder(overridden.id, t2.id);
      const bill2 = await generateBill(restaurantId, withOverride.id, OWNER);
      expect(bill2.totalTaxPaise).toBe(0);
      expect(bill2.grandTotalPaise).toBe(10000);
      expect(bill2.items[0].taxRatePercent).toBe(0);
    },
    30000
  );

  it(
    "marks a bill printed without mutating its financial snapshot",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);

      const printed = await markBillPrinted(restaurantId, bill.id);
      expect(printed.printedCount).toBe(1);
      expect(printed.grandTotalPaise).toBe(10000);

      await markBillPrinted(restaurantId, bill.id);
      const reloaded = await getBill(restaurantId, bill.id);
      expect(reloaded?.printedCount).toBe(2);
    },
    30000
  );

  it(
    "cancels an unpaid bill and freezes payments once cancelled",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);

      const cancelled = await cancelBill(restaurantId, bill.id, OWNER, "Wrong items");
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancellationReason).toBe("Wrong items");
      expect(cancelled.cancelledAt).not.toBeNull();

      // Cancelling again is idempotent.
      const again = await cancelBill(restaurantId, bill.id, OWNER);
      expect(again.status).toBe("CANCELLED");

      // No payments can land on a cancelled bill.
      await expect(
        recordPayment(restaurantId, bill.id, CASHIER, { method: "CASH", amountPaise: 100 })
      ).rejects.toThrow(BillNotPayableError);

      // The order is untouched by cancellation.
      expect((await getOrder(restaurantId, order.id))?.status).toBe("OPEN");
    },
    30000
  );

  it(
    "refuses to cancel a paid bill",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);
      await completePayment(restaurantId, bill.id, CASHIER, { method: "CASH" });

      await expect(cancelBill(restaurantId, bill.id, OWNER, "Oops")).rejects.toThrow(
        BillValidationError
      );
      const reloaded = await getBill(restaurantId, bill.id);
      expect(reloaded?.status).toBe("PAID");
    },
    30000
  );

  it(
    "lists bills with filters and enforces tenant isolation",
    async () => {
      if (!available) return;
      const { plain, t1, t2 } = await seed();
      const order1 = await dineInOrder(plain.id, t1.id);
      const order2 = await dineInOrder(plain.id, t2.id);
      const bill1 = await generateBill(restaurantId, order1.id, OWNER);
      await generateBill(restaurantId, order2.id, OWNER);

      const all = await listBills(restaurantId, {});
      expect(all.total).toBe(2);
      expect(all.bills.map((b) => b.billNumber)).toEqual([
        "BILL-000002",
        "BILL-000001",
      ]);

      const paidOnly = await listBills(restaurantId, { status: "PAID" });
      expect(paidOnly.total).toBe(0);

      const search = await listBills(restaurantId, { search: "BILL-000001" });
      expect(search.total).toBe(1);
      expect(search.bills[0].id).toBe(bill1.id);

      // A foreign restaurant can generate and list its own BILL-000001.
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
      const foreignOrder = await createOrder(other, OWNER, {
        orderType: "QUICK_SALE",
        items: [line(otherItem.id)],
      });
      const foreignBill = await generateBill(other, foreignOrder.id, OWNER);
      expect(foreignBill.billNumber).toBe("BILL-000001");

      // Our list never shows theirs; their bill is invisible to us and vice versa.
      const ours = await listBills(restaurantId, {});
      const theirs = await listBills(other, {});
      expect(ours.total).toBe(2);
      expect(theirs.total).toBe(1);
      expect(theirs.bills.map((b) => b.id)).not.toContain(bill1.id);
      expect(ours.bills.map((b) => b.id)).not.toContain(foreignBill.id);

      // We cannot read or pay their bill.
      expect(await getBill(restaurantId, foreignBill.id)).toBeNull();
      await expect(
        recordPayment(restaurantId, foreignBill.id, CASHIER, { method: "CASH", amountPaise: 1 })
      ).rejects.toThrow(BillNotFoundError);
    },
    30000
  );

  it(
    "unknown or foreign bills throw BillNotFoundError",
    async () => {
      if (!available) return;
      await expect(
        recordPayment(restaurantId, "0123456789abcdef01234599", CASHIER, {
          method: "CASH",
          amountPaise: 100,
        })
      ).rejects.toThrow(BillNotFoundError);
      await expect(
        completePayment(restaurantId, "0123456789abcdef01234599", CASHIER, {
          method: "CASH",
        })
      ).rejects.toThrow(BillNotFoundError);
      await expect(getBill(restaurantId, "0123456789abcdef01234599")).resolves.toBeNull();
    },
    30000
  );
});

describe("Billing audit trail E2E", () => {
  it(
    "writes BILL_GENERATED and BILL_PAID entries with tenant scoping",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seed();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, OWNER);
      await completePayment(restaurantId, bill.id, CASHIER, { method: "CASH" });

      const logs = await TableAuditLogModel.find({ restaurantId }).sort({
        createdAt: 1,
        _id: 1,
      });
      const actions = logs.map((l) => l.action);
      expect(actions).toEqual(expect.arrayContaining(["BILL_GENERATED", "BILL_PAID"]));
      const paidLog = logs.find((l) => l.action === "BILL_PAID");
      expect(paidLog?.entityType).toBe("BILL");
      expect(String(paidLog?.entityId)).toBe(bill.id);
      expect(String(paidLog?.userId)).toBe(CASHIER);
    },
    30000
  );
});