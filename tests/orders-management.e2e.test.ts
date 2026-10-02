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
import { createTable } from "@/lib/tables/table-service";
import {
  createOrder,
  cancelOrder,
  sendOrderToKitchen,
} from "@/lib/orders/order-service";
import { generateBill, recordPayment, cancelBill } from "@/lib/billing/bill-service";
import { printPendingKot } from "@/lib/orders/kot-service";
import {
  listOrders,
  getOrdersSummary,
  getOrderById,
  getOrderKots,
  getOrderBill,
  getOrderDetails,
  listOrderTables,
  listOrderStaff,
} from "@/lib/orders/orders-management";
import { ORDERS_PAGE_SIZE } from "@/lib/orders/constants";
import type { MenuItemInput } from "@/lib/menu/validation";
import type { TableInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ??
  "mongodb://127.0.0.1:27018/restopos_ordersmgr_e2e";

let available = false;
let restaurantId = "";
let ownerId = "";

let OWNER = "";

/** The Orders module's own view of a day boundary in Asia/Kolkata. */
const IST = 5.5 * 60 * 60 * 1000;

function istMidnightUtc(daysAgo: number, from: Date = new Date()): Date {
  const istNow = new Date(from.getTime() + IST);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const day = istNow.getUTCDate() - daysAgo;
  const localMidnightAsUtc = Date.UTC(y, m, day, 0, 0, 0, 0);
  return new Date(localMidnightAsUtc - IST);
}

async function createRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `ordersmgr-${Date.now()}-${Math.random()}@restopos.test`,
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

async function addStaff(
  rid: string,
  fullName: string,
  role: "MANAGER" | "CASHIER" | "WAITER",
  isActive = true
): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName,
    email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash,
    role,
    restaurantId: rid,
    isActive,
  });
  return String(user._id);
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
  const t1 = await createTable(restaurantId, table("T1"));
  const t2 = await createTable(restaurantId, table("T2"));
  return { cat, plain, t1, t2 };
}

interface PlaceOrderInput {
  orderType?: "DINE_IN" | "TAKEAWAY" | "QUICK_SALE";
  tableId?: string;
  customerName?: string;
  customerPhone?: string;
  items?: Array<{ menuItemId: string; quantity: number }>;
  byUser?: string;
}

async function placeOrder(input: PlaceOrderInput = {}) {
  const deps = await orderDeps();
  const orderType = input.orderType ?? "QUICK_SALE";
  return createOrder(restaurantId, input.byUser ?? OWNER, {
    orderType,
    tableId: orderType === "DINE_IN" ? input.tableId ?? deps.t1.id : undefined,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    items: input.items ?? [{ menuItemId: deps.plain.id, quantity: 1 }],
  });
}

// A per-suite seed is created in beforeEach; these let tests reach it without
// threading it through every helper.
let depsState: Awaited<ReturnType<typeof seed>> | null = null;

async function orderDeps() {
  if (!depsState) depsState = await seed();
  return depsState;
}

async function setCreatedAt(orderId: string, date: Date) {
  await OrderModel.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(orderId) },
    { $set: { createdAt: date, updatedAt: date } }
  );
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    await OrderModel.syncIndexes();
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
  await Promise.all([
    UserModel.deleteMany({}),
    RestaurantModel.deleteMany({}),
    RestaurantSettingsModel.deleteMany({}),
    MenuCategoryModel.deleteMany({}),
    MenuItemModel.deleteMany({}),
    MenuVariantModel.deleteMany({}),
    RestaurantTableModel.deleteMany({}),
    TableSectionModel.deleteMany({}),
    OrderModel.deleteMany({}),
    KotModel.deleteMany({}),
    BillModel.deleteMany({}),
    PaymentModel.deleteMany({}),
    TableAuditLogModel.collection.deleteMany({}),
  ]);
  depsState = null;
  restaurantId = await createRestaurant("Orders Management Test");
  const owner = await UserModel.findOne({ restaurantId, role: "OWNER" });
  ownerId = String(owner?._id ?? "");
  OWNER = ownerId;
  depsState = await seed();
});

describe("Orders management module E2E against real MongoDB", () => {
  it(
    "lists today's orders with joined bill/payment info and staff names",
    async () => {
      if (!available) return;
      const { t1 } = await orderDeps();
      const order = await placeOrder({ orderType: "DINE_IN", tableId: t1.id });
      const list = await listOrders(restaurantId, {});

      expect(list.total).toBe(1);
      expect(list.page).toBe(1);
      expect(list.perPage).toBe(ORDERS_PAGE_SIZE);
      expect(list.pageCount).toBe(1);

      const row = list.rows[0];
      expect(row.id).toBe(order.id);
      expect(row.orderNumber).toBe(order.orderNumber);
      expect(row.orderType).toBe("DINE_IN");
      expect(row.status).toBe("OPEN");
      expect(row.tableNameSnapshot).toBe("T1");
      expect(row.itemsCount).toBe(1);
      expect(row.amountPaise).toBe(10000);
      expect(row.createdByName).toBe("Owner");
      expect(row.paymentStatus).toBeNull();
      expect(row.billId).toBeNull();
    },
    30000
  );

  it(
    "returns an empty, well-formed page when the restaurant has no orders",
    async () => {
      if (!available) return;
      const list = await listOrders(restaurantId, {});
      expect(list).toEqual({
        rows: [],
        total: 0,
        page: 1,
        perPage: ORDERS_PAGE_SIZE,
        pageCount: 1,
      });
    },
    30000
  );

  it(
    "never leaks another tenant's orders",
    async () => {
      if (!available) return;
      const otherRid = await createRestaurant("Other Kitchen");
      const otherOwner = await UserModel.findOne({
        restaurantId: otherRid,
        role: "OWNER",
      });
      const otherCat = await createCategory(otherRid, {
        name: "Other",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const otherItem = await createMenuItem(
        otherRid,
        item("Other Plain", { categoryId: otherCat.id, basePriceRupees: 100 })
      );
      const otherOrder = await createOrder(otherRid, String(otherOwner?._id), {
        orderType: "QUICK_SALE",
        items: [{ menuItemId: otherItem.id, quantity: 1 }],
      });

      const mine = await placeOrder();

      const list = await listOrders(restaurantId, {});
      expect(list.total).toBe(1);
      expect(list.rows.map((r) => r.id)).toEqual([mine.id]);
      expect(list.rows.some((r) => r.id === otherOrder.id)).toBe(false);

      // The other tenant sees only its own order.
      const otherList = await listOrders(otherRid, {});
      expect(otherList.rows.map((r) => r.id)).toEqual([otherOrder.id]);
    },
    30000
  );

  it(
    "filters by order type and status",
    async () => {
      if (!available) return;
      const { plain } = await orderDeps();
      const dine = await placeOrder({ orderType: "DINE_IN" });
      await placeOrder({
        orderType: "TAKEAWAY",
        items: [{ menuItemId: plain.id, quantity: 2 }],
      });
      await sendOrderToKitchen(restaurantId, dine.id);

      const takeaway = await listOrders(restaurantId, { type: "TAKEAWAY" });
      expect(takeaway.total).toBe(1);
      expect(takeaway.rows[0].orderType).toBe("TAKEAWAY");

      const kotSent = await listOrders(restaurantId, { status: "KOT_SENT" });
      expect(kotSent.total).toBe(1);
      expect(kotSent.rows[0].id).toBe(dine.id);
    },
    30000
  );

  it(
    "filters by the joined bill payment status and hides cancelled bills",
    async () => {
      if (!available) return;

      const paidOrder = await placeOrder();
      const paidBill = await generateBill(restaurantId, paidOrder.id, ownerId);
      await recordPayment(restaurantId, paidBill.id, ownerId, {
        method: "CASH",
        amountPaise: paidBill.grandTotalPaise,
      });

      const partialOrder = await placeOrder();
      const partialBill = await generateBill(restaurantId, partialOrder.id, ownerId);
      await recordPayment(restaurantId, partialBill.id, ownerId, {
        method: "CASH",
        amountPaise: Math.floor(partialBill.grandTotalPaise / 2),
      });

      const cancelledBillOrder = await placeOrder();
      const toCancel = await generateBill(
        restaurantId,
        cancelledBillOrder.id,
        ownerId
      );
      await cancelBill(restaurantId, toCancel.id, ownerId, "mistake");

      const paid = await listOrders(restaurantId, { payment: "PAID" });
      expect(paid.total).toBe(1);
      expect(paid.rows[0].id).toBe(paidOrder.id);
      expect(paid.rows[0].paymentStatus).toBe("PAID");
      expect(paid.rows[0].billId).toBe(paidBill.id);
      expect(paid.rows[0].billNumber).toBe(paidBill.billNumber);

      const partial = await listOrders(restaurantId, { payment: "PARTIAL" });
      expect(partial.total).toBe(1);
      expect(partial.rows[0].id).toBe(partialOrder.id);

      const unpaid = await listOrders(restaurantId, { payment: "UNPAID" });
      expect(unpaid.total).toBe(0);

      // The cancelled bill is a terminal snapshot: the order still lists, but
      // without bill join data, and it is excluded from the payment filter.
      const all = await listOrders(restaurantId, {});
      expect(all.total).toBe(3);
      const cancelledRow = all.rows.find((r) => r.id === cancelledBillOrder.id);
      expect(cancelledRow?.billId).toBeNull();
      expect(cancelledRow?.paymentStatus).toBeNull();
      expect(cancelledRow?.amountPaise).toBe(cancelledBillOrder.totalPaise);
    },
    30000
  );

  it(
    "searches by order number, table name and customer info",
    async () => {
      if (!available) return;
      const first = await placeOrder({
        orderType: "DINE_IN",
        customerName: "Asha Rao",
        customerPhone: "9876500001",
      });
      const second = await placeOrder({
        orderType: "TAKEAWAY",
        customerName: "Vikram",
      });

      const byNumber = await listOrders(restaurantId, {
        q: String(first.orderNumber),
      });
      expect(byNumber.rows.map((r) => r.id)).toEqual([first.id]);

      const byTable = await listOrders(restaurantId, { q: "T1" });
      expect(byTable.rows.map((r) => r.id)).toEqual([first.id]);

      const byName = await listOrders(restaurantId, { q: "vikram" });
      expect(byName.rows.map((r) => r.id)).toEqual([second.id]);

      const byPhone = await listOrders(restaurantId, { q: "9876500001" });
      expect(byPhone.rows.map((r) => r.id)).toEqual([first.id]);
    },
    30000
  );

  it(
    "applies local-day date filters (today / yesterday / custom)",
    async () => {
      if (!available) return;
      const today = await placeOrder();
      const yesterday = await placeOrder();
      await setCreatedAt(
        yesterday.id,
        new Date(istMidnightUtc(1, new Date()).getTime() + 60000)
      );
      const longAgo = await placeOrder();
      await setCreatedAt(
        longAgo.id,
        new Date(istMidnightUtc(20, new Date()).getTime() + 60000)
      );

      const todayList = await listOrders(restaurantId, { date: "today" });
      expect(todayList.rows.map((r) => r.id)).toEqual([today.id]);

      const yesterdayList = await listOrders(restaurantId, { date: "yesterday" });
      expect(yesterdayList.rows.map((r) => r.id)).toEqual([yesterday.id]);

      const ymd = (d: Date) => {
        const ist = new Date(d.getTime() + IST);
        return ist.toISOString().slice(0, 10);
      };
      const custom = await listOrders(restaurantId, {
        date: "custom",
        from: ymd(istMidnightUtc(1, new Date())),
        to: ymd(new Date()),
      });
      expect(new Set(custom.rows.map((r) => r.id))).toEqual(
        new Set([today.id, yesterday.id])
      );
    },
    30000
  );

  it(
    "sorts by newest, oldest, amount and order number",
    async () => {
      if (!available) return;
      const { plain } = await orderDeps();
      const small = await placeOrder({
        items: [{ menuItemId: plain.id, quantity: 1 }],
      });
      const big = await placeOrder({
        items: [{ menuItemId: plain.id, quantity: 5 }],
      });
      const middle = await placeOrder({
        items: [{ menuItemId: plain.id, quantity: 2 }],
      });

      const newest = await listOrders(restaurantId, { sort: "newest" });
      expect(newest.rows[0].id).toBe(middle.id);

      const oldest = await listOrders(restaurantId, { sort: "oldest" });
      expect(oldest.rows[0].id).toBe(small.id);

      const mostExpensive = await listOrders(restaurantId, { sort: "amount_desc" });
      expect(mostExpensive.rows.map((r) => r.id)).toEqual([
        big.id,
        middle.id,
        small.id,
      ]);

      const cheapest = await listOrders(restaurantId, { sort: "amount_asc" });
      expect(cheapest.rows.map((r) => r.id)).toEqual([
        small.id,
        middle.id,
        big.id,
      ]);

      const byNumber = await listOrders(restaurantId, { sort: "number" });
      expect(byNumber.rows[0].orderNumber).toBe(
        Math.max(small.orderNumber, big.orderNumber, middle.orderNumber)
      );
    },
    30000
  );

  it(
    "paginates and clamps out-of-range pages",
    async () => {
      if (!available) return;
      const { plain } = await orderDeps();
      const total = ORDERS_PAGE_SIZE + 2;
      for (let i = 0; i < total; i++) {
        await placeOrder({ items: [{ menuItemId: plain.id, quantity: 1 }] });
      }

      const first = await listOrders(restaurantId, { page: "1" });
      expect(first.total).toBe(total);
      expect(first.pageCount).toBe(2);
      expect(first.rows.length).toBe(ORDERS_PAGE_SIZE);

      const second = await listOrders(restaurantId, { page: "2" });
      expect(second.page).toBe(2);
      expect(second.rows.length).toBe(2);

      const tooFar = await listOrders(restaurantId, { page: "99" });
      expect(tooFar.page).toBe(2);
      expect(tooFar.rows.length).toBe(2);
    },
    60000
  );

  it(
    "aggregates today's KPI summary for the tenant only",
    async () => {
      if (!available) return;
      const paidOrder = await placeOrder({ orderType: "TAKEAWAY" });
      const bill = await generateBill(restaurantId, paidOrder.id, ownerId);
      await recordPayment(restaurantId, bill.id, ownerId, {
        method: "CASH",
        amountPaise: bill.grandTotalPaise,
      });

      const unpaidOrder = await placeOrder({ orderType: "TAKEAWAY" });
      await generateBill(restaurantId, unpaidOrder.id, ownerId);

      const cancelled = await placeOrder({ orderType: "TAKEAWAY" });
      await cancelOrder(restaurantId, cancelled.id, ownerId, "customer left");

      const old = await placeOrder({ orderType: "TAKEAWAY" });
      await setCreatedAt(old.id, istMidnightUtc(3, new Date()));

      const summary = await getOrdersSummary(restaurantId);
      expect(summary.todayOrders).toBe(3);
      expect(summary.cancelledOrders).toBe(1);
      expect(summary.unpaidBills).toBe(1);
      expect(summary.paidBills).toBe(1);
      expect(summary.todaySalesPaise).toBe(bill.grandTotalPaise);
    },
    30000
  );

  it(
    "fetches a single order, rejecting invalid and foreign ids",
    async () => {
      if (!available) return;
      const order = await placeOrder();

      const found = await getOrderById(restaurantId, order.id);
      expect(found?.id).toBe(order.id);
      expect(found?.createdBy).toBe(OWNER);

      expect(await getOrderById(restaurantId, "not-an-id")).toBeNull();
      expect(
        await getOrderById(restaurantId, "ffffffffffffffffffffffff")
      ).toBeNull();

      const otherRid = await createRestaurant("Hidden Kitchen");
      expect(await getOrderById(otherRid, order.id)).toBeNull();
    },
    30000
  );

  it(
    "returns KOTs oldest-first and tenant-scoped",
    async () => {
      if (!available) return;
      const order = await placeOrder();
      await sendOrderToKitchen(restaurantId, order.id);
      await printPendingKot(restaurantId, order.id, ownerId);

      const kots = await getOrderKots(restaurantId, order.id);
      expect(kots.length).toBeGreaterThanOrEqual(1);
      expect(kots[0].orderNumber).toBe(order.orderNumber);
      expect(kots[0].createdBy).toBe(OWNER);
      expect(typeof kots[0].createdAt).toBe("string");

      expect(await getOrderKots(restaurantId, "nope")).toEqual([]);
      const otherRid = await createRestaurant("No KOT Kitchen");
      expect(await getOrderKots(otherRid, order.id)).toEqual([]);
    },
    30000
  );

  it(
    "resolves the bill for an order, or null when unbilled or foreign",
    async () => {
      if (!available) return;
      const order = await placeOrder();
      expect(await getOrderBill(restaurantId, order.id)).toBeNull();

      const bill = await generateBill(restaurantId, order.id, ownerId);
      const found = await getOrderBill(restaurantId, order.id);
      expect(found?.id).toBe(bill.id);
      expect(found?.orderId).toBe(order.id);

      expect(await getOrderBill(restaurantId, "nope")).toBeNull();
      const otherRid = await createRestaurant("No Bill Kitchen");
      expect(await getOrderBill(otherRid, order.id)).toBeNull();
    },
    30000
  );

  it(
    "assembles full order details with KOTs, bill and staff names",
    async () => {
      if (!available) return;
      const cashier = await addStaff(restaurantId, "Casey Cashier", "CASHIER");
      const order = await placeOrder({ byUser: cashier });
      await sendOrderToKitchen(restaurantId, order.id);
      await printPendingKot(restaurantId, order.id, ownerId);
      const bill = await generateBill(restaurantId, order.id, ownerId);
      await recordPayment(restaurantId, bill.id, ownerId, {
        method: "UPI",
        amountPaise: bill.grandTotalPaise,
      });

      const details = await getOrderDetails(restaurantId, order.id);
      expect(details?.order.id).toBe(order.id);
      expect(details?.order.createdBy).toBe(cashier);
      expect(details?.kots.length).toBeGreaterThanOrEqual(1);
      expect(details?.bill?.id).toBe(bill.id);
      expect(details?.staff[cashier]?.fullName).toBe("Casey Cashier");
      expect(details?.staff[ownerId]?.fullName).toBe("Owner");
      expect(details?.staff[cashier]?.role).toBe("CASHIER");

      expect(await getOrderDetails(restaurantId, "bad-id")).toBeNull();
      const otherRid = await createRestaurant("No Details Kitchen");
      expect(await getOrderDetails(otherRid, order.id)).toBeNull();
    },
    30000
  );

  it(
    "keeps historical item snapshots after the menu changes",
    async () => {
      if (!available) return;
      const { cat, plain } = await orderDeps();
      const order = await placeOrder();

      await updateMenuItem(
        restaurantId,
        plain.id,
        item("Plain Renamed", { categoryId: cat.id, basePriceRupees: 250 })
      );

      const details = await getOrderDetails(restaurantId, order.id);
      expect(details?.order.items[0].nameSnapshot).toBe("Plain");
      expect(details?.order.items[0].unitPricePaise).toBe(10000);
      expect(details?.order.totalPaise).toBe(10000);
    },
    30000
  );

  it(
    "exposes the order's cancellation audit on the detail view",
    async () => {
      if (!available) return;
      const order = await placeOrder();
      await cancelOrder(restaurantId, order.id, ownerId, "wrong table");

      const details = await getOrderDetails(restaurantId, order.id);
      expect(details?.order.status).toBe("CANCELLED");
      expect(details?.order.cancelledBy).toBe(ownerId);
      expect(details?.order.cancellationReason).toBe("wrong table");
    },
    30000
  );

  it(
    "lists only active tables and active staff for filters",
    async () => {
      if (!available) return;
      await addStaff(restaurantId, "Active Waiter", "WAITER", true);
      await addStaff(restaurantId, "Gone Waiter", "WAITER", false);
      await createTable(restaurantId, table("Closed Table", { isActive: false }));

      const tables = await listOrderTables(restaurantId);
      expect(tables.map((t) => t.name)).toEqual(["T1", "T2"]);

      const staff = await listOrderStaff(restaurantId);
      const names = staff.map((s) => s.fullName).sort();
      expect(names).toEqual(["Active Waiter", "Owner"]);
      expect(staff.every((s) => typeof s.role === "string")).toBe(true);
    },
    30000
  );

  it(
    "filters by table and by creating staff",
    async () => {
      if (!available) return;
      const { t2 } = await orderDeps();
      const cashier = await addStaff(restaurantId, "Filter Cashier", "CASHIER");
      await placeOrder({ byUser: cashier, orderType: "DINE_IN", tableId: t2.id });
      await placeOrder({ byUser: OWNER });

      const byTable = await listOrders(restaurantId, { table: t2.id });
      expect(byTable.total).toBe(1);
      expect(byTable.rows[0].tableId).toBe(t2.id);

      const byStaff = await listOrders(restaurantId, { staff: cashier });
      expect(byStaff.total).toBe(1);
      expect(byStaff.rows[0].createdByName).toBe("Filter Cashier");
    },
    30000
  );

  it(
    "ignores malformed filters instead of throwing",
    async () => {
      if (!available) return;
      await placeOrder();
      const list = await listOrders(restaurantId, {
        date: "whenever",
        type: "SPACE",
        status: "HAZY",
        payment: "MAYBE",
        table: "123",
        staff: "456",
        sort: "random",
        page: "-3",
      });
      expect(list.total).toBe(1);
      expect(list.page).toBe(1);
      expect(list.rows.length).toBe(1);
    },
    30000
  );

  it(
    "keeps one bill per order even after a re-generate attempt",
    async () => {
      if (!available) return;
      const order = await placeOrder();
      const first = await generateBill(restaurantId, order.id, ownerId);
      const second = await generateBill(restaurantId, order.id, ownerId);
      expect(second.id).toBe(first.id);
      expect(await BillModel.countDocuments({ restaurantId, orderId: order.id })).toBe(1);
    },
    30000
  );
});