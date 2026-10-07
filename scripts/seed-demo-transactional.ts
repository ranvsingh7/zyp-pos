//
// Transaction-only reseed for the EXISTING "Demo Spice Kitchen" tenant.
//
// Usage:
//   ALLOW_DESTRUCTIVE_PRODUCTION_DB=true npm run db:seed:demo:transactional
//
// What it does, in order:
//   1. Resolves the demo restaurant by GSTIN (never by fuzzy name) and snapshots
//      every record that MUST survive: restaurant, menu, tables, users, the
//      Silver plan, the active subscription and the SUPER_ADMIN account.
//   2. Prints the transactional counts that are about to be removed, deletes
//      ONLY those four collections for this restaurantId, and verifies the
//      preserved records are byte-identical afterwards.
//   3. Generates 2026-08-01 .. END_DAY of POS history through the production
//      service layer (order -> KOT -> bill -> payment) so numbering, tax,
//      discount, entitlement snapshots and table occupancy all come from the
//      same code the app runs. Only createdAt/updatedAt are backdated, in bulk,
//      to the simulated trading time.
//   4. Re-queries MongoDB and verifies the result.
//
// What it never touches: the restaurant, its menu, its tables, its users, the
// Silver plan, the subscription, any SUPER_ADMIN, or any other tenant.
//

import { loadEnvConfig } from "@next/env";
import { guardDestructiveScriptOrExit } from "./lib/production-db-guard";
import mongoose from "mongoose";

import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { OrderModel } from "@/models/Order";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { KotModel } from "@/models/KitchenOrderTicket";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";

import type { OrderType } from "@/lib/orders/constants";
import type { CreateOrderInput } from "@/lib/orders/validation";
import type { BillPaymentMethod } from "@/lib/billing/constants";

// ---------------------------------------------------------------------------
// Tenant identity + calendar
// ---------------------------------------------------------------------------

const DEMO_RESTAURANT_NAME = "Demo Spice Kitchen";
const DEMO_GSTIN = "08AAACD1234F1Z9";
const SILVER_PLAN_NAME = "Silver";
const SUPER_ADMIN_EMAIL = "ranvsingh7@gmail.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 3600 + 30 * 60) * 1000;
const SEED = 20260801;

const START_DAY_ISO = "2026-08-01";
const END_DAY_ISO = "2026-10-01";
const ORDERS_PER_DAY = 50;

/** Nothing seeded may be dated after this instant. */
const SEED_NOW = new Date();

function istMidnightUtc(isoDay: string): number {
  const [y, m, d] = isoDay.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS;
}

const RANGE_START_MS = istMidnightUtc(START_DAY_ISO);
const RANGE_END_MS = istMidnightUtc(END_DAY_ISO);
const DAY_COUNT = Math.round((RANGE_END_MS - RANGE_START_MS) / DAY_MS) + 1;

/** IST wall-clock minutes -> ms offset from that day's IST midnight. */
function istMinutesToMs(dayStartMs: number, minutes: number): number {
  return dayStartMs + minutes * 60_000;
}

/** Final day of the range: the last minute that is still in the past. */
const LAST_DAY_END_MS = RANGE_END_MS + DAY_MS - 60_000;

/**
 * Trading windows in IST minutes-from-midnight. Lunch and dinner carry the day,
 * exactly as specified; the morning/afternoon trickle is kept because a real
 * kitchen does not sit idle between services.
 */
const SERVICE_WINDOWS = [
  { from: 8 * 60, to: 11 * 60, weight: 7 },
  { from: 12 * 60, to: 15 * 60 + 30, weight: 34 },
  { from: 15 * 60 + 30, to: 19 * 60, weight: 14 },
  { from: 19 * 60, to: 23 * 60, weight: 45 },
] as const;

// ---------------------------------------------------------------------------
// Deterministic PRNG + helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick() called with an empty array");
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

function weighted<T>(rng: () => number, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function inr(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function istDayKey(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function dayName(dayStartMs: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(dayStartMs + IST_OFFSET_MS).getUTCDay()
  ];
}

const CUSTOMER_NAMES = [
  "Aarav Sharma", "Ishita Patel", "Rohan Mehta", "Sneha Iyer", "Arjun Nair",
  "Priya Reddy", "Vikram Joshi", "Ananya Gupta", "Karthik Nair", "Divya Menon",
  "Rahul Verma", "Sanya Kapoor", "Aditya Singh", "Meera Joshi", "Nikhil Rao",
  "Pooja Bhatt", "Suresh Solanki", "Kavita Rathore", "Manish Saini", "Neha Bhardwaj",
] as const;

const DISCOUNT_REASONS = [
  "Regular guest",
  "Birthday treat",
  "Promotional offer",
  "Staff recommendation",
  "Loyalty reward",
] as const;

/** Realistic Indian casual-dining mix: UPI dominant, cash solid, card small. */
const PAYMENT_WEIGHTS: ReadonlyArray<readonly [BillPaymentMethod, number]> = [
  ["UPI", 55],
  ["CASH", 30],
  ["CARD", 11],
  ["OTHER", 4],
];

function paymentReference(rng: () => number, method: BillPaymentMethod): string | undefined {
  if (method === "UPI") return `UPI${randInt(rng, 1000000000, 9999999999)}`;
  if (method === "CARD") return `CARD-${randInt(rng, 100000, 999999)}`;
  if (method === "OTHER") return `REF-${randInt(rng, 100000, 999999)}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Order plan
// ---------------------------------------------------------------------------

/**
 * Every stochastic decision for one order is rolled BEFORE any database work,
 * with the single deterministic PRNG. The DB calls then run with bounded
 * concurrency; the generated data is still fully reproducible because the
 * values all come from this precomputed plan.
 */
interface OrderPlan {
  placedAtMs: number;
  orderType: OrderType;
  ringUser: string;
  settleUser: string;
  lines: Array<{ menuItemId: string; variantId: string | null; quantity: number }>;
  customerName: string | undefined;
  customerPhone: string | undefined;
  tableCandidates: string[];
  discount: DiscountPlan;
  method: BillPaymentMethod;
  split: boolean;
  secondMethod: BillPaymentMethod | undefined;
  firstPartPaise: number | undefined;
  kotOffsetMin: number;
  billOffsetMin: number;
  paidExtraMin: number;
  reference1: string | undefined;
  reference2: string | undefined;
}

type DiscountPlan =
  | { discountType: "PERCENTAGE"; discountValue: number; discountReason: string }
  | { discountType: "FIXED"; discountValue: number; discountReason: string }
  | undefined;

interface TableDoc {
  _id: mongoose.Types.ObjectId;
}

const CONCURRENCY = 6;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Backdating
// ---------------------------------------------------------------------------

// Backdating targets the *native* driver handle rather than `Model.bulkWrite`:
// mongoose marks `createdAt` immutable, so it silently drops `createdAt` from an
// update payload while still reporting `modifiedCount: 1`. Only the raw
// collection actually backdates a record's creation time.
interface AnyMongooseModel {
  collection: {
    bulkWrite(ops: unknown[], options?: { ordered?: boolean }): Promise<{ matchedCount?: number }>;
  };
}
type RestampOp = { model: AnyMongooseModel; id: string; patch: Record<string, Date> };

/**
 * Timestamps are buffered and flushed with bulkWrite: a two-month run performs
 * tens of thousands of timestamp writes, and one round trip per document would
 * dominate the runtime. `ordered: false` keeps a single failure from aborting
 * the batch, and the matched-count check refuses to leave a partially dated
 * history behind.
 */
class Restamper {
  private ops: RestampOp[] = [];

  queue(model: unknown, id: string, patch: Record<string, Date>): void {
    this.ops.push({ model: model as AnyMongooseModel, id, patch });
  }

  get pending(): number {
    return this.ops.length;
  }

  async flush(): Promise<void> {
    if (this.ops.length === 0) return;
    // Merge per document first: one order is often stamped twice (once for the
    // kitchen hand-off, once for payment) and those patches overlap.
    const byModel = new Map<AnyMongooseModel, Map<string, Record<string, Date>>>();
    for (const op of this.ops) {
      let patches = byModel.get(op.model);
      if (!patches) {
        patches = new Map();
        byModel.set(op.model, patches);
      }
      patches.set(op.id, { ...(patches.get(op.id) ?? {}), ...op.patch });
    }
    this.ops = [];

    for (const [model, patches] of byModel) {
      const entries = [...patches.entries()];
      for (let i = 0; i < entries.length; i += 500) {
        const batch = entries.slice(i, i + 500);
        const result = (await model.collection.bulkWrite(
          batch.map(([id, patch]) => ({
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(id) },
              update: { $set: patch },
            },
          })),
          { ordered: false }
        )) as { matchedCount?: number };
        const matched = result.matchedCount ?? 0;
        if (matched < batch.length) {
          throw new Error(
            `Backdating matched ${matched} of ${batch.length} documents; ` +
              "refusing to leave a partially dated history behind."
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Trading calendar
// ---------------------------------------------------------------------------

/**
 * Samples `count` distinct minutes across the service windows by weight, so
 * lunch/dinner are busy and the afternoon lulls. The final day is hard-capped at
 * the current instant: no seeded record may be future-dated.
 */
function pickServiceMinutes(rng: () => number, count: number, dayStartMs: number): number[] {
  const capMs = Math.min(SEED_NOW.getTime(), LAST_DAY_END_MS);
  const windows = SERVICE_WINDOWS.map((w) => ({ ...w }));

  const chosen: number[] = [];
  let guard = 0;
  while (chosen.length < count && guard < count * 20) {
    guard += 1;
    const w = weighted(rng, windows.map((x) => [x, x.weight] as const));
    const ms = istMinutesToMs(dayStartMs, randInt(rng, w.from, w.to));
    if (ms > capMs) continue;
    // Keep service windows from stacking identical minutes.
    if (chosen.some((existing) => Math.abs(existing - ms) < 60_000)) continue;
    chosen.push(ms);
  }
  if (chosen.length < count) {
    throw new Error(
      `Only ${chosen.length} of ${count} order slots fit on ${istDayKey(dayStartMs)} ` +
        `before ${SEED_NOW.toISOString()}.`
    );
  }
  return shuffle(rng, chosen).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

type ItemType = "FOOD" | "BEVERAGE" | "OTHER";

interface MenuLine {
  menuItemId: string;
  variantId: string | null;
  category: string;
  itemType: ItemType;
  priceRupees: number;
  quickServe: boolean;
  mainsOnly: boolean;
}

const MAINS_ONLY_CATEGORIES = new Set(["North Indian", "Paneer Specials", "Dal", "Curries"]);
const QUICK_SERVE_CATEGORIES = new Set(["Starters", "Soups", "Snacks", "Breads", "Desserts", "Chaat"]);

/**
 * Builds a plausible basket: a couple of dishes, a matching bread or rice, and
 * a drink. Dine-in baskets are larger. A low-probability extra line drawn from
 * the *whole* menu (biased towards the least-used items) guarantees that every
 * item on the menu gets realistic trading history instead of a handful of
 * best-sellers swallowing the whole history.
 */
function buildOrderLines(
  rng: () => number,
  lines: MenuLine[],
  orderType: OrderType,
  usage: Map<string, number>
): Array<{ menuItemId: string; variantId: string | null; quantity: number }> {
  const mains = lines.filter((l) => !l.quickServe && !l.mainsOnly);
  const mainsOnly = lines.filter((l) => l.mainsOnly);
  const breads = lines.filter((l) => l.category === "Breads");
  const desserts = lines.filter((l) => l.category === "Desserts");
  const quick = lines.filter((l) => l.quickServe && l.itemType !== "BEVERAGE");
  const drinks = lines.filter((l) => l.itemType === "BEVERAGE");

  const chosen = new Map<string, { menuItemId: string; variantId: string | null; quantity: number }>();
  const add = (line: MenuLine, quantity: number): void => {
    const key = `${line.menuItemId}:${line.variantId ?? ""}`;
    const existing = chosen.get(key);
    if (existing) {
      existing.quantity = Math.min(6, existing.quantity + quantity);
      return;
    }
    chosen.set(key, { menuItemId: line.menuItemId, variantId: line.variantId, quantity });
  };

  const drinkCount = weighted(rng, [[0, 8], [1, 34], [2, 38], [3, 15], [4, 5]]);

  if (orderType === "DINE_IN") {
    // A shared dish or two, breads to mop up, drinks for the table.
    const mainCount = weighted(rng, [[1, 8], [2, 42], [3, 34], [4, 16]]);
    for (let i = 0; i < mainCount; i += 1) {
      add(rng() < 0.45 ? pick(rng, mainsOnly) : pick(rng, mains), 1);
    }
    const breadCount = weighted(rng, [[0, 6], [1, 24], [2, 40], [3, 22], [4, 8]]);
    for (let i = 0; i < breadCount; i += 1) add(pick(rng, breads), randInt(rng, 1, 3));
    for (let i = 0; i < drinkCount; i += 1) add(pick(rng, drinks), randInt(rng, 1, 2));
    if (rng() < 0.45) add(pick(rng, quick), 1);
    if (rng() < 0.35) add(pick(rng, desserts), 1);
  } else {
    const mainCount = randInt(rng, 0, 2);
    for (let i = 0; i < mainCount; i += 1) {
      add(rng() < 0.35 ? pick(rng, mainsOnly) : pick(rng, mains), 1);
    }
    if (rng() < 0.7) add(pick(rng, breads), 1);
    for (let i = 0; i < Math.max(1, drinkCount); i += 1) add(pick(rng, drinks), 1);
    if (rng() < 0.4) add(pick(rng, quick), 1);
  }

  // Menu-coverage sweep: occasionally bolt on the least-traded line from the
  // whole menu so no item is left with a zero-order history.
  if (rng() < 0.25) {
    let best: MenuLine | null = null;
    let bestUsage = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 6; i += 1) {
      const candidate = pick(rng, lines);
      const used = usage.get(candidate.menuItemId) ?? 0;
      if (used < bestUsage) {
        best = candidate;
        bestUsage = used;
      }
    }
    if (best) add(best, 1);
  }

  return [...chosen.values()].map((l) => ({
    ...l,
    quantity: Math.max(1, Math.min(6, l.quantity)),
  }));
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

type Services = {
  orderService: typeof import("@/lib/orders/order-service");
  kotService: typeof import("@/lib/orders/kot-service");
  billService: typeof import("@/lib/billing/bill-service");
};

interface Staff {
  ownerId: string;
  managerId: string;
  cashierIds: string[];
  waiterIds: string[];
}

interface Snapshot {
  restaurantId: string;
  restaurant: Record<string, unknown>;
  categoryIds: string[];
  itemIds: string[];
  variantIds: string[];
  tableIds: string[];
  tableShape: Array<Record<string, unknown>>;
  userIds: string[];
  userShape: Array<Record<string, unknown>>;
  planFingerprint: string | null;
  subscriptionIds: string[];
  superAdmin: Record<string, unknown> | null;
  otherTenantCounts: Record<string, Record<string, number>>;
  beforeCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Snapshots / fingerprints
// ---------------------------------------------------------------------------

function fingerprintPlan(plan: Record<string, unknown>): string {
  return JSON.stringify({
    name: plan.name,
    pricePaise: plan.pricePaise,
    billingCycle: plan.billingCycle,
    durationDays: plan.durationDays,
    gracePeriodDays: plan.gracePeriodDays,
    isFree: plan.isFree,
    isActive: plan.isActive,
    serviceKeys: plan.serviceKeys,
    features: plan.features,
  });
}

function stripVolatile<T extends Record<string, unknown>>(doc: T, keys: string[]): Record<string, unknown> {
  const clone = { ...doc };
  for (const key of keys) delete clone[key];
  return clone;
}

async function readSnapshot(restaurantId: mongoose.Types.ObjectId): Promise<Snapshot> {
  const scope = { restaurantId };
  const [restaurant, categories, items, variants, tables, users, subs, plan, superAdmin] =
    await Promise.all([
      RestaurantModel.findById(restaurantId).lean(),
      MenuCategoryModel.find(scope).select("_id").sort({ _id: 1 }).lean(),
      MenuItemModel.find(scope).select("_id").sort({ _id: 1 }).lean(),
      MenuVariantModel.find(scope).select("_id").sort({ _id: 1 }).lean(),
      RestaurantTableModel.find(scope)
        .select("_id name capacity sectionId status isActive displayOrder")
        .sort({ _id: 1 })
        .lean(),
      UserModel.find(scope)
        .select("_id email role passwordHash isActive")
        .sort({ _id: 1 })
        .lean(),
      SubscriptionModel.find(scope).select("_id").sort({ _id: 1 }).lean(),
      PlanModel.findOne({ name: SILVER_PLAN_NAME }).lean(),
      UserModel.findOne({ email: SUPER_ADMIN_EMAIL }).lean(),
    ]);

  if (!restaurant) throw new Error("The demo restaurant disappeared mid-run.");
  if (!plan) throw new Error(`The "${SILVER_PLAN_NAME}" plan is missing; refusing to continue.`);

  // Counts for every OTHER restaurant, so "no other tenant was touched" is a
  // real before/after comparison rather than an assumption.
  const otherTenantCounts: Record<string, Record<string, number>> = {};
  const others = await RestaurantModel.find({ _id: { $ne: restaurantId } }).select("_id").lean();
  for (const other of others) {
    const filter = { restaurantId: other._id as mongoose.Types.ObjectId };
    otherTenantCounts[String(other._id)] = {
      orders: await OrderModel.countDocuments(filter),
      kots: await KotModel.countDocuments(filter),
      bills: await BillModel.countDocuments(filter),
      payments: await PaymentModel.countDocuments(filter),
    };
  }

  const beforeCounts = {
    orders: await OrderModel.countDocuments(scope),
    kots: await KotModel.countDocuments(scope),
    bills: await BillModel.countDocuments(scope),
    payments: await PaymentModel.countDocuments(scope),
  };

  return {
    restaurantId: String(restaurantId),
    restaurant: stripVolatile(restaurant as Record<string, unknown>, ["updatedAt"]),
    categoryIds: categories.map((c) => String(c._id)),
    itemIds: items.map((i) => String(i._id)),
    variantIds: variants.map((v) => String(v._id)),
    tableIds: tables.map((t) => String(t._id)),
    // `status` is excluded: it is a live occupancy flag, not configuration.
    tableShape: tables.map((t) => stripVolatile(t as Record<string, unknown>, ["status", "updatedAt"])),
    userIds: users.map((u) => String(u._id)),
    userShape: users.map((u) => stripVolatile(u as Record<string, unknown>, ["updatedAt"])),
    planFingerprint: fingerprintPlan(plan as Record<string, unknown>),
    subscriptionIds: subs.map((s) => String(s._id)),
    superAdmin: superAdmin
      ? stripVolatile(superAdmin as Record<string, unknown>, ["updatedAt", "__v"])
      : null,
    otherTenantCounts,
    beforeCounts,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "restopos";
  if (!uri) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }

  // Safety: refuse a production-looking target BEFORE connecting. The guard file
  // is untouched; ALLOW_DESTRUCTIVE_PRODUCTION_DB=true remains its documented
  // escape hatch for an intentional maintenance run.
  const decision = guardDestructiveScriptOrExit({
    operation: "seed",
    scriptName: "db:seed:demo:transactional",
  });

  await mongoose.connect(uri, { dbName, maxPoolSize: 5 });

  // Dynamic imports: these modules pull in db/index (which reads MONGODB_URI at
  // import time) and are server-only, so they must load after loadEnvConfig.
  const [orderService, kotService, billService] = await Promise.all([
    import("@/lib/orders/order-service"),
    import("@/lib/orders/kot-service"),
    import("@/lib/billing/bill-service"),
  ]);
  const services: Services = { orderService, kotService, billService };

  console.log(`Target database : ${dbName}`);
  console.log(`Host            : ${decision.host ?? "unknown"}`);
  console.log(`Now (seed time) : ${SEED_NOW.toISOString()}`);
  console.log(`Window          : ${START_DAY_ISO} -> ${END_DAY_ISO} (${DAY_COUNT} IST days)`);

  // ---- Resolve the tenant by GSTIN, never by name -------------------------
  const restaurant = await RestaurantModel.findOne({ gstin: DEMO_GSTIN }).lean();
  if (!restaurant) {
    throw new Error(
      `No restaurant with GSTIN ${DEMO_GSTIN} ("${DEMO_RESTAURANT_NAME}") exists. ` +
        "Nothing to reseed."
    );
  }
  const nameClash = await RestaurantModel.countDocuments({ name: DEMO_RESTAURANT_NAME });
  if (nameClash > 1) {
    throw new Error(
      `${nameClash} restaurants are named "${DEMO_RESTAURANT_NAME}". Refusing to guess; ` +
        "resolve the GSTIN first."
    );
  }
  const restaurantId = restaurant._id as mongoose.Types.ObjectId;
  const rid = String(restaurantId);

  const snapshot = await readSnapshot(restaurantId);

  console.log("\n================ BEFORE DELETION ================");
  console.log(`Restaurant        : ${DEMO_RESTAURANT_NAME}`);
  console.log(`Restaurant ID     : ${rid}`);
  console.log(`GSTIN             : ${restaurant.gstin}`);
  console.log("\nExisting transaction counts (will be deleted, scoped to this restaurantId):");
  console.log(`  Orders    : ${snapshot.beforeCounts.orders}`);
  console.log(`  KOTs      : ${snapshot.beforeCounts.kots}`);
  console.log(`  Bills     : ${snapshot.beforeCounts.bills}`);
  console.log(`  Payments  : ${snapshot.beforeCounts.payments}`);
  console.log("\nPreserved configuration (must be identical afterwards):");
  console.log(`  Menu categories : ${snapshot.categoryIds.length}`);
  console.log(`  Menu items      : ${snapshot.itemIds.length}`);
  console.log(`  Variants        : ${snapshot.variantIds.length}`);
  console.log(`  Tables          : ${snapshot.tableIds.length}`);
  console.log(`  Users           : ${snapshot.userIds.length}`);
  console.log(`  Subscriptions   : ${snapshot.subscriptionIds.length}`);
  console.log(`  Other tenants   : ${Object.keys(snapshot.otherTenantCounts).length}`);

  const tableStates = await RestaurantTableModel.find({ restaurantId }).select("name status").lean();
  const occupiedBefore = tableStates.filter((t) => t.status !== "AVAILABLE").length;
  if (occupiedBefore > 0) {
    console.log(
      `\n  note: ${occupiedBefore} table(s) are still flagged OCCUPIED. That is leftover ` +
        "state from a previous interrupted run, not configuration."
    );
  }

  // ---- Scoped deletion ---------------------------------------------------
  console.log("\n================ SCOPED DELETION ================");
  const scope = { restaurantId };
  const deletedOrders = await OrderModel.deleteMany(scope).exec();
  const deletedKots = await KotModel.deleteMany(scope).exec();
  const deletedBills = await BillModel.deleteMany(scope).exec();
  const deletedPayments = await PaymentModel.deleteMany(scope).exec();
  console.log(`  deleted orders   : ${deletedOrders.deletedCount ?? 0}`);
  console.log(`  deleted KOTs     : ${deletedKots.deletedCount ?? 0}`);
  console.log(`  deleted bills    : ${deletedBills.deletedCount ?? 0}`);
  console.log(`  deleted payments : ${deletedPayments.deletedCount ?? 0}`);

  // With no orders left, the app's own invariant is that a table can only be
  // OCCUPIED while an active order sits on it. Restoring that invariant is not
  // a configuration change: ids, names, capacities and sections are untouched.
  const restored = await RestaurantTableModel.updateMany(
    { restaurantId, status: { $ne: "AVAILABLE" } },
    { $set: { status: "AVAILABLE" } }
  ).exec();
  if ((restored.modifiedCount ?? 0) > 0) {
    console.log(`  tables returned to AVAILABLE (no active order remained): ${restored.modifiedCount}`);
  }

  console.log("\n================ AFTER DELETION ================");
  const afterDelete = {
    orders: await OrderModel.countDocuments(scope),
    kots: await KotModel.countDocuments(scope),
    bills: await BillModel.countDocuments(scope),
    payments: await PaymentModel.countDocuments(scope),
  };
  console.log(`  Orders    : ${afterDelete.orders}`);
  console.log(`  KOTs      : ${afterDelete.kots}`);
  console.log(`  Bills     : ${afterDelete.bills}`);
  console.log(`  Payments  : ${afterDelete.payments}`);
  if (Object.values(afterDelete).some((n) => n !== 0)) {
    throw new Error(`Scoped deletion left records behind: ${JSON.stringify(afterDelete)}`);
  }

  const postDelete = await readSnapshot(restaurantId);
  assertPreserved(snapshot, postDelete, "after deletion");

  // ---- Build the trading context -----------------------------------------
  const staffUsers = await UserModel.find({ restaurantId }).select("_id role").lean();
  const byRole = (role: string): string[] =>
    staffUsers.filter((u) => u.role === role).map((u) => String(u._id));
  const staff: Staff = {
    ownerId: byRole("OWNER")[0],
    managerId: byRole("MANAGER")[0],
    cashierIds: byRole("CASHIER"),
    waiterIds: byRole("WAITER"),
  };
  if (!staff.ownerId || !staff.managerId || staff.cashierIds.length === 0 || staff.waiterIds.length === 0) {
    throw new Error(
      `Staff roles incomplete: owner=${staff.ownerId ? "yes" : "no"} ` +
        `manager=${staff.managerId ? "yes" : "no"} ` +
        `cashiers=${staff.cashierIds.length} waiters=${staff.waiterIds.length}`
    );
  }

  const menuLines = await loadMenuLines(restaurantId);
  if (menuLines.length === 0) throw new Error("The demo restaurant has no sellable menu lines.");

  const tableDocs = await RestaurantTableModel.find({ restaurantId, isActive: true })
    .select("_id name")
    .lean();
  const freeTables = new Set(tableDocs.map((t) => String(t._id)));

  const missingCoverage = new Set(menuLines.map((l) => l.menuItemId));
  if (missingCoverage.size === 0) throw new Error("Menu coverage set is empty.");

  console.log("\n================ SEEDING ================");
  console.log(`  Staff     : 1 owner, 1 manager, ${staff.cashierIds.length} cashiers, ${staff.waiterIds.length} waiters`);
  console.log(`  Tables    : ${tableDocs.length}`);
  console.log(`  Menu lines: ${menuLines.length} (${missingCoverage.size} items)`);

  const rng = mulberry32(SEED);
  const restamper = new Restamper();
  const usage = new Map<string, number>();
  const startedAt = Date.now();
  const dayStats: Array<{ date: string; orders: number; revenue: number; weekday: string }> = [];

  for (let day = 0; day < DAY_COUNT; day += 1) {
    const dayStartMs = RANGE_START_MS + day * DAY_MS;
    const date = istDayKey(dayStartMs);
    const slots = pickServiceMinutes(rng, ORDERS_PER_DAY, dayStartMs);
    let dayOrders = 0;
    let dayRevenue = 0;

    for (const placedAtMs of slots) {
      const placedAt = new Date(placedAtMs);
      const isWeekend = [0, 5, 6].includes(new Date(dayStartMs + IST_OFFSET_MS).getUTCDay());

      // Weekends: bigger baskets and fuller dining room. Weekdays: more takeaway.
      const orderType = weighted<OrderType>(rng, isWeekend
        ? [["DINE_IN", 68], ["TAKEAWAY", 32]]
        : [["DINE_IN", 58], ["TAKEAWAY", 42]]);

      // Waiters ring dine-in tables; cashiers ring the counter. The same user
      // settles the bill, so `createdBy` / `receivedBy` are real tenant staff.
      const ringUser = orderType === "DINE_IN"
        ? weighted(rng, [
            [staff.waiterIds[0], 34],
            [staff.waiterIds[1 % staff.waiterIds.length], 34],
            [staff.managerId, 18],
            [staff.ownerId, 4],
            [staff.cashierIds[0], 10],
          ])
        : weighted(rng, [
            [staff.cashierIds[0], 45],
            [staff.cashierIds[1 % staff.cashierIds.length], 30],
            [staff.managerId, 20],
            [staff.ownerId, 5],
          ]);
      // The cashier takes the money at the till.
      const settleUser = weighted(rng, [
        [staff.cashierIds[0], 55],
        [staff.cashierIds[1 % staff.cashierIds.length], 30],
        [staff.managerId, 15],
      ]);

      const lines = buildOrderLines(rng, menuLines, orderType, usage);
      for (const line of lines) {
        usage.set(line.menuItemId, (usage.get(line.menuItemId) ?? 0) + line.quantity);
        missingCoverage.delete(line.menuItemId);
      }
      if (lines.length === 0) {
        throw new Error(`Build produced an empty basket for ${date}.`);
      }

      // One roll decides BOTH the discount type and its unit, otherwise a
      // PERCENTAGE discount can pick up a rupee amount (100% off) by accident.
      const orderInput: CreateOrderInput = {
        orderType,
        items: lines.map((l) => ({
          menuItemId: l.menuItemId,
          variantId: l.variantId ?? undefined,
          quantity: l.quantity,
        })),
      };
      if (orderType === "DINE_IN") {
        const tableId = claimTable(freeTables, rng, tableDocs);
        orderInput.tableId = tableId;
        orderInput.customerName = pick(rng, CUSTOMER_NAMES);
      } else {
        orderInput.customerName = pick(rng, CUSTOMER_NAMES);
        orderInput.customerPhone = `9${randInt(rng, 100000000, 999999999)}`;
      }

      let orderView;
      try {
        orderView = await services.orderService.createOrder(rid, ringUser, orderInput);
      } catch (error) {
        freeTables.add(String(orderInput.tableId ?? ""));
        throw new Error(
          `createOrder failed on ${date}: ${(error as Error).message}. ` +
            "Aborting instead of seeding a partial day."
        );
      }

      try {
        // A fixed rupee comp must never exceed the basket, or the bill collapses
        // to zero. The cap is computed in paise and handed over in rupees, which
        // is the unit the billing layer expects for a FIXED discount.
        const maxFixedRupees = Math.max(1, Math.floor((orderView.totalPaise * 0.15) / 100));
        const hasDiscount = rng() < 0.25;
        const discountInput = !hasDiscount
          ? undefined
          : rng() < 0.7
            ? {
                discountType: "PERCENTAGE" as const,
                discountValue: pick(rng, [5, 8, 10, 12]),
                discountReason: pick(rng, DISCOUNT_REASONS),
              }
            : {
                discountType: "FIXED" as const,
                discountValue: Math.min(pick(rng, [30, 50, 75, 100]), maxFixedRupees),
                discountReason: pick(rng, DISCOUNT_REASONS),
              };

        // Kitchen ticket for everything that goes on the pass.
        await services.orderService.sendOrderToKitchen(rid, orderView.id);
        const printed = await services.kotService.printPendingKot(rid, orderView.id, ringUser);
        if (printed.kot) {
          await services.kotService.markKotSent(rid, printed.kot.id);
          const kotAt = new Date(placedAtMs + randInt(rng, 2, 6) * 60_000);
          restamper.queue(KotModel, printed.kot.id, {
            createdAt: kotAt,
            updatedAt: kotAt,
            printedAt: kotAt,
          });
          restamper.queue(OrderModel, orderView.id, { sentToKitchenAt: kotAt });
        }

        const bill = await services.billService.generateBill(rid, orderView.id, ringUser, discountInput);
        if (bill.grandTotalPaise < 1) {
          throw new Error(
            `Bill ${bill.id} for order ${orderView.id} came out at zero paise; a discount ` +
              "cancelled the whole basket. Lower the fixed discounts."
          );
        }

        const billAt = new Date(placedAtMs + randInt(rng, orderType === "DINE_IN" ? 22 : 8, orderType === "DINE_IN" ? 52 : 18) * 60_000);
        const paidAt = new Date(billAt.getTime() + randInt(rng, 0, 4) * 60_000);

        const method = weighted(rng, PAYMENT_WEIGHTS);
        if (orderType === "DINE_IN" && rng() < 0.15) {
          const secondMethod = weighted(rng, PAYMENT_WEIGHTS);
          const firstPart = Math.round(bill.grandTotalPaise * (0.35 + rng() * 0.35));
          await services.billService.recordPayment(rid, bill.id, settleUser, {
            method,
            amountPaise: firstPart,
            referenceNumber: paymentReference(rng, method),
          });
          await services.billService.completePayment(rid, bill.id, settleUser, {
            method: secondMethod,
            referenceNumber: paymentReference(rng, secondMethod),
          });
          const parts = await PaymentModel.find({ billId: bill.id })
            .select("_id")
            .sort({ createdAt: 1, _id: 1 })
            .lean();
          restamper.queue(PaymentModel, String(parts[0]._id), { createdAt: billAt, updatedAt: billAt });
          if (parts[1]) {
            restamper.queue(PaymentModel, String(parts[1]._id), { createdAt: paidAt, updatedAt: paidAt });
          }
        } else {
          await services.billService.completePayment(rid, bill.id, settleUser, {
            method,
            referenceNumber: paymentReference(rng, method),
          });
          const payment = await PaymentModel.findOne({ billId: bill.id }).select("_id").lean();
          if (payment) {
            restamper.queue(PaymentModel, String(payment._id), { createdAt: paidAt, updatedAt: paidAt });
          }
        }

        // `recordPayment` already moved the order to PAID and released the
        // table, so this order is settled the moment control returns here.
        dayOrders += 1;
        dayRevenue += bill.grandTotalPaise;
        restamper.queue(OrderModel, orderView.id, { createdAt: placedAt, updatedAt: paidAt, paidAt });
        restamper.queue(BillModel, bill.id, { createdAt: billAt, updatedAt: paidAt, paidAt });
      } finally {
        if (orderInput.tableId) freeTables.add(String(orderInput.tableId));
      }

      if (restamper.pending >= 3000) await restamper.flush();
    }

    await restamper.flush();
    if (dayOrders !== ORDERS_PER_DAY) {
      throw new Error(`${date} produced ${dayOrders} orders, expected ${ORDERS_PER_DAY}.`);
    }
    dayStats.push({ date, orders: dayOrders, revenue: dayRevenue, weekday: dayName(dayStartMs) });
    console.log(
      `  ${date} (${dayName(dayStartMs)}) ${String(dayOrders).padStart(2)} orders  ${inr(dayRevenue)}`
    );
  }

  await restamper.flush();
  console.log(`\nSeeded in ${Math.round((Date.now() - startedAt) / 1000)}s.`);

  if (missingCoverage.size > 0) {
    throw new Error(
      `${missingCoverage.size} menu item(s) received no orders: ${[...missingCoverage].join(", ")}`
    );
  }

  await verify(snapshot);

  await mongoose.disconnect();
  console.log("\nDone.");
}

// ---------------------------------------------------------------------------
// Helpers used by the seeding loop
// ---------------------------------------------------------------------------

async function loadMenuLines(restaurantId: mongoose.Types.ObjectId): Promise<MenuLine[]> {
  const categories = await MenuCategoryModel.find({ restaurantId }).select("_id name").lean();
  const categoryName = new Map(categories.map((c) => [String(c._id), String(c.name)]));
  const items = await MenuItemModel.find({ restaurantId, isActive: true, isAvailable: true })
    .select("_id categoryId itemType hasVariants basePrice")
    .lean();
  const variants = await MenuVariantModel.find({ restaurantId, isActive: true })
    .select("_id menuItemId price")
    .lean();

  const byItem = new Map<string, Array<{ _id: mongoose.Types.ObjectId; price: number }>>();
  for (const v of variants) {
    const key = String(v.menuItemId);
    const list = byItem.get(key) ?? [];
    list.push({ _id: v._id as mongoose.Types.ObjectId, price: v.price });
    byItem.set(key, list);
  }

  const lines: MenuLine[] = [];
  for (const item of items) {
    const category = categoryName.get(String(item.categoryId)) ?? "";
    const itemType = (item.itemType ?? "FOOD") as ItemType;
    const quickServe = itemType === "BEVERAGE" || QUICK_SERVE_CATEGORIES.has(category);
    const mainsOnly = itemType === "FOOD" && MAINS_ONLY_CATEGORIES.has(category);
    const itemVariants = byItem.get(String(item._id)) ?? [];

    if (item.hasVariants && itemVariants.length > 0) {
      for (const v of itemVariants) {
        lines.push({
          menuItemId: String(item._id),
          variantId: String(v._id),
          category,
          itemType,
          priceRupees: v.price / 100,
          quickServe: category === "Breads" ? false : quickServe,
          mainsOnly,
        });
      }
    } else if (!item.hasVariants && typeof item.basePrice === "number") {
      lines.push({
        menuItemId: String(item._id),
        variantId: null,
        category,
        itemType,
        priceRupees: item.basePrice / 100,
        quickServe,
        mainsOnly,
      });
    }
  }
  return lines;
}

function claimTable(
  freeTables: Set<string>,
  rng: () => number,
  tableDocs: Array<{ _id: mongoose.Types.ObjectId }>
): string {
  if (freeTables.size === 0) {
    throw new Error(
      `No free table left among ${tableDocs.length}. Every order must settle before the ` +
        "next one is seated; a stuck order means the billing path failed."
    );
  }
  const tableId = pick(rng, [...freeTables]);
  freeTables.delete(tableId);
  return tableId;
}

function assertPreserved(before: Snapshot, after: Snapshot, stage: string): void {
  const problems: string[] = [];
  const same = (label: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(label);
  };

  same("restaurant record", before.restaurant, after.restaurant);
  same("menu category ids", before.categoryIds, after.categoryIds);
  same("menu item ids", before.itemIds, after.itemIds);
  same("menu variant ids", before.variantIds, after.variantIds);
  same("table ids/shape", before.tableIds.map((id, i) => [id, before.tableShape[i]]),
    after.tableIds.map((id, i) => [id, after.tableShape[i]]));
  same("user ids/passwords", before.userShape, after.userShape);
  same("subscription ids", before.subscriptionIds, after.subscriptionIds);
  same("silver plan", before.planFingerprint, after.planFingerprint);
  same("super admin", before.superAdmin, after.superAdmin);
  same("other tenants", before.otherTenantCounts, after.otherTenantCounts);

  if (problems.length > 0) {
    throw new Error(`Preserved records changed ${stage}: ${problems.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Verification (every number below is re-read from MongoDB)
// ---------------------------------------------------------------------------

async function verify(before: Snapshot): Promise<void> {
  const restaurantId = new mongoose.Types.ObjectId(before.restaurantId);
  const scope = { restaurantId };
  const errors: string[] = [];
  const check = (label: string, ok: boolean, detail: string): void => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${detail}`);
    if (!ok) errors.push(label);
  };

  console.log("\n================ FINAL COUNTS ================");
  const orders = await OrderModel.countDocuments(scope);
  const kots = await KotModel.countDocuments(scope);
  const bills = await BillModel.countDocuments(scope);
  const payments = await PaymentModel.countDocuments(scope);
  const categories = await MenuCategoryModel.countDocuments(scope);
  const items = await MenuItemModel.countDocuments(scope);
  const tables = await RestaurantTableModel.countDocuments(scope);
  const users = await UserModel.countDocuments(scope);
  const subs = await SubscriptionModel.countDocuments(scope);
  console.log(`  Restaurant        : 1 (${DEMO_RESTAURANT_NAME})`);
  console.log(`  Menu categories   : ${categories}`);
  console.log(`  Menu items        : ${items}`);
  console.log(`  Tables            : ${tables}`);
  console.log(`  Users             : ${users}`);
  console.log(`  Orders            : ${orders}`);
  console.log(`  KOTs              : ${kots}`);
  console.log(`  Bills             : ${bills}`);
  console.log(`  Payments          : ${payments}`);
  console.log(`  Subscriptions     : ${subs}`);
  console.log(`  Plan              : ${SILVER_PLAN_NAME}`);

  const expectedOrders = ORDERS_PER_DAY * DAY_COUNT;
  const expectedBills = expectedOrders;
  const expectedPayments = expectedOrders; // at least one per bill
  const expectedKots = expectedOrders; // every order goes on the pass

  console.log("\n================ DAILY ORDER VERIFICATION ================");
  console.log("  Date       | Day | Order Count | Revenue");
  console.log("  -----------|-----|-------------|----------");
  const daily = await OrderModel.aggregate([
    { $match: scope },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: "+05:30",
          },
        },
        orders: { $sum: 1 },
        revenue: { $sum: "$totalPaise" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const dailyMap = new Map<string, { orders: number; revenue: number }>();
  for (const row of daily) {
    dailyMap.set(String(row._id), { orders: row.orders, revenue: row.revenue });
  }

  let dayMismatch = 0;
  let grandOrders = 0;
  let grandOrderTotal = 0;
  for (let day = 0; day < DAY_COUNT; day += 1) {
    const ms = RANGE_START_MS + day * DAY_MS;
    const date = istDayKey(ms);
    const row = dailyMap.get(date);
    const count = row?.orders ?? 0;
    // Revenue here is the sum of order totals; the authoritative money figure
    // is the paid bill total, reported in the monthly block below.
    const revenue = row?.revenue ?? 0;
    grandOrders += count;
    grandOrderTotal += revenue;
    if (count !== ORDERS_PER_DAY) dayMismatch += 1;
    console.log(
      `  ${date} | ${dayName(ms)} | ${String(count).padStart(11)} | ${inr(revenue).padStart(12)}`
    );
  }
  console.log(`  ${"TOTAL".padEnd(10)} |     | ${String(grandOrders).padStart(11)} | ${inr(grandOrderTotal).padStart(12)}`);

  // Weekly sales, from paid bills so the figure is the money actually collected.
  const weekly = await BillModel.aggregate([
    { $match: { ...scope, status: "PAID" } },
    {
      $group: {
        _id: {
          $dateToString: { format: "%G-W%V", date: "$createdAt", timezone: "+05:30" },
        },
        orders: { $sum: 1 },
        revenue: { $sum: "$grandTotalPaise" },
        tax: { $sum: "$totalTaxPaise" },
        discount: { $sum: "$discountPaise" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  console.log("\n  Weekly sales:");
  for (const w of weekly) {
    console.log(
      `    ${w._id}  orders ${String(w.orders).padStart(4)}  revenue ${inr(w.revenue)}  ` +
        `tax ${inr(w.tax)}  discount ${inr(w.discount)}`
    );
  }

  // Monthly revenue from PAID bills (the money actually collected).
  const monthly = await BillModel.aggregate([
    { $match: { ...scope, status: "PAID" } },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "+05:30" },
        },
        orders: { $sum: 1 },
        revenue: { $sum: "$grandTotalPaise" },
        tax: { $sum: "$totalTaxPaise" },
        discount: { $sum: "$discountPaise" },
        serviceCharge: { $sum: "$serviceChargeAmountPaise" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  console.log("\n================ MONTHLY REVENUE (paid bills) ================");
  let totalRevenue = 0;
  let totalTax = 0;
  let totalDiscount = 0;
  for (const m of monthly) {
    totalRevenue += m.revenue;
    totalTax += m.tax;
    totalDiscount += m.discount;
    console.log(
      `  ${m._id}: orders ${m.orders}  revenue ${inr(m.revenue)}  tax ${inr(m.tax)}  ` +
        `discount ${inr(m.discount)}  serviceCharge ${inr(m.serviceCharge)}`
    );
  }
  console.log(`  Total: revenue ${inr(totalRevenue)}  tax ${inr(totalTax)}  discount ${inr(totalDiscount)}`);
  const paidBillCount = monthly.reduce((sum, m) => sum + m.orders, 0);
  console.log(
    `  Average order value: ${inr(paidBillCount > 0 ? Math.round(totalRevenue / paidBillCount) : 0)} ` +
      `across ${paidBillCount} paid bills`
  );
  console.log(
    `  Daily average: ${inr(Math.round(totalRevenue / DAY_COUNT))} revenue, ` +
      `${(paidBillCount / DAY_COUNT).toFixed(1)} orders/day over ${DAY_COUNT} days`
  );

  const byMethod = await PaymentModel.aggregate([
    { $match: scope },
    { $group: { _id: "$method", count: { $sum: 1 }, amount: { $sum: "$amountPaise" } } },
    { $sort: { amount: -1 } },
  ]);
  console.log("\n  Payment method breakdown:");
  for (const m of byMethod) {
    console.log(`    ${String(m._id).padEnd(6)} ${String(m.count).padStart(5)} payments  ${inr(m.amount)}`);
  }

  // Bill lines snapshot the item name but not the category, so the category
  // roll-up joins the live menu purely for labelling the report. Sales money
  // still comes from the immutable bill line totals.
  const byCategory = await BillModel.aggregate([
    { $match: { ...scope, status: "PAID" } },
    { $unwind: "$items" },
    {
      $lookup: {
        from: MenuItemModel.collection.name,
        localField: "items.menuItemId",
        foreignField: "_id",
        as: "menuItem",
      },
    },
    { $unwind: { path: "$menuItem", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: MenuCategoryModel.collection.name,
        localField: "menuItem.categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$category.name",
        amount: { $sum: "$items.lineTotalPaise" },
        qty: { $sum: "$items.quantity" },
      },
    },
    { $sort: { amount: -1 } },
  ]);
  console.log("\n  Category-wise sales:");
  for (const c of byCategory) {
    console.log(`    ${String(c._id ?? "(uncategorised)").padEnd(18)} qty ${String(c.qty).padStart(5)}  ${inr(c.amount)}`);
  }

  const topItems = await BillModel.aggregate([
    { $match: { ...scope, status: "PAID" } },
    { $unwind: "$items" },
    { $group: { _id: "$items.nameSnapshot", qty: { $sum: "$items.quantity" }, amount: { $sum: "$items.lineTotalPaise" } } },
    { $sort: { qty: -1 } },
    { $limit: 10 },
  ]);
  console.log("\n  Best-selling items:");
  for (const t of topItems) {
    console.log(`    ${String(t._id ?? "(unknown)").padEnd(28)} qty ${String(t.qty).padStart(5)}  ${inr(t.amount)}`);
  }

  const byTable = await OrderModel.aggregate([
    { $match: { ...scope, orderType: "DINE_IN" } },
    { $group: { _id: "$tableId", orders: { $sum: 1 }, revenue: { $sum: "$totalPaise" } } },
    { $sort: { revenue: -1 } },
  ]);
  console.log("\n  Table activity:");
  for (const t of byTable) {
    console.log(`    table ${String(t._id)}  ${String(t.orders).padStart(4)} orders  ${inr(t.revenue)}`);
  }

  const kotStatus = await KotModel.aggregate([
    { $match: scope },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  console.log("\n  KOT activity:");
  for (const k of kotStatus) {
    console.log(`    ${String(k._id).padEnd(10)} ${k.count}`);
  }

  // ---- Integrity checks ---------------------------------------------------
  console.log("\n================ INTEGRITY CHECKS ================");

  const otherTenants = Object.keys(before.otherTenantCounts);
  const foreignOrders = await OrderModel.countDocuments({ restaurantId: { $ne: restaurantId } });
  check("1. every order belongs to Demo Spice Kitchen", foreignOrders === 0, `${orders} scoped, ${foreignOrders} foreign`);

  const orderIds = new Set((await OrderModel.find(scope).select("_id").lean()).map((d) => String(d._id)));
  const billDocs = await BillModel.find(scope).select("_id orderId tableId").lean();
  const orphanBills = billDocs.filter((b) => !orderIds.has(String(b.orderId))).length;
  check("2. every bill references a valid order", orphanBills === 0, `${orphanBills} orphans`);

  const kotDocs = await KotModel.find(scope).select("_id orderId").lean();
  const orphanKots = kotDocs.filter((k) => !orderIds.has(String(k.orderId))).length;
  check("3. every KOT references a valid order", orphanKots === 0, `${orphanKots} orphans`);

  const billIdSet = new Set(billDocs.map((b) => String(b._id)));
  const paymentDocs = await PaymentModel.find(scope).select("_id billId orderId amountPaise").lean();
  const orphanPayments = paymentDocs.filter(
    (p) => !billIdSet.has(String(p.billId)) || !orderIds.has(String(p.orderId))
  ).length;
  check("4. every payment references a valid bill+order", orphanPayments === 0, `${orphanPayments} orphans`);
  check("5. no orphan transactional records", orphanBills + orphanKots + orphanPayments === 0, "0");

  const negative = await BillModel.countDocuments({
    ...scope,
    $or: [
      { subtotalPaise: { $lt: 0 } },
      { discountPaise: { $lt: 0 } },
      { totalTaxPaise: { $lt: 0 } },
      { serviceChargeAmountPaise: { $lt: 0 } },
      { grandTotalPaise: { $lt: 0 } },
      { paidAmountPaise: { $lt: 0 } },
    ],
  });
  check("6. no negative totals", negative === 0, `${negative}`);

  const nowMs = Date.now();
  const futureOrders = await OrderModel.countDocuments({ ...scope, createdAt: { $gt: new Date(nowMs) } });
  const futureBills = await BillModel.countDocuments({ ...scope, createdAt: { $gt: new Date(nowMs) } });
  const futurePayments = await PaymentModel.countDocuments({ ...scope, createdAt: { $gt: new Date(nowMs) } });
  const futureKots = await KotModel.countDocuments({ ...scope, createdAt: { $gt: new Date(nowMs) } });
  check(
    "7. no future-dated records",
    futureOrders + futureBills + futurePayments + futureKots === 0,
    `${futureOrders + futureBills + futurePayments + futureKots}`
  );

  // subtotal - discount = taxable; taxable + tax + serviceCharge + roundOff = grand
  const mathRows = await BillModel.find(scope)
    .select("subtotalPaise discountPaise taxableAmountPaise totalTaxPaise cgstAmountPaise sgstAmountPaise igstAmountPaise serviceChargeAmountPaise roundOffAmountPaise grandTotalPaise")
    .lean();
  let mathBad = 0;
  let breakdownBad = 0;
  for (const b of mathRows) {
    if (b.subtotalPaise - b.discountPaise !== b.taxableAmountPaise) mathBad += 1;
    const sum =
      b.taxableAmountPaise + b.totalTaxPaise + b.serviceChargeAmountPaise + b.roundOffAmountPaise;
    if (sum !== b.grandTotalPaise) mathBad += 1;
    if (b.cgstAmountPaise + b.sgstAmountPaise + b.igstAmountPaise !== b.totalTaxPaise) breakdownBad += 1;
  }
  check("8. bill arithmetic is correct", mathBad === 0, `${mathBad} wrong of ${mathRows.length}`);
  check("8b. CGST+SGST+IGST == total tax", breakdownBad === 0, `${breakdownBad} wrong`);

  const paidByBill = new Map<string, number>();
  for (const p of paymentDocs) {
    const key = String(p.billId);
    paidByBill.set(key, (paidByBill.get(key) ?? 0) + p.amountPaise);
  }
  const settleRows = await BillModel.find(scope)
    .select("_id grandTotalPaise paidAmountPaise dueAmountPaise status")
    .lean();
  let settleBad = 0;
  let unpaidBills = 0;
  for (const b of settleRows) {
    const sum = paidByBill.get(String(b._id)) ?? 0;
    if (sum !== b.grandTotalPaise || b.paidAmountPaise !== b.grandTotalPaise || b.dueAmountPaise !== 0) {
      settleBad += 1;
    }
    if (b.status !== "PAID") unpaidBills += 1;
  }
  check("9. payment total == bill grand total", settleBad === 0, `${settleBad} unsettled of ${settleRows.length}`);
  check("9b. every bill is PAID", unpaidBills === 0, `${unpaidBills} not paid`);

  const menuItemIds = new Set(before.itemIds);
  const orderedItemIds = new Set(
    (
      await OrderModel.aggregate([
        { $match: scope },
        { $unwind: "$items" },
        { $group: { _id: "$items.menuItemId" } },
      ])
    ).map((r) => String(r._id))
  );
  const badItems = [...orderedItemIds].filter((id) => !menuItemIds.has(id));
  const unusedItems = [...menuItemIds].filter((id) => !orderedItemIds.has(id));
  check("10. all order items are real menu items", badItems.length === 0, `${badItems.length} unknown`);
  check("10b. every menu item was ordered", unusedItems.length === 0, `${unusedItems.length} unused`);

  const userIds = new Set(before.userIds);
  const referencedUsers = new Set<string>();
  for (const doc of await OrderModel.find(scope).select("createdBy").lean()) {
    referencedUsers.add(String(doc.createdBy));
  }
  for (const doc of await BillModel.find(scope).select("createdBy cancelledBy").lean()) {
    if (doc.createdBy) referencedUsers.add(String(doc.createdBy));
  }
  for (const doc of await PaymentModel.find(scope).select("receivedBy").lean()) {
    if (doc.receivedBy) referencedUsers.add(String(doc.receivedBy));
  }
  const foreignUsers = [...referencedUsers].filter((id) => !userIds.has(id));
  check("11. all referenced users are demo staff", foreignUsers.length === 0, `${foreignUsers.length} foreign`);

  const tableIds = new Set(before.tableIds);
  const referencedTables = new Set(
    (
      await OrderModel.find(scope).select("tableId").lean()
    )
      .map((d) => (d.tableId ? String(d.tableId) : ""))
      .filter(Boolean)
  );
  const foreignTables = [...referencedTables].filter((id) => !tableIds.has(id));
  check("12. all referenced tables are demo tables", foreignTables.length === 0, `${foreignTables.length} foreign`);

  const after = await readSnapshot(restaurantId);
  const otherCountsSame =
    otherTenants.length === 0 ||
    (otherTenants.length === Object.keys(after.otherTenantCounts).length &&
      otherTenants.every((id) => JSON.stringify(before.otherTenantCounts[id]) === JSON.stringify(after.otherTenantCounts[id])));
  check("13. no other restaurant's data deleted", otherCountsSame, `${otherTenants.length} other tenant(s) unchanged`);
  check("14. restaurant id unchanged", after.restaurantId === before.restaurantId, after.restaurantId);
  check("15. menu unchanged", after.itemIds.length === before.itemIds.length && after.categoryIds.length === before.categoryIds.length,
    `items ${after.itemIds.length}/${before.itemIds.length}, categories ${after.categoryIds.length}/${before.categoryIds.length}`);
  check("16. tables unchanged", after.tableIds.length === before.tableIds.length, `${after.tableIds.length}/${before.tableIds.length}`);
  check("17. users unchanged (ids+passwords)", after.userShape.length === before.userShape.length, `${after.userShape.length}/${before.userShape.length}`);

  const subscription = await SubscriptionModel.findOne({ restaurantId, status: "ACTIVE" }).lean();
  check("18. Silver subscription active", subscription !== null, subscription ? String(subscription._id) : "missing");

  const planNow = await PlanModel.findOne({ name: SILVER_PLAN_NAME }).lean();
  check(
    "19. Silver plan unchanged",
    planNow !== null && fingerprintPlan(planNow as Record<string, unknown>) === before.planFingerprint,
    planNow ? inr(planNow.pricePaise as number) : "missing"
  );
  check(
    "20. SUPER_ADMIN untouched",
    JSON.stringify(after.superAdmin) === JSON.stringify(before.superAdmin),
    before.superAdmin ? String((before.superAdmin as { email: string }).email) : "not present"
  );

  // Full preserved-record comparison (ids, passwords, plan, super admin, other tenants).
  try {
    assertPreserved(before, after, "after seeding");
    console.log("  PASS  preserved-record fingerprint comparison   identical");
  } catch (error) {
    console.log(`  FAIL  preserved-record fingerprint comparison   ${(error as Error).message}`);
    errors.push("preserved fingerprint");
  }

  console.log("\n  Volume expectations:");
  check("orders == 50 x days", orders === expectedOrders, `${orders}/${expectedOrders}`);
  check("bills == orders", bills === expectedBills, `${bills}/${expectedBills}`);
  check("payments >= bills", payments >= expectedPayments, `${payments}/${expectedPayments}`);
  check("KOTs == orders", kots === expectedKots, `${kots}/${expectedKots}`);
  check("every day has exactly 50 orders", dayMismatch === 0, `${dayMismatch} day(s) off`);

  const activeLeftovers = await OrderModel.countDocuments({
    ...scope,
    status: { $in: ["OPEN", "HELD", "KOT_SENT", "PREPARING", "READY", "SERVED"] },
  });
  check("no orders left active/open", activeLeftovers === 0, `${activeLeftovers}`);
  const occupiedTables = await RestaurantTableModel.countDocuments({
    restaurantId,
    status: { $ne: "AVAILABLE" },
  });
  check("no tables left occupied", occupiedTables === 0, `${occupiedTables}`);

  console.log("\n================ SUBSCRIPTION ================");
  const sub = await SubscriptionModel.findOne({ restaurantId }).lean();
  console.log(`  Plan         : ${sub?.planName ?? SILVER_PLAN_NAME}`);
  console.log(`  Subscription : ${String(sub?._id)} (${sub?.status})`);
  console.log(`  Restaurant   : ${DEMO_RESTAURANT_NAME}`);
  console.log(`  Access       : ${sub?.status === "ACTIVE" ? "allowed = true" : "allowed = false"}`);

  console.log("\n================ SUPER_ADMIN ================");
  const sa = await UserModel.findOne({ email: SUPER_ADMIN_EMAIL }).lean();
  console.log(`  Email        : ${sa?.email}`);
  console.log(`  Role         : ${sa?.role}`);
  console.log(`  RestaurantId : ${sa?.restaurantId ?? "(none)"}`);
  console.log(`  Untouched    : ${JSON.stringify(after.superAdmin) === JSON.stringify(before.superAdmin) ? "yes" : "NO"}`);

  if (errors.length > 0) {
    throw new Error(`${errors.length} integrity check(s) failed: ${errors.join("; ")}`);
  }
  console.log("\nAll integrity checks passed.");
}

main().catch(async (error) => {
  console.error("\nSeed failed:", error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
