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
import { createMenuItem } from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import { createOrder, cancelOrder } from "@/lib/orders/order-service";
import {
  generateBill,
  recordPayment,
  cancelBill,
} from "@/lib/billing/bill-service";
import type { BillDiscountInput } from "@/lib/billing/discount";
import { getDashboardSummary } from "@/lib/reports/dashboard-service";
import { getBusinessDateRange } from "@/lib/reports/date-range";
import { parseReportQuery } from "@/lib/reports/query";
import { buildReportExport } from "@/lib/reports/export";
import {
  getCancellationReport,
  getCategorySalesReport,
  getDiscountReport,
  getGSTReport,
  getItemSalesReport,
  getOrderReport,
  getPaymentReport,
  getSalesReport,
} from "@/lib/reports/report-service";
import type { ReportQuery } from "@/lib/reports/types";
import type { MenuItemInput } from "@/lib/menu/validation";
import type { TableInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ??
  "mongodb://127.0.0.1:27018/restopos_reports_e2e";

const IST = 5.5 * 60 * 60 * 1000;

function istMidnightUtc(daysAgo: number, from: Date = new Date()): Date {
  const istNow = new Date(from.getTime() + IST);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const day = istNow.getUTCDate() - daysAgo;
  const localMidnightAsUtc = Date.UTC(y, m, day, 0, 0, 0, 0);
  return new Date(localMidnightAsUtc - IST);
}

let available = false;
let restaurantId = "";
let ownerId = "";

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

async function createRestaurant(
  name: string,
  gstRegistered = false,
  gstin = ""
): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `reports-${Date.now()}-${Math.random()}@restopos.test`,
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
    gstin,
    businessType: "Restaurant",
  });
  // Explicit zero-tax fixture for the shared reports flow, independent of
  // the onboarding default (5% enabled). GST-specific tests opt into tax.
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

async function seedBase() {
  const cat = await createCategory(restaurantId, {
    name: "Mains",
    description: undefined,
    displayOrder: 0,
    isActive: true,
  });
  const paneer = await createMenuItem(
    restaurantId,
    item("Paneer", { categoryId: cat.id, basePriceRupees: 500 })
  );
  const rice = await createMenuItem(
    restaurantId,
    item("Rice", { categoryId: cat.id, basePriceRupees: 250 })
  );
  const t1 = await createTable(restaurantId, table("T1"));
  const t3 = await createTable(restaurantId, table("T3", { status: "OCCUPIED" }));
  return { cat, paneer, rice, t1, t3 };
}

interface PaySplit {
  method: "CASH" | "UPI" | "CARD";
  amountPaise: number;
}

interface PlaceAndPayInput {
  orderType?: "DINE_IN" | "TAKEAWAY" | "QUICK_SALE";
  tableId?: string;
  customerName?: string;
  items?: Array<{ menuItemId: string; quantity: number }>;
  discount?: BillDiscountInput;
  split?: PaySplit[];
}

async function placeOrderOnly(
  input: PlaceAndPayInput,
  deps: Awaited<ReturnType<typeof seedBase>>
) {
  return createOrder(restaurantId, ownerId, {
    orderType: input.orderType ?? "QUICK_SALE",
    tableId:
      input.orderType === "DINE_IN"
        ? input.tableId ?? deps.t1.id
        : undefined,
    customerName: input.customerName,
    items: input.items ?? [{ menuItemId: deps.rice.id, quantity: 1 }],
  });
}

/** Order + bill, no payment recorded (stays UNPAID). */
async function placeBillOnly(
  input: PlaceAndPayInput,
  deps: Awaited<ReturnType<typeof seedBase>>
) {
  const order = await placeOrderOnly(input, deps);
  const bill = await generateBill(restaurantId, order.id, ownerId, input.discount);
  return { order, bill };
}

async function placeAndPay(
  input: PlaceAndPayInput,
  deps: Awaited<ReturnType<typeof seedBase>>
) {
  const order = await placeOrderOnly(input, deps);
  const bill = await generateBill(restaurantId, order.id, ownerId, input.discount);
  const splits = input.split ?? [
    { method: "CASH" as const, amountPaise: bill.grandTotalPaise },
  ];
  for (const p of splits) {
    await recordPayment(restaurantId, bill.id, ownerId, p);
  }
  const docs = await PaymentModel.find({ billId: bill.id })
    .sort({ createdAt: 1 })
    .lean();
  const payments = docs.map((d) => String(d._id));
  return { order, bill, payments };
}

async function backdatePaid(
  payments: string[],
  date: Date,
  billId: string
): Promise<void> {
  await BillModel.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(billId) },
    {
      $set: {
        paidAt: date,
        completedAt: date,
        updatedAt: date,
      },
    }
  );
  await PaymentModel.collection.updateMany(
    { _id: { $in: payments.map((p) => new mongoose.Types.ObjectId(p)) } },
    { $set: { createdAt: date, updatedAt: date } }
  );
}

function q(tab: ReportQuery["tab"], overrides: Record<string, string> = {}) {
  return parseReportQuery({ tab, ...overrides });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    await OrderModel.syncIndexes();
    await BillModel.syncIndexes();
    await mongoose.connection.db?.collection("payments").createIndex({
      restaurantId: 1,
      billId: 1,
    });
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
  restaurantId = await createRestaurant("Reports Test Restaurant");
  const owner = await UserModel.findOne({ restaurantId, role: "OWNER" });
  ownerId = String(owner?._id ?? "");
});

describe("Reports module E2E against real MongoDB", () => {
  it(
    "dashboard aggregates today's business and masks financials for waiters",
    async () => {
      if (!available) return;
      const deps = await seedBase();

      // Dine-in bill paid in two parts: Cash 400 + UPI 600 (split payment).
      await placeAndPay(
        {
          orderType: "DINE_IN",
          items: [
            { menuItemId: deps.paneer.id, quantity: 1 },
            { menuItemId: deps.rice.id, quantity: 2 },
          ],
          split: [
            { method: "CASH", amountPaise: 40000 },
            { method: "UPI", amountPaise: 60000 },
          ],
        },
        deps
      );
      // Takeaway with a ₹50 discount, paid by card: net 45000.
      await placeAndPay(
        {
          orderType: "TAKEAWAY",
          items: [{ menuItemId: deps.paneer.id, quantity: 1 }],
          discount: { discountType: "FIXED", discountValue: 50, discountReason: "Round off" },
          split: [{ method: "CARD", amountPaise: 45000 }],
        },
        deps
      );
      // Unpaid bill -> shows as outstanding.
      await placeBillOnly({ items: [{ menuItemId: deps.rice.id, quantity: 1 }] }, deps);
      // Cancelled order.
      const cancelled = await createOrder(restaurantId, ownerId, {
        orderType: "QUICK_SALE",
        items: [{ menuItemId: deps.paneer.id, quantity: 1 }],
      });
      await cancelOrder(restaurantId, cancelled.id, ownerId, "customer left");
      // Cancelled bill (unpaid at cancel time).
      const cancelledBill = await placeBillOnly(
        { items: [{ menuItemId: deps.rice.id, quantity: 1 }] },
        deps
      );
      await cancelBill(restaurantId, cancelledBill.bill.id, ownerId, "wrong item");

      const summary = await getDashboardSummary(restaurantId, { date: "today" });

      expect(summary.financialsHidden).toBe(false);
      expect(summary.kpis.ordersCount).toBe(5);
      expect(summary.kpis.paidBills).toBe(2);
      expect(summary.kpis.cancelledOrders).toBe(1);
      expect(summary.kpis.totalSalesPaise).toBe(145000);
      expect(summary.kpis.averageOrderValuePaise).toBe(72500);
      expect(summary.kpis.dueAmountPaise).toBe(25000);
      expect(summary.kpis.dueBills).toBe(1);

      expect(summary.sales).toMatchObject({
        billedSalesPaise: 145000,
        discountPaise: 5000,
        taxPaise: 0,
        serviceChargePaise: 0,
        roundOffPaise: 0,
        netSalesPaise: 145000,
        collectedPaise: 145000,
      });

      expect(summary.paymentBreakdown).toEqual([
        { method: "UPI", amountPaise: 60000, count: 1 },
        { method: "CARD", amountPaise: 45000, count: 1 },
        { method: "CASH", amountPaise: 40000, count: 1 },
      ]);

      expect(summary.orderTypeBreakdown).toEqual([
        { orderType: "DINE_IN", orders: 1, salesPaise: 100000 },
        { orderType: "TAKEAWAY", orders: 1, salesPaise: 45000 },
      ]);

      const hourlySum = summary.hourlySales.reduce((s, h) => s + h.salesPaise, 0);
      expect(hourlySum).toBe(145000);
      expect(summary.dailySales).toHaveLength(1);
      expect(summary.dailySales[0].salesPaise).toBe(145000);

      expect(summary.topItems).toEqual([
        { menuItemId: deps.paneer.id, name: "Paneer", quantity: 2, salesPaise: 95000 },
        { menuItemId: deps.rice.id, name: "Rice", quantity: 2, salesPaise: 50000 },
      ]);
      expect(summary.categorySales).toEqual([
        { categoryId: deps.cat.id, categoryName: "Mains", quantity: 4, salesPaise: 145000 },
      ]);

      expect(summary.recentOrders).toHaveLength(5);
      expect(summary.tables).toEqual({ occupied: 1, total: 2 });

      // Waiter mode: money is masked, operational counts stay visible.
      const waiter = await getDashboardSummary(restaurantId, { date: "today" }, { includeFinancials: false });
      expect(waiter.financialsHidden).toBe(true);
      expect(waiter.kpis.totalSalesPaise).toBe(0);
      expect(waiter.kpis.averageOrderValuePaise).toBe(0);
      expect(waiter.kpis.dueAmountPaise).toBe(0);
      expect(waiter.sales.netSalesPaise).toBe(0);
      expect(waiter.paymentBreakdown).toEqual([]);
      expect(waiter.topItems[0].salesPaise).toBe(0);
      expect(waiter.orderTypeBreakdown[0].salesPaise).toBe(0);
      expect(waiter.categorySales[0].salesPaise).toBe(0);
      expect(waiter.kpis.ordersCount).toBe(5);
      expect(waiter.kpis.paidBills).toBe(2);
      expect(waiter.recentOrders).toHaveLength(5);
    },
    30000
  );

  it(
    "sales, payments and orders reports reconcile (split-payment #45)",
    async () => {
      if (!available) return;
      const deps = await seedBase();

      await placeAndPay(
        {
          orderType: "DINE_IN",
          items: [
            { menuItemId: deps.paneer.id, quantity: 1 },
            { menuItemId: deps.rice.id, quantity: 2 },
          ],
          split: [
            { method: "CASH", amountPaise: 40000 },
            { method: "UPI", amountPaise: 60000 },
          ],
        },
        deps
      );
      await placeAndPay(
        {
          orderType: "TAKEAWAY",
          items: [{ menuItemId: deps.paneer.id, quantity: 1 }],
          discount: { discountType: "FIXED", discountValue: 50, discountReason: "Round off" },
          split: [{ method: "CARD", amountPaise: 45000 }],
        },
        deps
      );
      await placeBillOnly({ items: [{ menuItemId: deps.rice.id, quantity: 1 }] }, deps);

      const sales = await getSalesReport(restaurantId, q("sales"));
      expect(sales.summary.bills).toBe(2);
      expect(sales.summary.subtotalPaise).toBe(150000);
      expect(sales.summary.discountPaise).toBe(5000);
      expect(sales.summary.grandTotalPaise).toBe(145000);
      expect(sales.rows).toHaveLength(2);
      expect(sales.rows.find((r) => r.discountPaise === 5000)?.orderNumber).toBe(
        sales.rows[0].orderNumber || sales.rows[1].orderNumber
      );

      const payments = await getPaymentReport(restaurantId, q("payments"));
      expect(payments.summary.totalCollectedPaise).toBe(sales.summary.grandTotalPaise);
      expect(payments.summary.paymentsCount).toBe(3);
      expect(payments.summary.byMethod).toEqual([
        { method: "UPI", amountPaise: 60000, count: 1 },
        { method: "CARD", amountPaise: 45000, count: 1 },
        { method: "CASH", amountPaise: 40000, count: 1 },
      ]);

      // The split bill contributes exactly two payment rows sharing one bill.
      const cashRow = payments.rows.find((r) => r.method === "CASH");
      const upiRow = payments.rows.find((r) => r.method === "UPI");
      expect(cashRow?.billNumber).toBe(upiRow?.billNumber);
      expect(cashRow?.orderNumber).toBe(upiRow?.orderNumber);
      expect(cashRow?.amountPaise).toBe(40000);
      expect(upiRow?.amountPaise).toBe(60000);

      const orders = await getOrderReport(restaurantId, q("orders"));
      expect(orders.summary.orders).toBe(3);
      expect(orders.summary.totalPaise).toBe(175000);
      const byStatus = Object.fromEntries(
        orders.summary.byStatus.map((s) => [s.status, s.orders])
      );
      expect(byStatus).toMatchObject({ PAID: 2, OPEN: 1 });
    },
    30000
  );

  it(
    "item and category reports aggregate only paid bills",
    async () => {
      if (!available) return;
      const deps = await seedBase();

      await placeAndPay(
        {
          orderType: "DINE_IN",
          items: [
            { menuItemId: deps.paneer.id, quantity: 1 },
            { menuItemId: deps.rice.id, quantity: 2 },
          ],
          split: [
            { method: "CASH", amountPaise: 40000 },
            { method: "UPI", amountPaise: 60000 },
          ],
        },
        deps
      );
      await placeAndPay(
        {
          orderType: "TAKEAWAY",
          items: [{ menuItemId: deps.paneer.id, quantity: 1 }],
          discount: { discountType: "FIXED", discountValue: 50, discountReason: "Round off" },
          split: [{ method: "CARD", amountPaise: 45000 }],
        },
        deps
      );
      // Unpaid + cancelled — must not inflate item totals.
      await placeBillOnly({ items: [{ menuItemId: deps.rice.id, quantity: 1 }] }, deps);
      const cancelled = await createOrder(restaurantId, ownerId, {
        orderType: "QUICK_SALE",
        items: [{ menuItemId: deps.paneer.id, quantity: 9 }],
      });
      await cancelOrder(restaurantId, cancelled.id, ownerId, "gone");

      const items = await getItemSalesReport(restaurantId, q("items"));
      expect(items.summary.quantity).toBe(4);
      expect(items.summary.salesPaise).toBe(145000);
      expect(items.summary.distinctItems).toBe(2);
      const byName = Object.fromEntries(items.rows.map((r) => [r.name, r]));
      expect(byName.Paneer).toMatchObject({ quantity: 2, salesPaise: 95000 });
      expect(byName.Rice).toMatchObject({ quantity: 2, salesPaise: 50000 });

      const categories = await getCategorySalesReport(restaurantId, q("categories"));
      expect(categories.summary.quantity).toBe(4);
      expect(categories.summary.salesPaise).toBe(145000);
      expect(categories.rows[0].categoryName).toBe("Mains");
    },
    30000
  );

  it(
    "gst report splits CGST/SGST for a gst-registered restaurant",
    async () => {
      if (!available) return;
      const rid = await createRestaurant("GST Restaurant", true, "27AABCP1234F1Z5");
      await RestaurantSettingsModel.updateOne(
        { restaurantId: new mongoose.Types.ObjectId(rid) },
        {
          $set: {
            taxEnabled: true,
            defaultTaxRate: 5,
            taxInclusive: false,
            gstScheme: "INTRA_STATE",
            cgstRatePercent: 2.5,
            sgstRatePercent: 2.5,
            igstRatePercent: 5,
          },
        }
      );
      const owner = await UserModel.findOne({ restaurantId: rid, role: "OWNER" });
      const by = String(owner?._id ?? "");

      const cat = await createCategory(rid, {
        name: "Mains",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const paneer = await createMenuItem(
        rid,
        item("Paneer", { categoryId: cat.id, basePriceRupees: 500 })
      );
      const order = await createOrder(rid, by, {
        orderType: "QUICK_SALE",
        items: [{ menuItemId: paneer.id, quantity: 1 }],
      });
      const bill = await generateBill(rid, order.id, by);
      expect(bill.grandTotalPaise).toBe(52500);
      expect(bill.cgstAmountPaise).toBe(1250);
      expect(bill.sgstAmountPaise).toBe(1250);
      expect(bill.cgstRatePercent).toBe(2.5);
      expect(bill.sgstRatePercent).toBe(2.5);
      expect(bill.igstRatePercent).toBe(5);
      await recordPayment(rid, bill.id, by, {
        method: "CARD",
        amountPaise: bill.grandTotalPaise,
      });

      const gst = await getGSTReport(rid, q("gst"));
      expect(gst.rows).toEqual([
        {
          taxRatePercent: 5,
          gstScheme: "INTRA_STATE",
          taxableAmountPaise: 50000,
          cgstAmountPaise: 1250,
          sgstAmountPaise: 1250,
          igstAmountPaise: 0,
          totalTaxPaise: 2500,
          bills: 1,
        },
      ]);
      expect(gst.summary).toMatchObject({
        taxableAmountPaise: 50000,
        cgstAmountPaise: 1250,
        sgstAmountPaise: 1250,
        igstAmountPaise: 0,
        totalTaxPaise: 2500,
        grossSalesPaise: 52500,
        bills: 1,
      });
    },
    30000
  );

  it(
    "discount report lists only discounted paid bills",
    async () => {
      if (!available) return;
      const deps = await seedBase();
      await placeAndPay(
        {
          orderType: "TAKEAWAY",
          items: [{ menuItemId: deps.paneer.id, quantity: 1 }],
          discount: { discountType: "FIXED", discountValue: 50, discountReason: "Round off" },
          split: [{ method: "CARD", amountPaise: 45000 }],
        },
        deps
      );
      await placeAndPay({ items: [{ menuItemId: deps.rice.id, quantity: 1 }] }, deps);

      const discounts = await getDiscountReport(restaurantId, q("discounts"));
      expect(discounts.summary.discountedBills).toBe(1);
      expect(discounts.summary.totalDiscountPaise).toBe(5000);
      expect(discounts.summary.grossBeforeDiscountPaise).toBe(50000);
      expect(discounts.rows).toHaveLength(1);
      expect(discounts.rows[0]).toMatchObject({
        discountPaise: 5000,
        grandTotalPaise: 45000,
        subtotalPaise: 50000,
      });
    },
    30000
  );

  it(
    "cancellation report mixes cancelled orders and cancelled bills",
    async () => {
      if (!available) return;
      const deps = await seedBase();

      const cancelledOrder = await createOrder(restaurantId, ownerId, {
        orderType: "QUICK_SALE",
        items: [{ menuItemId: deps.paneer.id, quantity: 1 }],
      });
      await cancelOrder(restaurantId, cancelledOrder.id, ownerId, "customer left");

      const cancelledBillFlow = await placeBillOnly(
        { items: [{ menuItemId: deps.rice.id, quantity: 1 }] },
        deps
      );
      await cancelBill(restaurantId, cancelledBillFlow.bill.id, ownerId, "wrong item");

      const report = await getCancellationReport(restaurantId, q("cancellations"));
      expect(report.summary).toMatchObject({
        cancelledOrders: 1,
        cancelledBills: 1,
        cancelledValuePaise: 75000,
      });
      expect(report.total).toBe(2);
      expect(report.rows).toHaveLength(2);

      const orderRow = report.rows.find((r) => r.kind === "ORDER");
      const billRow = report.rows.find((r) => r.kind === "BILL");
      expect(orderRow?.amountPaise).toBe(50000);
      expect(orderRow?.reason).toBe("customer left");
      expect(billRow?.amountPaise).toBe(25000);
      expect(billRow?.reason).toBe("wrong item");
      expect(billRow?.reference).toMatch(/^BILL-/);
      expect(orderRow?.reference).toMatch(/^#\d+$/);
    },
    30000
  );

  it(
    "date-range windows bucket the same rows correctly",
    async () => {
      if (!available) return;
      const deps = await seedBase();

      const today = await placeAndPay(
        { items: [{ menuItemId: deps.paneer.id, quantity: 1 }] },
        deps
      );
      void today;
      const yesterday = await placeAndPay(
        { items: [{ menuItemId: deps.paneer.id, quantity: 1 }] },
        deps
      );
      const yesterdayNoon = new Date(istMidnightUtc(1, new Date()).getTime() + 12 * 60 * 60 * 1000);
      await backdatePaid(yesterday.payments, yesterdayNoon, yesterday.bill.id);

      const lastMonth = await placeAndPay(
        { items: [{ menuItemId: deps.paneer.id, quantity: 2 }] },
        deps
      );
      const { from, to } = getBusinessDateRange("last_month");
      const lastMonthMid = new Date(from.getTime() + (to.getTime() - from.getTime()) / 2);
      await backdatePaid(lastMonth.payments, lastMonthMid, lastMonth.bill.id);

      const ym = (d: Date) => {
        const ist = new Date(d.getTime() + IST);
        return ist.toISOString().slice(0, 10);
      };

      const todayReport = await getSalesReport(restaurantId, q("sales"));
      expect(todayReport.summary.bills).toBe(1);
      expect(todayReport.summary.grandTotalPaise).toBe(50000);

      const yesterdayReport = await getSalesReport(restaurantId, q("sales", { date: "yesterday" }));
      expect(yesterdayReport.summary.bills).toBe(1);
      expect(yesterdayReport.summary.grandTotalPaise).toBe(50000);

      const weekReport = await getSalesReport(restaurantId, q("sales", { date: "7d" }));
      expect(weekReport.summary.bills).toBe(2);
      expect(weekReport.summary.grandTotalPaise).toBe(100000);

      const monthReport = await getSalesReport(restaurantId, q("sales", { date: "last_month" }));
      // On the 1st of a month, "yesterday" IS inside last month, so the window
      // legitimately contains both the backdated last-month bill and yesterday's.
      const yesterdayInLastMonth = yesterdayNoon >= from && yesterdayNoon <= to;
      expect(monthReport.summary.bills).toBe(yesterdayInLastMonth ? 2 : 1);
      expect(monthReport.summary.grandTotalPaise).toBe(yesterdayInLastMonth ? 150000 : 100000);

      const customReport = await getSalesReport(
        restaurantId,
        q("sales", {
          date: "custom",
          from: ym(yesterdayNoon),
          to: ym(new Date()),
        })
      );
      expect(customReport.summary.bills).toBe(2);
      expect(customReport.summary.grandTotalPaise).toBe(100000);

      // Day-bucketed list on the dashboard: today and yesterday are inside the
        // 7-day window; the last-month bill is bucketed separately.
        const dashboardWeek = await getDashboardSummary(restaurantId, { date: "7d" });
        expect(dashboardWeek.dailySales).toHaveLength(2);
        const bucketSum = dashboardWeek.dailySales.reduce((s, d) => s + d.salesPaise, 0);
        expect(bucketSum).toBe(100000);
    },
    30000
  );

  it(
    "never leaks another restaurant's numbers",
    async () => {
      if (!available) return;
      const deps = await seedBase();

      await placeAndPay(
        { items: [{ menuItemId: deps.paneer.id, quantity: 1 }] },
        deps
      );

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
        item("Biryani", { categoryId: otherCat.id, basePriceRupees: 400 })
      );
      const otherOrder = await createOrder(otherRid, String(otherOwner?._id), {
        orderType: "QUICK_SALE",
        items: [{ menuItemId: otherItem.id, quantity: 1 }],
      });
      const otherBill = await generateBill(otherRid, otherOrder.id, String(otherOwner?._id));
      await recordPayment(otherRid, otherBill.id, String(otherOwner?._id), {
        method: "UPI",
        amountPaise: otherBill.grandTotalPaise,
      });

      const mine = await getSalesReport(restaurantId, q("sales"));
      expect(mine.summary.bills).toBe(1);
      expect(mine.summary.grandTotalPaise).toBe(50000);

      const others = await getSalesReport(otherRid, q("sales"));
      expect(others.summary.bills).toBe(1);
      expect(others.summary.grandTotalPaise).toBe(40000);

      const myDashboard = await getDashboardSummary(restaurantId, { date: "today" });
      expect(myDashboard.kpis.totalSalesPaise).toBe(50000);
      expect(myDashboard.topItems.map((t) => t.name)).toEqual(["Paneer"]);
      expect(myDashboard.recentOrders.some((o) => o.id === otherOrder.id)).toBe(false);
    },
    30000
  );

  it(
    "paginates sales and clamps out-of-range pages",
    async () => {
      if (!available) return;
      const deps = await seedBase();
      const total = 27;
      for (let i = 0; i < total; i++) {
        await placeAndPay({ items: [{ menuItemId: deps.rice.id, quantity: 1 }] }, deps);
      }

      const first = await getSalesReport(restaurantId, q("sales"));
      expect(first.total).toBe(total);
      expect(first.pageCount).toBe(2);
      expect(first.rows).toHaveLength(25);

      const second = await getSalesReport(restaurantId, q("sales", { page: "2" }));
      expect(second.page).toBe(2);
      expect(second.rows).toHaveLength(2);

      const tooFar = await getSalesReport(restaurantId, q("sales", { page: "99" }));
      expect(tooFar.page).toBe(2);
      expect(tooFar.rows).toHaveLength(2);
    },
    60000
  );

  it(
    "csv export builds safe, readable rows",
    async () => {
      if (!available) return;
      const deps = await seedBase();
      await placeAndPay(
        {
          orderType: "DINE_IN",
          customerName: "=SUM(A1:A9)",
          items: [
            { menuItemId: deps.paneer.id, quantity: 1 },
            { menuItemId: deps.rice.id, quantity: 2 },
          ],
          split: [
            { method: "CASH", amountPaise: 40000 },
            { method: "UPI", amountPaise: 60000 },
          ],
        },
        deps
      );

      const sales = await buildReportExport(restaurantId, q("sales"));
      expect(sales.filename).toBe("zyp-pos-sales-report.csv");
      const salesCsv = await readStream(sales.stream);
      expect(salesCsv).toContain("Bill,Paid on,Order,Type,Table,Customer");
      expect(salesCsv).toContain("1000.00");
      expect(salesCsv).toContain("'=SUM(A1:A9)");

      const payments = await buildReportExport(restaurantId, q("payments"));
      const paymentsCsv = await readStream(payments.stream);
      expect(paymentsCsv).toContain("Received on,Method,Amount (INR)");
      expect(paymentsCsv).toContain("600.00");
      expect(paymentsCsv).toContain("400.00");
    },
    30000
  );
});