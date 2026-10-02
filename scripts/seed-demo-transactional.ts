import "server-only";

import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { OrderModel } from "@/models/Order";
import { RestaurantTableModel } from "@/models/RestaurantTable";

loadEnvConfig(process.cwd());

const RESTAURANT_NAME = "Demo Spice Kitchen";
const RESTAURANT_ID = new mongoose.Types.ObjectId("6abeaccefeadc0416b5174f9");

const START_DAY = "2026-08-01";
const END_DAY = "2026-10-01";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ORDERS_PER_DAY = 50;

const LUNCH_START_HOUR = 12;
const LUNCH_END_HOUR = 15.5;
const DINNER_START_HOUR = 19;
const DINNER_END_HOUR = 23;

const PAYMENT_METHODS = ["CASH", "UPI", "CARD"] as const;
const PAYMENT_WEIGHTS = [0.3, 0.55, 0.15];

const ORDER_TYPES = ["DINE_IN", "TAKEAWAY"] as const;
const ORDER_TYPE_WEIGHTS_WEEKDAY = [0.7, 0.3];
const ORDER_TYPE_WEIGHTS_WEEKEND = [0.6, 0.4];

const DISCOUNT_CHANCE = 0.15;
const DISCOUNT_TYPES = ["PERCENTAGE", "FIXED"] as const;
const DISCOUNT_PERCENTAGES = [5, 8, 10, 12];
const DISCOUNT_FIXED = [30, 50, 75, 100];

const CANCEL_CHANCE = 0.03;

interface SeedContext {
  restaurantId: mongoose.Types.ObjectId;
  users: {
    owner: string;
    manager: string;
    cashiers: string[];
    waiters: string[];
  };
  tables: string[];
  menuItems: Array<{
    _id: string;
    name: string;
    pricePaise: number;
    variantIds: string[];
  }>;
  settings: {
    serviceChargeEnabled: boolean;
    serviceChargeRate: number;
    roundOffEnabled: boolean;
  };
  rng: () => number;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), t | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function istMidnightUtc(isoDay: string): number {
  const [y, m, d] = isoDay.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
    if (!arr || arr.length === 0) {
      throw new Error("pick() called with empty or undefined array");
    }
    return arr[Math.floor(rng() * arr.length)];
  }

function weighted<T>(rng: () => number, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomMinutesInRange(rng: () => number, startHour: number, endHour: number): number {
  const startMin = startHour * 60;
  const endMin = endHour * 60;
  return Math.floor(startMin + rng() * (endMin - startMin));
}

async function buildContext(services: any): Promise<SeedContext> {
  // Users
  const users = await UserModel.find({ restaurantId: RESTAURANT_ID }).lean();
  const owner = users.find(u => u.role === "OWNER")!._id.toString();
  const manager = users.find(u => u.role === "MANAGER")!._id.toString();
  const cashiers = users.filter(u => u.role === "CASHIER").map(u => u._id.toString());
  const waiters = users.filter(u => u.role === "WAITER").map(u => u._id.toString());

  // Tables
  const tables = await services.tableService.getTables(RESTAURANT_ID.toString());
  const tableIds = tables.map((t: any) => t.id);

  // Menu items
  const menuItems = await services.itemService.getMenuItems(RESTAURANT_ID.toString(), { isAvailable: true });
  const orderableItems = menuItems
    .filter((m: any) => m.isAvailable)
    .map((m: any) => ({
      _id: m.id,
      name: m.name,
      pricePaise: m.basePricePaise,
      variantIds: m.variants?.map((v: any) => v.id) || [],
    }));

  // Settings - use model directly
  const settingsDoc = await RestaurantSettingsModel.findOne({ restaurantId: RESTAURANT_ID }).lean();

  return {
    restaurantId: RESTAURANT_ID,
    users: { owner, manager, cashiers, waiters },
    tables: tableIds,
    menuItems: orderableItems,
    settings: {
      serviceChargeEnabled: settingsDoc?.serviceChargeEnabled ?? true,
      serviceChargeRate: settingsDoc?.serviceChargeRate ?? 5,
      roundOffEnabled: settingsDoc?.roundOffEnabled ?? true,
    },
    rng: mulberry32(20260801),
  };
}

function buildOrderItems(
  ctx: SeedContext,
  count: number
): Array<{
  menuItemId: string;
  variantId?: string;
  quantity: number;
  note?: string;
}> {
  const items = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let item = pick(ctx.rng, ctx.menuItems);
    let attempts = 0;
    while (used.has(item._id) && attempts < 10) {
      item = pick(ctx.rng, ctx.menuItems);
      attempts++;
    }
    used.add(item._id);

    let variantId: string | undefined;
    // If item has variants, we MUST select one (order-service requires it)
    if (item.variantIds.length > 0) {
      variantId = pick(ctx.rng, item.variantIds);
    }

    const quantity = Math.floor(ctx.rng() * 3) + 1;
    items.push({ menuItemId: item._id, variantId, quantity });
  }
  return items;
}

function getItemPrice(ctx: SeedContext, menuItemId: string, variantId?: string): number {
  const item = ctx.menuItems.find(m => m._id === menuItemId);
  if (!item) {
    throw new Error(`Menu item not found: ${menuItemId}`);
  }
  return item.pricePaise;
}

function computeSubtotal(
  ctx: SeedContext,
  items: Array<{ menuItemId: string; variantId?: string; quantity: number }>
): number {
  let total = 0;
  for (const item of items) {
    const price = getItemPrice(ctx, item.menuItemId, item.variantId);
    total += price * item.quantity;
  }
  return total;
}

function computeDiscount(
  rng: () => number,
  subtotal: number
): { type: "PERCENTAGE" | "FIXED"; value: number; amountPaise: number } | null {
  if (rng() >= DISCOUNT_CHANCE) return null;
  const type = pick(rng, DISCOUNT_TYPES);
  if (type === "PERCENTAGE") {
    const pct = pick(rng, DISCOUNT_PERCENTAGES);
    const amount = Math.round(subtotal * (pct / 100));
    return { type: "PERCENTAGE", value: pct, amountPaise: amount };
  } else {
    const fixed = Math.min(pick(rng, DISCOUNT_FIXED), Math.floor(subtotal * 0.15));
    const amount = fixed * 100;
    return { type: "FIXED", value: fixed, amountPaise: amount };
  }
}

function computeTax(subtotal: number, discountAmount: number): number {
  const taxable = subtotal - discountAmount;
  const cgst = Math.round(taxable * 0.025);
  const sgst = Math.round(taxable * 0.025);
  return cgst + sgst;
}

function computeServiceCharge(
  ctx: SeedContext,
  subtotal: number,
  discountAmount: number
): number {
  if (!ctx.settings.serviceChargeEnabled) return 0;
  const base = subtotal - discountAmount;
  return Math.round(base * (ctx.settings.serviceChargeRate / 100));
}

function computeRoundOff(
  ctx: SeedContext,
  amount: number
): number {
  if (!ctx.settings.roundOffEnabled) return 0;
  const rupees = amount / 100;
  const rounded = Math.round(rupees);
  return (rounded - rupees) * 100;
}

async function releaseTableIfIdle(restaurantId: mongoose.Types.ObjectId, tableId: string, excludeOrderId?: string): Promise<void> {
  const ACTIVE_ORDER_STATUSES = ["OPEN", "KOT_SENT", "PREPARING", "READY", "SERVED"];
  const query: Record<string, unknown> = {
    restaurantId,
    tableId,
    status: { $in: ACTIVE_ORDER_STATUSES },
  };
  if (excludeOrderId) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeOrderId) };
  }
  const stillOccupied = await OrderModel.exists(query);
  console.log(`  [DEBUG] releaseTableIfIdle: table=${tableId}, exclude=${excludeOrderId}, stillOccupied=${stillOccupied}`);
  if (stillOccupied) return;
  await RestaurantTableModel.updateOne(
    { _id: tableId, restaurantId },
    { $set: { status: "AVAILABLE" } }
  );
  console.log(`  [DEBUG] Table ${tableId} released to AVAILABLE`);
}

async function seedDay(
  ctx: SeedContext,
  services: any,
  dayIndex: number,
  dayStartMs: number
): Promise<{ orders: number; revenue: number }> {
  const isWeekend = dayIndex % 7 === 5 || dayIndex % 7 === 6;
  const orderTypeWeights = isWeekend ? ORDER_TYPE_WEIGHTS_WEEKEND : ORDER_TYPE_WEIGHTS_WEEKDAY;

  let dayOrders = 0;
  let dayRevenue = 0;

  for (let i = 0; i < ORDERS_PER_DAY; i++) {
    const isLunch = i < ORDERS_PER_DAY * 0.4;
    const hourRange = isLunch
      ? [LUNCH_START_HOUR, LUNCH_END_HOUR]
      : [DINNER_START_HOUR, DINNER_END_HOUR];
    const minuteOfDay = randomMinutesInRange(ctx.rng, hourRange[0], hourRange[1]);
    const orderMs = dayStartMs + minuteOfDay * 60 * 1000 + Math.floor(ctx.rng() * 60 * 1000);

    const orderType = weighted(ctx.rng, ORDER_TYPES, orderTypeWeights);
    // For DINE_IN, pick an AVAILABLE table
    let tableId: string | undefined;
    if (orderType === "DINE_IN") {
      const availableTables = ctx.tables.filter(tid => {
        // Check table status directly
        return true; // We'll check availability in the order service
      });
      if (availableTables.length === 0) {
        // No available tables, fall back to TAKEAWAY
        console.warn(`  No available tables for DINE_IN, falling back to TAKEAWAY`);
      } else {
        tableId = pick(ctx.rng, availableTables);
      }
    }
    const userId = pick(ctx.rng, ctx.users.cashiers);

    const itemCount = isWeekend ? Math.floor(ctx.rng() * 4) + 3 : Math.floor(ctx.rng() * 3) + 2;
    const items = buildOrderItems(ctx, itemCount);

    const subtotal = computeSubtotal(ctx, items);

    // Discount for bill (not order)
    const usePercentageDiscount = ctx.rng() < 0.7;
    const hasDiscount = ctx.rng() < DISCOUNT_CHANCE;
    const maxFixedRupees = Math.max(1, Math.floor((subtotal * 0.15) / 100));
    const discountInput = !hasDiscount
      ? undefined
      : usePercentageDiscount
        ? {
            discountType: "PERCENTAGE" as const,
            discountValue: pick(ctx.rng, DISCOUNT_PERCENTAGES),
            discountReason: "Promotional",
          }
        : {
            discountType: "FIXED" as const,
            discountValue: Math.min(pick(ctx.rng, DISCOUNT_FIXED), maxFixedRupees),
            discountReason: "Promotional",
          };

    const orderInput = {
      restaurantId: ctx.restaurantId.toString(),
      userId: pick(ctx.rng, ctx.users.cashiers),
      tableId,
      orderType,
      items: items.map(item => ({
        menuItemId: item.menuItemId,
        variantId: item.variantId,
        quantity: item.quantity,
        note: item.note,
      })),
      customerName: orderType === "TAKEAWAY" ? `Customer ${Math.floor(ctx.rng() * 1000)}` : undefined,
      customerPhone: orderType === "TAKEAWAY" ? `98${Math.floor(10000000 + ctx.rng() * 90000000)}` : undefined,
      discountType: undefined,
      discountValue: undefined,
      discountReason: undefined,
      orderNote: undefined,
    };

    try {
      const order = await services.orderService.createOrder(
        ctx.restaurantId.toString(),
        orderInput.userId,
        orderInput
      );

      dayOrders++;
      let orderRevenue = 0;

      const placedAt = new Date(orderMs);

      // KOT for dine-in
      if (orderType === "DINE_IN") {
        await services.orderService.sendOrderToKitchen(ctx.restaurantId.toString(), order.id);
        const printed = await services.kotService.printPendingKot(
          ctx.restaurantId.toString(),
          order.id,
          orderInput.userId
        );
        if (printed.kot) {
          await services.kotService.markKotSent(
            ctx.restaurantId.toString(),
            printed.kot.id
          );
        }
      }

      // Bill with discount
      const bill = await services.billService.generateBill(
        ctx.restaurantId.toString(),
        order.id,
        orderInput.userId,
        discountInput
      );

      const billAt = new Date(orderMs + Math.floor(ctx.rng() * 10 * 60 * 1000) + 300000);
      const grandTotal = bill.grandTotalPaise;

      if (grandTotal < 1) {
        console.warn(`  Bill ${bill.id} has zero total, skipping`);
        continue;
      }

      dayRevenue += grandTotal;
      orderRevenue = grandTotal;

      // Cancellation
      if (ctx.rng() < CANCEL_CHANCE) {
        await services.orderService.cancelOrder(
          ctx.restaurantId.toString(),
          order.id,
          orderInput.userId,
          "Customer cancelled"
        );
        dayOrders--;
        dayRevenue -= grandTotal;
        continue;
      }

      // Payment
      const paymentMethod = weighted(ctx.rng, PAYMENT_METHODS, PAYMENT_WEIGHTS);
      const paidAt = new Date(billAt.getTime() + Math.floor(ctx.rng() * 5 * 60 * 1000));

      // ~15% of dine-in bills are settled in two parts
      if (orderType === "DINE_IN" && ctx.rng() < 0.15) {
        const firstMethod = paymentMethod;
        const secondMethod = weighted(ctx.rng, PAYMENT_METHODS, PAYMENT_WEIGHTS);
        const firstPart = Math.round(grandTotal * (0.35 + ctx.rng() * 0.35));

        await services.billService.recordPayment(
          ctx.restaurantId.toString(),
          bill.id,
          orderInput.userId,
          {
            method: firstMethod,
            amountPaise: firstPart,
            referenceNumber: firstMethod !== "CASH" ? `REF${Math.floor(ctx.rng() * 1e12)}` : undefined,
          }
        );

await services.billService.completePayment(
            ctx.restaurantId.toString(),
            bill.id,
            orderInput.userId,
            {
              method: secondMethod,
              referenceNumber: secondMethod !== "CASH" ? `REF${Math.floor(ctx.rng() * 1e12)}` : undefined,
            }
          );

          // Release table after payment
          if (tableId) {
            await releaseTableIfIdle(ctx.restaurantId, tableId, order.id);
          }
        } else {
await services.billService.completePayment(
            ctx.restaurantId.toString(),
            bill.id,
            orderInput.userId,
            {
              method: paymentMethod,
              referenceNumber: paymentMethod !== "CASH" ? `REF${Math.floor(ctx.rng() * 1e12)}` : undefined,
            }
          );

          // Update order status to PAID so table can be released
          await OrderModel.findByIdAndUpdate(order.id, {
            $set: { status: "PAID", paidAt: billAt },
          });

          // Release table after payment
          if (tableId) {
            await releaseTableIfIdle(ctx.restaurantId, tableId, order.id);
          }
        // Backdate timestamps
      await OrderModel.findByIdAndUpdate(order.id, {
        $set: { createdAt: placedAt, updatedAt: placedAt, placedAt },
      });

      await mongoose.model("Bill").findByIdAndUpdate(bill.id, {
        $set: { createdAt: billAt, updatedAt: billAt, paidAt: billAt },
      });

      await mongoose.model("Payment").find(
        { billId: bill.id, restaurantId: ctx.restaurantId }
      ).then(docs => {
        docs.forEach(doc => {
          mongoose.model("Payment").findByIdAndUpdate(doc._id, {
            $set: { createdAt: paidAt, updatedAt: paidAt },
          });
        });
      });

      // KOT for dine-in
      if (orderType === "DINE_IN") {
        await services.orderService.sendOrderToKitchen(ctx.restaurantId.toString(), order.id);
        const printed = await services.kotService.printPendingKot(
          ctx.restaurantId.toString(),
          order.id,
          orderInput.userId
        );
        if (printed.kot) {
          await services.kotService.markKotSent(
            ctx.restaurantId.toString(),
            printed.kot.id
          );
          const kotAt = new Date(orderMs + Math.floor(ctx.rng() * 5 * 60 * 1000) + 60000);
          await mongoose.model("KitchenOrderTicket").findByIdAndUpdate(printed.kot.id, {
            $set: { createdAt: kotAt, updatedAt: kotAt, printedAt: kotAt },
          });
        }
      }
    }
    } catch (e) {
      console.error(`  Order ${i} failed:`, (e as Error).message);
    }
  }

  return { orders: dayOrders, revenue: dayRevenue };
}

async function main() {
  console.log("=== SEEDING DEMO TRANSACTIONAL DATA ===");
  console.log(`Restaurant: ${RESTAURANT_NAME} (${RESTAURANT_ID})`);
  console.log(`Range: ${START_DAY} to ${END_DAY}`);
  console.log(`Target: ${ORDERS_PER_DAY} orders/day`);

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "restopos";
  if (!uri) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName, maxPoolSize: 5 });
  console.log("Connected to MongoDB");

  // Dynamic imports: these modules pull in db/index (which reads MONGODB_URI at
  // import time) and are server-only, so they must load after loadEnvConfig and connect.
  const [
    tableService,
    itemService,
    orderService,
    kotService,
    billService,
  ] = await Promise.all([
    import("@/lib/tables/table-service"),
    import("@/lib/menu/item-service"),
    import("@/lib/orders/order-service"),
    import("@/lib/orders/kot-service"),
    import("@/lib/billing/bill-service"),
  ]);

  const services = {
    tableService,
    itemService,
    orderService,
    kotService,
    billService,
  };

  const ctx = await buildContext(services);
  console.log(`\nContext loaded:`);
  console.log(`  Users: 1 owner, 1 manager, ${ctx.users.cashiers.length} cashiers, ${ctx.users.waiters.length} waiters`);
  console.log(`  Tables: ${ctx.tables.length}`);
  console.log(`  Menu items: ${ctx.menuItems.length}`);

  const startMs = istMidnightUtc(START_DAY);
  const endMs = istMidnightUtc(END_DAY);
  const totalDays = Math.round((endMs - startMs) / DAY_MS) + 1;

  console.log(`\nTotal days: ${totalDays}`);

  const dailyResults: Array<{ date: string; orders: number; revenue: number }> = [];

  for (let day = 0; day < totalDays; day++) {
    const dayStartMs = startMs + day * DAY_MS;
    const dayDate = new Date(dayStartMs + IST_OFFSET_MS).toISOString().split("T")[0];

    // Check if we've passed "now" (Oct 1 current time)
    const now = new Date();
    if (dayStartMs > now.getTime()) {
      console.log(`\nStopping at ${dayDate} (future date)`);
      break;
    }

    const result = await seedDay(ctx, services, day, dayStartMs);
    dailyResults.push({ date: dayDate, orders: result.orders, revenue: result.revenue });

    if (day % 10 === 0 || day === totalDays - 1) {
      console.log(`  ${dayDate}: ${result.orders} orders, ₹${(result.revenue / 100).toFixed(2)}`);
    }
  }

  console.log("\n=== DAILY VERIFICATION ===");
  console.log("Date       | Orders | Revenue");
  console.log("-----------|--------|----------");
  for (const r of dailyResults) {
    console.log(`${r.date} | ${String(r.orders).padStart(6)} | ₹${(r.revenue / 100).toFixed(2).padStart(10)}`);
  }

  const totalOrders = dailyResults.reduce((a, b) => a + b.orders, 0);
  const totalRevenue = dailyResults.reduce((a, b) => a + b.revenue, 0);

  console.log("\n=== SUMMARY ===");
  console.log(`Total orders: ${totalOrders}`);
  console.log(`Total revenue: ₹${(totalRevenue / 100).toFixed(2)}`);

  // Monthly breakdown
  const aug = dailyResults.filter(r => r.date.startsWith("2026-08"));
  const sep = dailyResults.filter(r => r.date.startsWith("2026-09"));
  const oct = dailyResults.filter(r => r.date.startsWith("2026-10"));

  console.log("\n=== MONTHLY REVENUE ===");
  console.log(`August 2026:   ${aug.reduce((a,b)=>a+b.orders,0)} orders, ₹${(aug.reduce((a,b)=>a+b.revenue,0)/100).toFixed(2)}`);
  console.log(`September 2026: ${sep.reduce((a,b)=>a+b.orders,0)} orders, ₹${(sep.reduce((a,b)=>a+b.revenue,0)/100).toFixed(2)}`);
  console.log(`October 2026:   ${oct.reduce((a,b)=>a+b.orders,0)} orders, ₹${(oct.reduce((a,b)=>a+b.revenue,0)/100).toFixed(2)}`);

  // Final counts
  const orders = await OrderModel.countDocuments({ restaurantId: RESTAURANT_ID });
  const kots = await mongoose.model("KitchenOrderTicket").countDocuments({ restaurantId: RESTAURANT_ID });
  const bills = await mongoose.model("Bill").countDocuments({ restaurantId: RESTAURANT_ID });
  const payments = await mongoose.model("Payment").countDocuments({ restaurantId: RESTAURANT_ID });

  console.log("\n=== FINAL COUNTS ===");
  console.log(`Restaurant: 1`);
  console.log(`Menu categories: ${await mongoose.model("MenuCategory").countDocuments({ restaurantId: RESTAURANT_ID })}`);
  console.log(`Menu items: ${await mongoose.model("MenuItem").countDocuments({ restaurantId: RESTAURANT_ID })}`);
  console.log(`Tables: ${await mongoose.model("RestaurantTable").countDocuments({ restaurantId: RESTAURANT_ID })}`);
  console.log(`Users: ${await UserModel.countDocuments({ restaurantId: RESTAURANT_ID })}`);
  console.log(`Orders: ${orders}`);
  console.log(`KOTs: ${kots}`);
  console.log(`Bills: ${bills}`);
  console.log(`Payments: ${payments}`);
  console.log(`Subscription: ${await mongoose.model("Subscription").countDocuments({ restaurantId: RESTAURANT_ID })}`);

  // Integrity checks
  console.log("\n=== INTEGRITY CHECKS ===");
  const negBills = await mongoose.model("Bill").countDocuments({
    restaurantId: RESTAURANT_ID,
    grandTotalPaise: { $lt: 0 }
  });
  console.log(`Negative bills: ${negBills}`);
  const futureOrders = await OrderModel.countDocuments({
    restaurantId: RESTAURANT_ID,
    createdAt: { $gt: new Date() }
  });
  console.log(`Future-dated orders: ${futureOrders}`);

  // Subscription verification
  const sub = await mongoose.model("Subscription").findOne({ restaurantId: RESTAURANT_ID });
  console.log(`\n=== SUBSCRIPTION ===`);
  console.log(`Plan: ${sub?.planName}`);
  console.log(`Status: ${sub?.status}`);
  console.log(`Access: ${sub?.status === "ACTIVE" ? "allowed" : "denied"}`);

  // Super admin check
  const sa = await UserModel.findOne({ email: "ranvsingh7@gmail.com" });
  console.log(`\n=== SUPER_ADMIN ===`);
  console.log(`Email: ${sa?.email}`);
  console.log(`Role: ${sa?.role}`);
  console.log(`RestaurantId: ${sa?.restaurantId}`);
  console.log(`UpdatedAt: ${sa?.updatedAt}`);

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error("Seed failed:", e);
  process.exit(1);
});