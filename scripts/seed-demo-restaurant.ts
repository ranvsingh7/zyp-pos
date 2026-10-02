//
// Deterministic 3-month demo restaurant seed for demo / production-like targets.
//
// Usage:
//   npm run db:seed:demo:restaurant          # create if missing, otherwise skip
//   npm run db:seed:demo:restaurant:reset    # wipe ONLY this demo tenant, then reseed
//
// Creates the demo tenant "Demo Spice Kitchen" (Jodhpur, Rajasthan):
//   - 6 staff users (owner / manager / 2 cashiers / 2 waiters)
//   - 11 menu categories + 55 items, Half/Full and size variants, per-item GST
//   - 3 floor sections + 12 tables
//   - 2026-07-01 .. 2026-10-01 of POS history (orders -> KOTs -> bills ->
//     payments) generated with a seeded PRNG so every run is reproducible
//   - one ACTIVE subscription on the EXISTING Silver plan (never created here)
//
// Every record is written through the production service layer (restaurant,
// category, item, section, table, order, KOT, bill, subscription services) so
// numbering, tax, discount and entitlement snapshots come from the same code the
// app runs. Only `createdAt`/`updatedAt` are backdated afterwards, in bulk, to
// the simulated trading time.
//
// Tenant isolation: `--reset` deletes exclusively the records reachable from this
// script's demo restaurant id and the demo email allow-list. It never touches a
// Super Admin, a plan, or any other tenant.
//
// Passwords: read from DEMO_SEED_PASSWORD. Never hardcoded, never printed.
//

import { loadEnvConfig } from "@next/env";
import { guardDestructiveScriptOrExit } from "./lib/production-db-guard";
import mongoose from "mongoose";
import argon2 from "argon2";

import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { TableSectionModel } from "@/models/TableSection";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { OrderModel } from "@/models/Order";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { KotModel } from "@/models/KitchenOrderTicket";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { SubscriptionPaymentModel } from "@/models/SubscriptionPayment";

import type { OrderType } from "@/lib/orders/constants";
import type { CreateOrderInput } from "@/lib/orders/validation";
import type { BillPaymentMethod } from "@/lib/billing/constants";

// ---------------------------------------------------------------------------
// Demo identity + calendar
// ---------------------------------------------------------------------------

const DEMO_RESTAURANT_NAME = "Demo Spice Kitchen";
/** Stable, demo-only tenant markers used for idempotency and for cleanup. */
const DEMO_GSTIN = "08AAACD1234F1Z9";
const DEMO_OWNER_EMAIL = "demo-owner@zyp-pos.local";
const DEMO_MANAGER_EMAIL = "demo-manager@zyp-pos.local";
const DEMO_CASHIER_EMAIL = "demo-cashier@zyp-pos.local";
const DEMO_CASHIER2_EMAIL = "demo-cashier2@zyp-pos.local";
const DEMO_WAITER_EMAIL = "demo-waiter@zyp-pos.local";
const DEMO_WAITER2_EMAIL = "demo-waiter2@zyp-pos.local";
/** Every user this script may ever create or delete. */
const DEMO_EMAILS = [
  DEMO_OWNER_EMAIL,
  DEMO_MANAGER_EMAIL,
  DEMO_CASHIER_EMAIL,
  DEMO_CASHIER2_EMAIL,
  DEMO_WAITER_EMAIL,
  DEMO_WAITER2_EMAIL,
] as const;

/** The Silver plan is looked up, never created or edited by this script. */
const SILVER_PLAN_NAME = "Silver";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 3600 + 30 * 60) * 1000;
const SEED = 20260701;

/** Trading window, inclusive of both endpoints, in IST. */
const START_DAY_ISO = "2026-07-01";
const END_DAY_ISO = "2026-10-01";

/** Every seeded timestamp is capped here: nothing future-dated is ever written. */
const SEED_NOW = new Date();

function istMidnightUtc(isoDay: string): number {
  const [y, m, d] = isoDay.split("-").map(Number);
  // IST midnight expressed in UTC.
  return Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS;
}

const RANGE_START_MS = istMidnightUtc(START_DAY_ISO);
const RANGE_END_MS = istMidnightUtc(END_DAY_ISO);
const DAY_COUNT = Math.round((RANGE_END_MS - RANGE_START_MS) / DAY_MS) + 1;

/** IST wall-clock minutes -> ms offset from that day's IST midnight. */
function istMinutesToMs(dayStartMs: number, minutes: number): number {
  return dayStartMs + minutes * 60_000;
}

/** Trading windows in IST minutes-from-midnight, with a relative volume weight. */
const SERVICE_WINDOWS = [
  // Morning beverages / early chai: a real but small trickle.
  { from: 8 * 60, to: 11 * 60, weight: 7 },
  // Lunch service.
  { from: 12 * 60, to: 15 * 60 + 30, weight: 34 },
  // Afternoon lull (chai + snacks, plus the odd takeaway).
  { from: 15 * 60 + 30, to: 19 * 60, weight: 14 },
  // Dinner peak.
  { from: 19 * 60, to: 23 * 60, weight: 45 },
] as const;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
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

/** In-place Fisher-Yates. */
function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Menu spec — 11 categories, 55 items, per-item GST overrides
// ---------------------------------------------------------------------------

type MenuSizeUnit = "ML" | "L" | "GM" | "KG" | "PCS";
type ItemType = "FOOD" | "BEVERAGE" | "OTHER";
type VegType = "VEG" | "NON_VEG" | "EGG" | "NA";

interface VariantSpec {
  displayName: string;
  priceRupees: number;
  sizeValue?: number | null;
  sizeUnit?: MenuSizeUnit | null;
}

interface ItemSpec {
  name: string;
  vegType: VegType;
  itemType: ItemType;
  /** GST percent for this item, written as its tax override. */
  taxRatePercent: number;
  hsnSacCode?: string;
  basePriceRupees?: number;
  variants?: VariantSpec[];
}

interface CategorySpec {
  name: string;
  description: string;
  items: ItemSpec[];
}

/** Restaurant food at 5%, Chinese/prepared at 12%, packaged goods at 18%. */
const FOOD_TAX = 5;
const PREPARED_TAX = 12;
const PACKAGED_TAX = 18;

const MENU_SPEC: CategorySpec[] = [
  {
    name: "Starters",
    description: "Shareable plates to open the meal",
    items: [
      { name: "Paneer Tikka", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99631110", variants: [{ displayName: "Half", priceRupees: 150 }, { displayName: "Full", priceRupees: 270 }] },
      { name: "Veg Manchurian Dry", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99631110", variants: [{ displayName: "Half", priceRupees: 155 }, { displayName: "Full", priceRupees: 280 }] },
      { name: "Chilli Chicken Dry", vegType: "NON_VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99631110", basePriceRupees: 265 },
      { name: "Crispy Corn", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99631110", basePriceRupees: 240 },
      { name: "Hara Bhara Kebab", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99631110", basePriceRupees: 220 },
    ],
  },
  {
    name: "Soups",
    description: "Light bowls to begin",
    items: [
      { name: "Tomato Soup", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634010", basePriceRupees: 130 },
      { name: "Sweet Corn Veg Soup", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634010", basePriceRupees: 140 },
      { name: "Hot & Sour Soup", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634010", basePriceRupees: 150 },
      { name: "Manchow Soup", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634010", basePriceRupees: 145 },
    ],
  },
  {
    name: "North Indian",
    description: "Classic gravies from the clay oven",
    items: [
      { name: "Mix Veg", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", variants: [{ displayName: "Half", priceRupees: 195 }, { displayName: "Full", priceRupees: 340 }] },
      { name: "Kadhai Veg", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", basePriceRupees: 255 },
      { name: "Mushroom Masala", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", basePriceRupees: 270 },
      { name: "Butter Chicken", vegType: "NON_VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633110", variants: [{ displayName: "Half", priceRupees: 260 }, { displayName: "Full", priceRupees: 460 }] },
      { name: "Chicken Curry", vegType: "NON_VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633110", variants: [{ displayName: "Half", priceRupees: 230 }, { displayName: "Full", priceRupees: 400 }] },
    ],
  },
  {
    name: "Paneer Specials",
    description: "House paneer signatures",
    items: [
      { name: "Paneer Butter Masala", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", variants: [{ displayName: "Half", priceRupees: 225 }, { displayName: "Full", priceRupees: 395 }] },
      { name: "Shahi Paneer", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", variants: [{ displayName: "Half", priceRupees: 240 }, { displayName: "Full", priceRupees: 420 }] },
      { name: "Kadhai Paneer", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", variants: [{ displayName: "Half", priceRupees: 215 }, { displayName: "Full", priceRupees: 375 }] },
      { name: "Paneer Lababdar", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", variants: [{ displayName: "Half", priceRupees: 245 }, { displayName: "Full", priceRupees: 430 }] },
      { name: "Paneer Angare", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633010", variants: [{ displayName: "Half", priceRupees: 200 }, { displayName: "Full", priceRupees: 350 }] },
    ],
  },
  {
    name: "Dal",
    description: "Slow simmered dals, best with breads",
    items: [
      { name: "Dal Tadka", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633210", basePriceRupees: 150 },
      { name: "Dal Makhani", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633210", variants: [{ displayName: "Half", priceRupees: 185 }, { displayName: "Full", priceRupees: 325 }] },
      { name: "Dal Fry", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633210", basePriceRupees: 140 },
      { name: "Rajma Masala", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633210", basePriceRupees: 160 },
    ],
  },
  {
    name: "Rice",
    description: "Biryani and fragrant rice",
    items: [
      { name: "Veg Biryani", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633310", variants: [{ displayName: "Half", priceRupees: 215 }, { displayName: "Full", priceRupees: 385 }] },
      { name: "Chicken Biryani", vegType: "NON_VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633310", variants: [{ displayName: "Half", priceRupees: 255 }, { displayName: "Full", priceRupees: 445 }] },
      { name: "Jeera Rice", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633310", basePriceRupees: 175 },
      { name: "Veg Fried Rice", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633310", variants: [{ displayName: "Half", priceRupees: 165 }, { displayName: "Full", priceRupees: 285 }] },
      { name: "Egg Fried Rice", vegType: "EGG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99633310", variants: [{ displayName: "Half", priceRupees: 175 }, { displayName: "Full", priceRupees: 295 }] },
    ],
  },
  {
    name: "Breads",
    description: "Straight from the tandoor",
    items: [
      { name: "Tandoori Roti", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634110", basePriceRupees: 30 },
      { name: "Butter Naan", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634110", basePriceRupees: 60 },
      { name: "Garlic Naan", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634110", basePriceRupees: 75 },
      { name: "Laccha Paratha", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634110", basePriceRupees: 70 },
      { name: "Missi Roti", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634110", basePriceRupees: 55 },
      { name: "Stuffed Naan", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634110", basePriceRupees: 85 },
    ],
  },
  {
    name: "Chinese",
    description: "Wok fired Indo-Chinese",
    items: [
      { name: "Veg Hakka Noodles", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634910", variants: [{ displayName: "Half", priceRupees: 165 }, { displayName: "Full", priceRupees: 285 }] },
      { name: "Veg Schezwan Noodles", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634910", variants: [{ displayName: "Half", priceRupees: 175 }, { displayName: "Full", priceRupees: 295 }] },
      { name: "Veg Manchurian", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634910", basePriceRupees: 245 },
      { name: "Chilli Paneer", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634910", variants: [{ displayName: "Half", priceRupees: 215 }, { displayName: "Full", priceRupees: 385 }] },
      { name: "Veg Spring Roll", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634910", basePriceRupees: 180 },
    ],
  },
  {
    name: "Snacks",
    description: "Tea-time bites",
    items: [
      { name: "Samosa (2 pcs)", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634510", basePriceRupees: 70 },
      { name: "Bread Pakoda (2 pcs)", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634510", basePriceRupees: 80 },
      { name: "French Fries", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634510", basePriceRupees: 120 },
      { name: "Peri Peri Fries", vegType: "VEG", itemType: "FOOD", taxRatePercent: FOOD_TAX, hsnSacCode: "99634510", basePriceRupees: 150 },
    ],
  },
  {
    name: "Beverages",
    description: "Chai, lassi and cold pours",
    items: [
      { name: "Masala Tea", vegType: "VEG", itemType: "BEVERAGE", taxRatePercent: FOOD_TAX, hsnSacCode: "99633120", variants: [{ displayName: "Small", priceRupees: 20, sizeValue: 200, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 30, sizeValue: 300, sizeUnit: "ML" }] },
      { name: "Masala Chaas", vegType: "VEG", itemType: "BEVERAGE", taxRatePercent: FOOD_TAX, hsnSacCode: "99633120", basePriceRupees: 60 },
      { name: "Sweet Lassi", vegType: "VEG", itemType: "BEVERAGE", taxRatePercent: FOOD_TAX, hsnSacCode: "99633120", variants: [{ displayName: "Small", priceRupees: 70, sizeValue: 250, sizeUnit: "ML" }, { displayName: "Full", priceRupees: 110, sizeValue: 400, sizeUnit: "ML" }] },
      { name: "Cold Coffee", vegType: "VEG", itemType: "BEVERAGE", taxRatePercent: FOOD_TAX, hsnSacCode: "99633120", variants: [{ displayName: "Small", priceRupees: 130, sizeValue: 250, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 170, sizeValue: 400, sizeUnit: "ML" }] },
      { name: "Fresh Lime Soda", vegType: "VEG", itemType: "BEVERAGE", taxRatePercent: FOOD_TAX, hsnSacCode: "99633120", variants: [{ displayName: "Small", priceRupees: 75, sizeValue: 200, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 105, sizeValue: 350, sizeUnit: "ML" }] },
      { name: "Cola", vegType: "VEG", itemType: "BEVERAGE", taxRatePercent: PACKAGED_TAX, hsnSacCode: "22021010", variants: [{ displayName: "250 ml", priceRupees: 30, sizeValue: 250, sizeUnit: "ML" }, { displayName: "500 ml", priceRupees: 50, sizeValue: 500, sizeUnit: "ML" }] },
      { name: "Mineral Water", vegType: "VEG", itemType: "BEVERAGE", taxRatePercent: PACKAGED_TAX, hsnSacCode: "22011010", basePriceRupees: 20 },
    ],
  },
  {
    name: "Desserts",
    description: "A sweet finish",
    items: [
      { name: "Gulab Jamun (2 pcs)", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634510", basePriceRupees: 85 },
      { name: "Rasmalai", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634510", basePriceRupees: 115 },
      { name: "Gajar Halwa", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634510", basePriceRupees: 95 },
      { name: "Brownie with Ice Cream", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634510", basePriceRupees: 165 },
      { name: "Ice Cream", vegType: "VEG", itemType: "FOOD", taxRatePercent: PREPARED_TAX, hsnSacCode: "99634510", variants: [{ displayName: "1 Scoop", priceRupees: 70 }, { displayName: "2 Scoops", priceRupees: 130 }] },
    ],
  },
];

const EXPECTED_ITEM_COUNT = MENU_SPEC.reduce((n, c) => n + c.items.length, 0);

// ---------------------------------------------------------------------------
// Floor plan
// ---------------------------------------------------------------------------

const SECTION_SPEC = [
  { name: "Main Hall", tableNumbers: [1, 2, 3, 4, 5, 6] },
  { name: "Garden Side", tableNumbers: [7, 8, 9, 10] },
  { name: "Family Lounge", tableNumbers: [11, 12] },
] as const;

const EXPECTED_TABLE_COUNT = SECTION_SPEC.reduce((n, s) => n + s.tableNumbers.length, 0);
/** Capacities cycle through a realistic spread instead of being uniform. */
const CAPACITY_CYCLE = [2, 4, 4, 6, 2, 4, 8, 4, 6, 2, 8, 4] as const;

// ---------------------------------------------------------------------------
// People, reasons, payment mix
// ---------------------------------------------------------------------------

const CUSTOMER_NAMES = [
  "Aarav Sharma", "Ishita Patel", "Rohan Mehta", "Sneha Iyer", "Arjun Nair",
  "Priya Reddy", "Vikram Joshi", "Ananya Gupta", "Karthik Nair", "Divya Menon",
  "Rahul Verma", "Sanya Kapoor", "Aditya Singh", "Meera Joshi", "Nikhil Rao",
  "Pooja Bhatt", "Suresh Solanki", "Kavita Rathore", "Manish Saini", "Neha Bhardwaj",
] as const;

const CANCEL_REASONS = [
  "Customer left before service",
  "Item unavailable in kitchen",
  "Order entered by mistake",
  "Customer changed their mind",
  "Long wait, order called off",
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

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

// Backdating deliberately targets the *native* driver handle rather than
  // `Model.bulkWrite`: mongoose marks `createdAt` immutable, so it silently drops
  // `createdAt` from an update payload while still reporting `modifiedCount: 1`.
  // Only the raw collection actually backdates a record's creation time.
  interface AnyMongooseModel {
    collection: {
      bulkWrite(
        ops: unknown[],
        options?: { ordered?: boolean }
      ): Promise<{ matchedCount?: number }>;
    };
    deleteMany(filter: unknown): { exec(): Promise<{ deletedCount?: number }> };
    updateOne(filter: unknown, update: unknown): unknown;
  }
  type RestampOp = { model: AnyMongooseModel; id: string; patch: Record<string, Date> };

/**
 * Backdating is buffered and flushed with bulkWrite: a three-month run performs
 * tens of thousands of timestamp writes, and one round trip per document would
 * dominate the runtime. `timestamps: false` keeps mongoose from overwriting the
 * values we are setting.
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

function ordersForDay(rng: () => number, dayStartMs: number): number {
  // IST weekday: 0 = Sunday .. 6 = Saturday.
  const istDate = new Date(dayStartMs + IST_OFFSET_MS);
  const weekday = istDate.getUTCDay();
  const isWeekend = weekday === 0 || weekday === 5 || weekday === 6;
  const base = isWeekend ? randInt(rng, 26, 30) : randInt(rng, 20, 25);
  // Occasional slow day so the trend line is not a flat band.
  const dip = rng() < 0.08 ? randInt(rng, 6, 10) : 0;
  // Mild upward drift across the quarter (word of mouth).
  const progress = (dayStartMs - RANGE_START_MS) / DAY_MS / DAY_COUNT;
  const drift = rng() < 0.3 ? Math.round(progress * 3) : 0;
  return Math.max(8, base - dip + drift);
}

/**
 * Samples `count` distinct minutes across the service windows by weight, so
 * lunch/dinner are busy and the afternoon lulls. The final day is capped at the
 * current time: no seeded record may be future-dated.
 */
function pickServiceMinutes(
  rng: () => number,
  count: number,
  dayStartMs: number,
  isLastDay: boolean
): number[] {
  const capMs = isLastDay ? SEED_NOW.getTime() : Infinity;
  const windows = SERVICE_WINDOWS.map((w) => ({ ...w }));

  const chosen: number[] = [];
  let guard = 0;
  while (chosen.length < count && guard < count * 12) {
    guard++;
    const w = weighted(rng, windows.map((x) => [x, x.weight] as const));
    const ms = istMinutesToMs(dayStartMs, randInt(rng, w.from, w.to));
    if (ms > capMs) continue;
    // Keep service windows from stacking identical minutes.
    if (chosen.some((existing) => Math.abs(existing - ms) < 60_000)) continue;
    chosen.push(ms);
  }
  return shuffle(rng, chosen).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Services = {
  restaurantService: typeof import("@/lib/restaurant-service");
  categoryService: typeof import("@/lib/menu/category-service");
  itemService: typeof import("@/lib/menu/item-service");
  sectionService: typeof import("@/lib/tables/section-service");
  tableService: typeof import("@/lib/tables/table-service");
  orderService: typeof import("@/lib/orders/order-service");
  kotService: typeof import("@/lib/orders/kot-service");
  billService: typeof import("@/lib/billing/bill-service");
  subscriptionService: typeof import("@/lib/admin/subscription-service");
};

interface SeedResult {
  restaurantId: string;
  ownerId: string;
  planId: string;
  subscriptionId: string;
}

const SUPER_ADMIN_EMAIL = "ranvsingh7@gmail.com";

interface SuperAdminSnapshot {
  role: string;
  restaurantId: string | null;
  isActive: boolean;
  passwordHash: string;
  updatedAt: string | null;
}

/**
 * Identity-relevant fingerprint of the SUPER_ADMIN account. Only the fields the
 * seed must never touch are captured, so the comparison stays meaningful without
 * holding a password hash in the report.
 */
export async function readSuperAdminFingerprint(): Promise<SuperAdminSnapshot | null> {
  const doc = await UserModel.findOne({ email: SUPER_ADMIN_EMAIL }).lean();
  if (!doc) return null;
  return {
    role: doc.role,
    restaurantId: doc.restaurantId?.toString() ?? null,
    isActive: doc.isActive,
    passwordHash: doc.passwordHash,
    updatedAt: doc.updatedAt?.toISOString() ?? null,
  };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "restopos";
  const reset = process.argv.includes("--reset");

  if (!uri) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }

  // The demo password never appears in this file. Without it there is nothing
  // to seed: refusing here keeps a hardcoded fallback from ever creeping back.
  const demoPassword = process.env.DEMO_SEED_PASSWORD;
  if (!demoPassword || demoPassword.length < 8) {
    console.error(
      "DEMO_SEED_PASSWORD is not set (or is shorter than 8 characters).\n" +
        "Set it in .env.local (or export it for this run). It is used only to hash\n" +
        "the demo staff passwords; it is never printed or stored in plaintext."
    );
    process.exit(1);
  }

  // Safety: refuse a production-looking target BEFORE connecting. The guard file
  // is untouched; `ALLOW_DESTRUCTIVE_PRODUCTION_DB=true` remains its documented
  // escape hatch for an intentional maintenance run.
  const decision = guardDestructiveScriptOrExit({
    operation: reset ? "destructive" : "seed",
    scriptName: reset ? "db:seed:demo:restaurant:reset" : "db:seed:demo:restaurant",
  });

  await mongoose.connect(uri, { dbName, maxPoolSize: 5 });

  // Dynamic imports: these modules pull in db/index (which reads MONGODB_URI at
  // import time) and are server-only, so they must load after loadEnvConfig.
  const [
    restaurantService,
    categoryService,
    itemService,
    sectionService,
    tableService,
    orderService,
    kotService,
    billService,
    subscriptionService,
  ] = await Promise.all([
    import("@/lib/restaurant-service"),
    import("@/lib/menu/category-service"),
    import("@/lib/menu/item-service"),
    import("@/lib/tables/section-service"),
    import("@/lib/tables/table-service"),
    import("@/lib/orders/order-service"),
    import("@/lib/orders/kot-service"),
    import("@/lib/billing/bill-service"),
    import("@/lib/admin/subscription-service"),
  ]);
  const services: Services = {
    restaurantService,
    categoryService,
    itemService,
    sectionService,
    tableService,
    orderService,
    kotService,
    billService,
    subscriptionService,
  };

  console.log(`Target database : ${dbName}`);
  console.log(`Host            : ${decision.host ?? "unknown"}`);
  console.log(`Window          : ${START_DAY_ISO} -> ${END_DAY_ISO} (${DAY_COUNT} IST days)`);

  // ---- Idempotency ------------------------------------------------------
  // Detect the demo tenant by its GSTIN, not just its name: a rename must not
  // cause a second tenant to be created. The GSTIN is a fixed constant owned by
  // this script, so a match is unambiguous.
  const existing = await RestaurantModel.findOne({ gstin: DEMO_GSTIN }).lean();

  if (existing) {
    if (!reset) {
      console.log(
        `\nDemo restaurant "${DEMO_RESTAURANT_NAME}" already exists (${String(existing._id)}).\n` +
          "Nothing was created. Use `npm run db:seed:demo:restaurant:reset` to wipe\n" +
          "and reseed ONLY this demo tenant."
      );
      await mongoose.disconnect();
      process.exit(0);
    }
    console.log(`\n--reset: wiping demo tenant ${String(existing._id)}…`);
    const removed = await wipeDemoTenant(String(existing._id));
    console.log(`Removed: ${JSON.stringify(removed)}`);
  }

  // Captured before any write so "SUPER_ADMIN untouched" is a real before/after
  // comparison rather than a re-read of the same state.
  const superAdminBefore = await readSuperAdminFingerprint();
  const result = await seedTenant(services);
  await verify(result, superAdminBefore);

  await mongoose.disconnect();
  console.log("\nDone.");
}

/** Creates the demo tenant end to end. */
async function seedTenant(services: Services): Promise<SeedResult> {
  const rng = mulberry32(SEED);
  const startedAt = Date.now();

  // ---- Users ------------------------------------------------------------
  const passwordHash = await argon2.hash(process.env.DEMO_SEED_PASSWORD as string, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const existingOwner = await UserModel.findOne({ email: DEMO_OWNER_EMAIL }).lean();
  if (existingOwner?.restaurantId && String(existingOwner.restaurantId) !== "") {
    // The demo owner already owns a tenant: nothing safe left to do.
    throw new Error(
      `${DEMO_OWNER_EMAIL} already owns restaurant ${String(existingOwner.restaurantId)}. ` +
        "Run the --reset form first so this script can rebuild its own tenant."
    );
  }
  const owner = await UserModel.findOneAndUpdate(
    { email: DEMO_OWNER_EMAIL },
    {
      $setOnInsert: {
        fullName: "Demo Spice Kitchen Owner",
        email: DEMO_OWNER_EMAIL,
        passwordHash,
        phone: "9829001001",
        role: "OWNER",
        restaurantId: null,
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );
  const ownerId = String(owner._id);

  // ---- Restaurant -------------------------------------------------------
  const created = await services.restaurantService.createRestaurantForUser(ownerId, {
    name: DEMO_RESTAURANT_NAME,
    ownerName: "Demo Spice Kitchen Owner",
    phone: "9829001001",
    email: DEMO_OWNER_EMAIL,
    address: "12, Pal Road, Near Clock Tower",
    city: "Jodhpur",
    state: "Rajasthan",
    pincode: "342001",
    gstRegistered: true,
    gstin: DEMO_GSTIN,
    businessType: "Restaurant",
  });
  const restaurantId = created.restaurantId;
  if (!restaurantId) throw new Error("Could not create the demo restaurant.");
  console.log(`\nRestaurant ${restaurantId} "${DEMO_RESTAURANT_NAME}" created.`);

  // Tax + service-charge configuration. CGST/SGST because both the restaurant
  // and the guests demo data assumes are intra-state (Rajasthan).
  await RestaurantSettingsModel.updateOne(
    { restaurantId },
    {
      $set: {
        currency: "INR",
        taxEnabled: true,
        defaultTaxRate: FOOD_TAX,
        taxInclusive: false,
        gstScheme: "INTRA_STATE",
        cgstRatePercent: FOOD_TAX / 2,
        sgstRatePercent: FOOD_TAX / 2,
        igstRatePercent: FOOD_TAX,
        serviceChargeEnabled: true,
        serviceChargeRate: 5,
        roundOffEnabled: true,
        billPrefix: "BILL",
        kotPrefix: "KOT",
      },
    }
  );

  // ---- Staff ------------------------------------------------------------
  const managerId = await ensureStaff(
    { email: DEMO_MANAGER_EMAIL, fullName: "Demo Spice Kitchen Manager", role: "MANAGER", phone: "9829001002" },
    restaurantId,
    passwordHash
  );
  const cashierIds = [
    await ensureStaff({ email: DEMO_CASHIER_EMAIL, fullName: "Demo Cashier One", role: "CASHIER", phone: "9829001003" }, restaurantId, passwordHash),
    await ensureStaff({ email: DEMO_CASHIER2_EMAIL, fullName: "Demo Cashier Two", role: "CASHIER", phone: "9829001004" }, restaurantId, passwordHash),
  ];
  const waiterIds = [
    await ensureStaff({ email: DEMO_WAITER_EMAIL, fullName: "Demo Waiter One", role: "WAITER", phone: "9829001005" }, restaurantId, passwordHash),
    await ensureStaff({ email: DEMO_WAITER2_EMAIL, fullName: "Demo Waiter Two", role: "WAITER", phone: "9829001006" }, restaurantId, passwordHash),
  ];

  // ---- Menu -------------------------------------------------------------
  const menuLines = await seedMenu(restaurantId, services);
  console.log(`Menu: ${MENU_SPEC.length} categories, ${EXPECTED_ITEM_COUNT} items, ${menuLines.length} orderable lines.`);

  // ---- Tables -----------------------------------------------------------
  const tableIds = await seedTables(restaurantId, services);
  console.log(`Floor: ${SECTION_SPEC.length} sections, ${tableIds.length} tables.`);

  // ---- Subscription on the EXISTING Silver plan -------------------------
  const silverPlan = await PlanModel.findOne({ name: SILVER_PLAN_NAME, isActive: true }).lean();
  if (!silverPlan) {
    throw new Error(
      `The "${SILVER_PLAN_NAME}" plan was not found. This script never creates plans — ` +
        "create it as a Super Admin first, then re-run."
    );
  }
  const planId = String(silverPlan._id);
  const planFingerprint = fingerprintPlan(silverPlan);
  console.log(`\nUsing existing "${SILVER_PLAN_NAME}" plan ${planId} (read-only).`);

  const subscription = await services.subscriptionService.createSubscription({
    restaurantId,
    planId,
    // Start on the first trading day so the tenant has been "live" for the whole
    // seeded window. A 365-day Silver term keeps it ACTIVE today.
    startDate: new Date(RANGE_START_MS),
    notes: "Demo Spice Kitchen — seeded demo tenant",
    createdBy: ownerId,
    changedByRole: "OWNER",
    reason: "Demo seed: activate Silver plan",
  });
  const subscriptionId = subscription.subscriptionId;
  console.log(`Subscription ${subscriptionId} created (${subscription.status}, ${subscription.finalPricePaise} paise).`);

  // ---- Trading history --------------------------------------------------
  const restamper = new Restamper();
  let totalOrders = 0;
  let totalCancelled = 0;
  let totalBills = 0;
  let totalKots = 0;
  let totalPayments = 0;

  for (let day = 0; day < DAY_COUNT; day++) {
    const dayStartMs = RANGE_START_MS + day * DAY_MS;
    const count = ordersForDay(rng, dayStartMs);
    const slots = pickServiceMinutes(rng, count, dayStartMs, day === DAY_COUNT - 1);
    let dayOrders = 0;
    let dayRevenue = 0;

    for (const placedAtMs of slots) {
      const placedAt = new Date(placedAtMs);
      const orderType = weighted<OrderType>(rng, [
        ["DINE_IN", 62],
        ["TAKEAWAY", 25],
        ["QUICK_SALE", 13],
      ]);
      // Waiters ring dine-in tables; cashiers ring the counter.
      const user = orderType === "DINE_IN"
        ? weighted(rng, [[waiterIds[0], 30], [waiterIds[1], 30], [managerId, 10], [ownerId, 5], [cashierIds[0], 15], [cashierIds[1], 10]])
        : weighted(rng, [[cashierIds[0], 40], [cashierIds[1], 35], [managerId, 20], [ownerId, 5]]);

      const lines = buildOrderLines(rng, menuLines, orderType, placedAtMs, RANGE_START_MS);
      if (lines.length === 0) continue;

      // One roll decides BOTH the discount type and its unit, otherwise a
      // PERCENTAGE discount can pick up a rupee amount (100% off) by accident.
      const usePercentageDiscount = rng() < 0.7;
      const hasDiscount = rng() < 0.25;

      const orderInput: CreateOrderInput = {
        orderType,
        items: lines.map((l) => ({
          menuItemId: l.menuItemId,
          variantId: l.variantId ?? undefined,
          quantity: l.quantity,
        })),
      };
      if (orderType === "DINE_IN") {
        orderInput.tableId = pick(rng, tableIds);
        orderInput.customerName = pick(rng, CUSTOMER_NAMES);
      } else if (orderType === "TAKEAWAY") {
        orderInput.customerName = pick(rng, CUSTOMER_NAMES);
        orderInput.customerPhone = `9${randInt(rng, 100000000, 999999999)}`;
      }

      const orderView = await services.orderService.createOrder(restaurantId, user, orderInput);
      totalOrders++;
      dayOrders++;

      // A fixed rupee comp must never exceed the basket, or the bill collapses
      // to zero. Cap it at 15% of what was actually ordered. Note the cap is
      // computed in paise (order totals) and handed over in rupees, which is
      // the unit the billing layer expects for a FIXED discount.
      const maxFixedRupees = Math.max(
        1,
        Math.floor((orderView.totalPaise * 0.15) / 100)
      );
      const discountInput = !hasDiscount
        ? undefined
        : usePercentageDiscount
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

      // ~5% walk-outs. Only dine-in / takeaway orders can be called off, and
      // never on the final day (it would sit cancelled with no history yet).
      const cancelled = orderType !== "QUICK_SALE" && day < DAY_COUNT - 1 && rng() < 0.05;
      if (cancelled) {
        totalCancelled++;
        await services.orderService.cancelOrder(
          restaurantId,
          orderView.id,
          user,
          pick(rng, CANCEL_REASONS)
        );
        const cancelledAt = new Date(placedAtMs + randInt(rng, 6, 28) * 60_000);
        restamper.queue(OrderModel, orderView.id, {
          createdAt: placedAt,
          updatedAt: cancelledAt,
          cancelledAt,
        });
        continue;
      }

      // Kitchen ticket for everything that actually goes on the pass.
      if (orderType !== "QUICK_SALE") {
        await services.orderService.sendOrderToKitchen(restaurantId, orderView.id);
        const printed = await services.kotService.printPendingKot(restaurantId, orderView.id, user);
        if (printed.kot) {
          await services.kotService.markKotSent(restaurantId, printed.kot.id);
          const kotAt = new Date(placedAtMs + randInt(rng, 2, 6) * 60_000);
          restamper.queue(KotModel, printed.kot.id, {
            createdAt: kotAt,
            updatedAt: kotAt,
            printedAt: kotAt,
          });
          restamper.queue(OrderModel, orderView.id, { sentToKitchenAt: kotAt });
          totalKots++;
        }
      }

      const bill = await services.billService.generateBill(
        restaurantId,
        orderView.id,
        user,
        discountInput
      );
      totalBills++;

      const billAt = new Date(
        placedAtMs +
          randInt(
            rng,
            orderType === "DINE_IN" ? 22 : orderType === "TAKEAWAY" ? 10 : 2,
            orderType === "DINE_IN" ? 52 : orderType === "TAKEAWAY" ? 18 : 4
          ) * 60_000
      );
      const paidAt = new Date(billAt.getTime() + randInt(rng, 0, 4) * 60_000);

      const method = weighted(rng, PAYMENT_WEIGHTS);
      if (bill.grandTotalPaise < 1) {
        throw new Error(
          `Bill ${bill.id} for order ${orderView.id} came out at zero paise; ` +
            "a discount cancelled the whole basket. Lower the fixed discounts."
        );
      }
      // ~15% of dine-in bills are settled in two parts.
      if (orderType === "DINE_IN" && rng() < 0.15) {
        const firstMethod = method;
        const secondMethod = weighted(rng, PAYMENT_WEIGHTS);
        const firstPart = Math.round(bill.grandTotalPaise * (0.35 + rng() * 0.35));
        await services.billService.recordPayment(restaurantId, bill.id, user, {
          method: firstMethod,
          amountPaise: firstPart,
          referenceNumber: paymentReference(rng, firstMethod),
        });
        await services.billService.completePayment(restaurantId, bill.id, user, {
          method: secondMethod,
          referenceNumber: paymentReference(rng, secondMethod),
        });
        const parts = await PaymentModel.find({ billId: bill.id }).select("_id").sort({ createdAt: 1, _id: 1 }).lean();
        restamper.queue(PaymentModel, String(parts[0]._id), { createdAt: billAt, updatedAt: billAt });
        if (parts[1]) {
          restamper.queue(PaymentModel, String(parts[1]._id), { createdAt: paidAt, updatedAt: paidAt });
        }
        totalPayments += parts.length;
      } else {
        await services.billService.completePayment(restaurantId, bill.id, user, {
          method,
          referenceNumber: paymentReference(rng, method),
        });
        const payment = await PaymentModel.findOne({ billId: bill.id }).select("_id").lean();
        if (payment) {
          restamper.queue(PaymentModel, String(payment._id), { createdAt: paidAt, updatedAt: paidAt });
        }
        totalPayments += 1;
      }

      dayRevenue += bill.grandTotalPaise;
      restamper.queue(OrderModel, orderView.id, { createdAt: placedAt, updatedAt: paidAt, paidAt });
      restamper.queue(BillModel, bill.id, { createdAt: billAt, updatedAt: paidAt, paidAt });

      if (restamper.pending >= 2000) await restamper.flush();
    }

    await restamper.flush();
    console.log(
      `  ${new Date(dayStartMs + IST_OFFSET_MS).toISOString().slice(0, 10)} ` +
        `(${dayName(dayStartMs)}) ${String(dayOrders).padStart(2)} orders  ` +
        `Rs ${(dayRevenue / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
    );
  }

  await restamper.flush();

  const planAfter = await PlanModel.findOne({ name: SILVER_PLAN_NAME }).lean();
  if (planAfter && fingerprintPlan(planAfter) !== planFingerprint) {
    throw new Error("The Silver plan changed during the seed. Aborting verification.");
  }

  console.log(
    `\nSeeded ${totalOrders} orders (${totalCancelled} cancelled), ${totalKots} KOTs, ` +
      `${totalBills} bills, ${totalPayments} payments in ${Math.round((Date.now() - startedAt) / 1000)}s.`
  );

  return { restaurantId, ownerId, planId, subscriptionId };
}

function dayName(dayStartMs: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(dayStartMs + IST_OFFSET_MS).getUTCDay()];
}

async function ensureStaff(
  input: { email: string; fullName: string; role: "MANAGER" | "CASHIER" | "WAITER"; phone: string },
  restaurantId: string,
  passwordHash: string
): Promise<string> {
  const user = await UserModel.findOneAndUpdate(
    { email: input.email },
    {
      $setOnInsert: {
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        phone: input.phone,
        role: input.role,
        restaurantId,
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );

  // A demo address can only ever belong to this tenant. The earlier
  // `db:seed:demo` script reuses some of the same addresses for its own
  // restaurant, so a pre-existing user pointing elsewhere is refused rather
  // than quietly re-pointed: silently adopting them would leave orders in this
  // tenant "created by" somebody who belongs to another one.
  if (!user.restaurantId || String(user.restaurantId) !== restaurantId) {
    throw new Error(
      `${input.email} already belongs to restaurant ${String(user.restaurantId ?? "(none)")}. ` +
        "This script refuses to share a demo account between tenants. Free that address " +
        `(or reseed this tenant with --reset) before running.`
    );
  }
  return String(user._id);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

interface MenuLine {
  menuItemId: string;
  variantId: string | null;
  category: string;
  itemType: ItemType;
  /** Kept in rupees purely for order-composition heuristics. */
  priceRupees: number;
  /** Items that make sense as a quick single-serve drink/snack. */
  quickServe: boolean;
  /** True for curries/gravies that are shared, not ordered solo. */
  mainsOnly: boolean;
}

async function seedMenu(restaurantId: string, services: Services): Promise<MenuLine[]> {
  const lines: MenuLine[] = [];

  for (const [catIndex, cat] of MENU_SPEC.entries()) {
    const category = await services.categoryService.createCategory(restaurantId, {
      name: cat.name,
      description: cat.description,
      isActive: true,
      displayOrder: catIndex,
    });

    for (const [itemIndex, spec] of cat.items.entries()) {
      const hasVariants = Array.isArray(spec.variants) && spec.variants.length > 0;
      const item = await services.itemService.createMenuItem(restaurantId, {
        name: spec.name,
        description: `${spec.name} — ${cat.name}`,
        categoryId: category.id,
        itemType: spec.itemType,
        vegType: spec.vegType,
        hasVariants,
        hsnSacCode: spec.hsnSacCode ?? undefined,
        basePriceRupees: spec.basePriceRupees ?? null,
        isAvailable: true,
        isActive: true,
        displayOrder: itemIndex,
        taxOverride: {
          enabled: true,
          taxRatePercent: spec.taxRatePercent,
          taxMode: "EXCLUSIVE",
          taxType: "CGST_SGST",
        },
        variants: spec.variants?.map((v) => ({
          displayName: v.displayName,
          priceRupees: v.priceRupees,
          sizeValue: v.sizeValue ?? null,
          sizeUnit: (v.sizeUnit as MenuSizeUnit | null | undefined) ?? null,
          displayOrder: 0,
          isActive: true,
        })) ?? [],
      });

      const mainsOnly =
        spec.itemType === "FOOD" && ["North Indian", "Paneer Specials", "Dal"].includes(cat.name);
      const quickServe =
        spec.itemType === "BEVERAGE" ||
        ["Starters", "Soups", "Snacks", "Breads", "Desserts"].includes(cat.name);

      if (item.hasVariants) {
        for (const variant of item.variants) {
          lines.push({
            menuItemId: item.id,
            variantId: variant.id,
            category: cat.name,
            itemType: item.itemType as ItemType,
            priceRupees: variant.pricePaise / 100,
            quickServe: cat.name === "Breads" ? false : quickServe,
            mainsOnly,
          });
        }
      } else {
        lines.push({
          menuItemId: item.id,
          variantId: null,
          category: cat.name,
          itemType: item.itemType as ItemType,
          priceRupees: (item.basePrice ?? 0) / 100,
          quickServe,
          mainsOnly,
        });
      }
    }
  }

  return lines;
}

/**
 * Builds a plausible basket: a couple of dishes, a matching bread or rice, and
 * a drink. Dine-in baskets are larger; quick sales are one or two drinks.
 * Morning slots skew to beverages/snacks so the morning trickle looks real.
 */
function buildOrderLines(
  rng: () => number,
  menuLines: MenuLine[],
  orderType: OrderType,
  placedAtMs: number,
  rangeStartMs: number
): Array<{ menuItemId: string; variantId: string | null; quantity: number }> {
  const minutesIntoDay = Math.floor(((placedAtMs - rangeStartMs) % DAY_MS) / 60_000);
  const isMorning = minutesIntoDay < 11 * 60;

  const mains = menuLines.filter((l) => !l.quickServe && !l.mainsOnly);
  const mainsOnly = menuLines.filter((l) => l.mainsOnly);
  const breads = menuLines.filter((l) => l.category === "Breads");
  const desserts = menuLines.filter((l) => l.category === "Desserts");
  const quick = menuLines.filter((l) => l.quickServe && l.itemType !== "BEVERAGE");
  const drinks = menuLines.filter((l) => l.itemType === "BEVERAGE");

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
  if (isMorning && rng() < 0.8) {
    for (let i = 0; i < Math.max(1, drinkCount); i++) add(pick(rng, drinks), 1);
    if (rng() < 0.5) add(pick(rng, quick), 1);
  } else if (orderType === "QUICK_SALE") {
    for (let i = 0; i < Math.max(1, drinkCount - 1); i++) add(pick(rng, drinks), 1);
    if (rng() < 0.55) add(pick(rng, quick), 1);
  } else if (orderType === "TAKEAWAY") {
    const mainCount = randInt(rng, 0, 2);
    for (let i = 0; i < mainCount; i++) {
      add(rng() < 0.35 ? pick(rng, mainsOnly) : pick(rng, mains), 1);
    }
    if (rng() < 0.7) add(pick(rng, breads), 1);
    for (let i = 0; i < Math.max(1, drinkCount); i++) add(pick(rng, drinks), 1);
    if (rng() < 0.4) add(pick(rng, quick), 1);
  } else {
    // Dine-in: a shared dish or two, breads to mop up, drinks for the table.
    const mainCount = weighted(rng, [[1, 8], [2, 42], [3, 34], [4, 16]]);
    for (let i = 0; i < mainCount; i++) {
      add(rng() < 0.45 ? pick(rng, mainsOnly) : pick(rng, mains), 1);
    }
    const breadCount = weighted(rng, [[0, 6], [1, 24], [2, 40], [3, 22], [4, 8]]);
    for (let i = 0; i < breadCount; i++) add(pick(rng, breads), randInt(rng, 1, 3));
    for (let i = 0; i < drinkCount; i++) add(pick(rng, drinks), randInt(rng, 1, 2));
    if (rng() < 0.45) add(pick(rng, quick), 1);
    if (rng() < 0.35) add(pick(rng, desserts), 1);
  }

  return [...chosen.values()].map((l) => ({
    ...l,
    quantity: Math.max(1, Math.min(6, l.quantity)),
  }));
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

async function seedTables(restaurantId: string, services: Services): Promise<string[]> {
  const ids: string[] = [];
  let capacityIndex = 0;
  for (const section of SECTION_SPEC) {
    const created = await services.sectionService.createSection(restaurantId, {
      name: section.name,
      isActive: true,
    });
    for (const tableNumber of section.tableNumbers) {
      const table = await services.tableService.createTable(restaurantId, {
        name: `Table ${tableNumber}`,
        capacity: CAPACITY_CYCLE[capacityIndex % CAPACITY_CYCLE.length],
        sectionId: created.id,
        status: "AVAILABLE",
        isActive: true,
      });
      ids.push(table.id);
      capacityIndex++;
    }
  }
  return ids;
}

function paymentReference(rng: () => number, method: BillPaymentMethod): string | undefined {
  if (method === "UPI") return `UPI${randInt(rng, 1000000000, 9999999999)}`;
  if (method === "CARD") return `CARD-${randInt(rng, 100000, 999999)}`;
  if (method === "OTHER") return `REF-${randInt(rng, 100000, 999999)}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Wipe — strictly scoped to this script's demo tenant
// ---------------------------------------------------------------------------

async function wipeDemoTenant(restaurantId: string): Promise<Record<string, number>> {
  // Audit logs are deliberately absent: TableAuditLog is append-only and throws
  // on delete by design, so a reseed keeps the trail instead of erasing it.
  const tenantModels: Array<[unknown, Record<string, unknown>, string]> = [
    [MenuCategoryModel, { restaurantId }, "menu categories"],
    [MenuItemModel, { restaurantId }, "menu items"],
    [MenuVariantModel, { restaurantId }, "menu variants"],
    [TableSectionModel, { restaurantId }, "table sections"],
    [RestaurantTableModel, { restaurantId }, "tables"],
    [OrderModel, { restaurantId }, "orders"],
    [KotModel, { restaurantId }, "KOTs"],
    [BillModel, { restaurantId }, "bills"],
    [PaymentModel, { restaurantId }, "payments"],
[SubscriptionHistoryModel, { restaurantId }, "subscription history"],
      [SubscriptionModel, { restaurantId }, "subscriptions"],
      // Billing rows for the plan. These are platform-owned documents that carry
      // the demo restaurant as a plain field, so they are matched by that field
      // rather than `restaurantId`.
      [SubscriptionPaymentModel, { restaurantId }, "subscription payments"],
    [RestaurantSettingsModel, { restaurantId }, "restaurant settings"],
  ];

  const removed: Record<string, number> = {};
  for (const [model, filter, label] of tenantModels) {
    // Called on the model itself: destructuring it would strip the `this`
    // binding Mongoose requires.
    const result = await (model as AnyMongooseModel).deleteMany(filter).exec();
    removed[label] = result.deletedCount ?? 0;
  }

  // Demo users only, and only the ones already bound to this tenant: an
  // address that belongs to some other restaurant is never deleted.
  const users = await UserModel.deleteMany({
    email: { $in: [...DEMO_EMAILS] },
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).exec();
  removed["demo users"] = users.deletedCount ?? 0;

  // Anything still holding a demo address for another tenant is reported, not
  // removed, so the operator can see the conflict.
  const stragglers = await UserModel.countDocuments({
    email: { $in: [...DEMO_EMAILS] },
    restaurantId: { $ne: new mongoose.Types.ObjectId(restaurantId) },
  });
  if (stragglers > 0) {
    console.warn(
      `  note: ${stragglers} demo address(es) belong to another tenant and were left alone.`
    );
  }

  const restaurant = await RestaurantModel.deleteOne({ _id: restaurantId }).exec();
  removed["restaurant"] = restaurant.deletedCount ?? 0;

  return removed;
}

// ---------------------------------------------------------------------------
// Verification
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

function inr(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function verify(
  result: SeedResult,
  superAdminBefore: SuperAdminSnapshot | null
): Promise<void> {
  const superAdminExistsBefore = superAdminBefore !== null;
  const { restaurantId, ownerId, planId, subscriptionId } = result;
  console.log("\n================ VERIFICATION ================");
  const errors: string[] = [];
  const fail = (message: string): void => {
    errors.push(message);
  };
  const oid = new mongoose.Types.ObjectId(restaurantId);

  // ---- 1-11: counts, isolation, integrity -------------------------------
  const [
    restaurants,
    users,
    categories,
    items,
    variants,
    sections,
    tables,
    orders,
    kots,
    bills,
    payments,
    subscriptions,
  ] = await Promise.all([
    RestaurantModel.countDocuments({ _id: oid }),
    UserModel.countDocuments({ restaurantId: oid }),
    MenuCategoryModel.countDocuments({ restaurantId: oid }),
    MenuItemModel.countDocuments({ restaurantId: oid }),
    MenuVariantModel.countDocuments({ restaurantId: oid }),
    TableSectionModel.countDocuments({ restaurantId: oid }),
    RestaurantTableModel.countDocuments({ restaurantId: oid }),
    OrderModel.countDocuments({ restaurantId: oid }),
    KotModel.countDocuments({ restaurantId: oid }),
    BillModel.countDocuments({ restaurantId: oid }),
    PaymentModel.countDocuments({ restaurantId: oid }),
    SubscriptionModel.countDocuments({ restaurantId: oid }),
  ]);

  console.log("\nRestaurant : Demo Spice Kitchen");
  console.log(`Date range : ${START_DAY_ISO} -> ${END_DAY_ISO}`);
  console.log("\nCounts");
  for (const [label, value] of Object.entries({
    Restaurants: restaurants,
    Users: users,
    Categories: categories,
    "Menu items": items,
    "Menu variants": variants,
    "Table sections": sections,
    Tables: tables,
    Orders: orders,
    KOTs: kots,
    Bills: bills,
    Payments: payments,
    Subscriptions: subscriptions,
  })) {
    console.log(`  ${label.padEnd(16)}: ${value}`);
  }

  if (restaurants !== 1) fail(`expected 1 demo restaurant, found ${restaurants}`);
  if (users !== 6) fail(`expected 6 staff users, found ${users}`);
  if (categories !== MENU_SPEC.length) fail(`expected ${MENU_SPEC.length} categories, found ${categories}`);
  if (items !== EXPECTED_ITEM_COUNT) fail(`expected ${EXPECTED_ITEM_COUNT} menu items, found ${items}`);
  if (tables !== EXPECTED_TABLE_COUNT) fail(`expected ${EXPECTED_TABLE_COUNT} tables, found ${tables}`);
  if (subscriptions !== 1) fail(`expected 1 subscription, found ${subscriptions}`);

  // Cross-tenant leakage. Every id reachable from the demo tenant must resolve
  // back to the demo tenant, and the demo staff must live in it.
  const [demoItemIds, demoCategoryIds, demoTableIds, demoOrderIds, demoBillIds, demoUserIds] =
    (await Promise.all([
      MenuItemModel.distinct("_id", { restaurantId: oid }),
      MenuCategoryModel.distinct("_id", { restaurantId: oid }),
      RestaurantTableModel.distinct("_id", { restaurantId: oid }),
      OrderModel.distinct("_id", { restaurantId: oid }),
      BillModel.distinct("_id", { restaurantId: oid }),
      UserModel.distinct("_id", { restaurantId: oid }),
    ])) as mongoose.Types.ObjectId[][];

  const [
    foreignVariantsOfDemoItems,
    foreignItemsUsingDemoCategories,
    foreignTablesNamedLikeDemo,
    foreignKotsOnDemoOrders,
    foreignBillsOnDemoOrders,
    foreignPaymentsOnDemoBills,
    demoUsersOutsideTenant,
    foreignUsersInsideTenant,
  ] = await Promise.all([
    MenuVariantModel.countDocuments({ restaurantId: { $ne: oid }, menuItemId: { $in: demoItemIds } }),
    MenuItemModel.countDocuments({ restaurantId: { $ne: oid }, categoryId: { $in: demoCategoryIds } }),
    RestaurantTableModel.countDocuments({ restaurantId: { $ne: oid }, name: /^Table \d+$/ }),
    KotModel.countDocuments({ restaurantId: { $ne: oid }, orderId: { $in: demoOrderIds } }),
    BillModel.countDocuments({ restaurantId: { $ne: oid }, orderId: { $in: demoOrderIds } }),
    PaymentModel.countDocuments({ restaurantId: { $ne: oid }, billId: { $in: demoBillIds } }),
    UserModel.countDocuments({ email: { $in: [...DEMO_EMAILS] }, restaurantId: { $ne: oid } }),
    UserModel.countDocuments({ restaurantId: oid, email: { $nin: [...DEMO_EMAILS] } }),
  ]);

  for (const [label, value] of Object.entries({
    "menu variants of demo items owned by another tenant": foreignVariantsOfDemoItems,
    "items of another tenant using demo categories": foreignItemsUsingDemoCategories,
    "tables of another tenant named like the demo floor plan": foreignTablesNamedLikeDemo,
    "KOTs of another tenant on demo orders": foreignKotsOnDemoOrders,
    "bills of another tenant on demo orders": foreignBillsOnDemoOrders,
    "payments of another tenant on demo bills": foreignPaymentsOnDemoBills,
    "demo users pointing outside the demo tenant": demoUsersOutsideTenant,
    "non-demo users inside the demo tenant": foreignUsersInsideTenant,
  })) {
    if (value > 0) fail(`${label}: ${value}`);
  }

  // Orphans inside the tenant.
  const [orphanKots, orphanBills, orphanPayments, orphanOrderItems, ordersByNonTenantUser] =
    await Promise.all([
      KotModel.countDocuments({ restaurantId: oid, orderId: { $nin: demoOrderIds } }),
      BillModel.countDocuments({ restaurantId: oid, orderId: { $nin: demoOrderIds } }),
      PaymentModel.countDocuments({ restaurantId: oid, billId: { $nin: demoBillIds } }),
      OrderModel.countDocuments({
        restaurantId: oid,
        $or: [
          { tableId: { $type: "objectId", $nin: demoTableIds } },
          { createdBy: { $nin: demoUserIds } },
        ],
      }),
      OrderModel.countDocuments({ restaurantId: oid, createdBy: { $nin: demoUserIds } }),
    ]);
  if (orphanKots > 0) fail(`${orphanKots} KOTs reference a missing order`);
  if (orphanBills > 0) fail(`${orphanBills} bills reference a missing order`);
  if (orphanPayments > 0) fail(`${orphanPayments} payments reference a missing bill`);
  if (orphanOrderItems > 0) fail(`${orphanOrderItems} orders reference a foreign table or user`);
  if (ordersByNonTenantUser > 0) fail(`${ordersByNonTenantUser} orders were raised by a non-tenant user`);

  // Dine-in orders must always sit on one of the demo tables.
  const dineIn = await OrderModel.countDocuments({ restaurantId: oid, orderType: "DINE_IN" });
  const dineInOnDemoTable = await OrderModel.countDocuments({
    restaurantId: oid,
    orderType: "DINE_IN",
    tableId: { $in: demoTableIds },
  });
  if (dineInOnDemoTable !== dineIn) fail(`${dineIn - dineInOnDemoTable} dine-in orders are not on a demo table`);

  const missingStaff = await UserModel.countDocuments({
    email: { $in: [...DEMO_EMAILS] },
    restaurantId: { $ne: oid },
  });
  if (missingStaff > 0) {
    fail(`${missingStaff} demo staff accounts are not bound to the demo restaurant`);
  }

  const rolesByEmail = await UserModel.find({ email: { $in: [...DEMO_EMAILS] } })
    .select("email role restaurantId")
    .lean();
  const expectedRoles: Record<string, string> = {
    [DEMO_OWNER_EMAIL]: "OWNER",
    [DEMO_MANAGER_EMAIL]: "MANAGER",
    [DEMO_CASHIER_EMAIL]: "CASHIER",
    [DEMO_CASHIER2_EMAIL]: "CASHIER",
    [DEMO_WAITER_EMAIL]: "WAITER",
    [DEMO_WAITER2_EMAIL]: "WAITER",
  };
  console.log("\nStaff");
  for (const user of rolesByEmail) {
    const email = String(user.email);
    const role = String(user.role);
    if (expectedRoles[email] !== role) {
      fail(`${email} has role ${role}, expected ${expectedRoles[email]}`);
    }
    console.log(`  ${email.padEnd(26)} ${role}`);
  }
  if (rolesByEmail.length !== DEMO_EMAILS.length) {
    fail(`expected ${DEMO_EMAILS.length} demo staff, found ${rolesByEmail.length}`);
  }

  // ---- 12: no negative money, 13: no future dates -----------------------
  const negatives = await BillModel.countDocuments({
    restaurantId: oid,
    $or: [
      { subtotalPaise: { $lt: 0 } },
      { discountPaise: { $lt: 0 } },
      { totalTaxPaise: { $lt: 0 } },
      { grandTotalPaise: { $lt: 0 } },
      { dueAmountPaise: { $lt: 0 } },
    ],
  });
  if (negatives > 0) fail(`${negatives} bills contain negative amounts`);

  const [futureOrders, futureBills, futurePayments, futureKots, beforeStart] = await Promise.all([
    OrderModel.countDocuments({ restaurantId: oid, createdAt: { $gt: SEED_NOW } }),
    BillModel.countDocuments({ restaurantId: oid, createdAt: { $gt: SEED_NOW } }),
    PaymentModel.countDocuments({ restaurantId: oid, createdAt: { $gt: SEED_NOW } }),
    KotModel.countDocuments({ restaurantId: oid, createdAt: { $gt: SEED_NOW } }),
    OrderModel.countDocuments({ restaurantId: oid, createdAt: { $lt: new Date(RANGE_START_MS - DAY_MS) } }),
  ]);
  if (futureOrders + futureBills + futurePayments + futureKots > 0) {
    fail(`${futureOrders + futureBills + futurePayments + futureKots} records are future-dated`);
  }
  if (beforeStart > 0) fail(`${beforeStart} orders predate ${START_DAY_ISO}`);

  // ---- 14/15: money reconciliation -------------------------------------
  const [billTotals, paymentByMethod, statusCounts] = await Promise.all([
    BillModel.aggregate([
      { $match: { restaurantId: oid } },
      {
        $group: {
          _id: null,
          grandTotal: { $sum: "$grandTotalPaise" },
          subtotal: { $sum: "$subtotalPaise" },
          discount: { $sum: "$discountPaise" },
          tax: { $sum: "$totalTaxPaise" },
          serviceCharge: { $sum: "$serviceChargeAmountPaise" },
          roundOff: { $sum: "$roundOffAmountPaise" },
          taxable: { $sum: "$taxableAmountPaise" },
        },
      },
    ]),
    PaymentModel.aggregate([
      { $match: { restaurantId: oid } },
      { $group: { _id: "$method", total: { $sum: "$amountPaise" }, count: { $sum: 1 } } },
    ]),
    OrderModel.aggregate([{ $match: { restaurantId: oid } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const sums = billTotals[0] ?? {
    grandTotal: 0, subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, roundOff: 0, taxable: 0,
  };
  const paidTotal = paymentByMethod.reduce((sum, p) => sum + (p.total as number), 0);
  if (paidTotal !== sums.grandTotal) {
    fail(`payment total ${inr(paidTotal)} != bill grand total ${inr(sums.grandTotal)}`);
  }
  if (sums.grandTotal < 0 || sums.subtotal < 0) fail("revenue totals are negative");

  // Bill arithmetic: subtotal - discount + tax + service charge + round off.
  const arithmetic = await BillModel.find({ restaurantId: oid }).select(
    "subtotalPaise discountPaise totalTaxPaise serviceChargeAmountPaise roundOffAmountPaise grandTotalPaise"
  ).lean();
  let arithmeticErrors = 0;
  for (const bill of arithmetic) {
    const expected =
      (bill.subtotalPaise as number) -
      (bill.discountPaise as number) +
      (bill.totalTaxPaise as number) +
      (bill.serviceChargeAmountPaise as number) +
      (bill.roundOffAmountPaise as number);
    if (expected !== (bill.grandTotalPaise as number)) arithmeticErrors++;
  }
  if (arithmeticErrors > 0) fail(`${arithmeticErrors} bills do not add up (subtotal - discount + tax + service + round-off != grand total)`);

  // Payment vs bill, per bill.
  const perBill = await PaymentModel.aggregate([
    { $match: { restaurantId: oid } },
    { $group: { _id: "$billId", total: { $sum: "$amountPaise" } } },
  ]);
  const perBillMap = new Map(perBill.map((p) => [String(p._id), p.total as number]));
  const paidBills = await BillModel.find({ restaurantId: oid, status: "PAID" }).select("_id grandTotalPaise").lean();
  let mismatched = 0;
  for (const bill of paidBills) {
    if (perBillMap.get(String(bill._id)) !== (bill.grandTotalPaise as number)) mismatched++;
  }
  if (mismatched > 0) fail(`${mismatched} PAID bills are not fully reconciled by their payments`);

  const unpaidBills = await BillModel.countDocuments({ restaurantId: oid, status: { $ne: "PAID" } });
  if (unpaidBills > 0) fail(`${unpaidBills} bills are not PAID`);

  const cancelledOrders = await OrderModel.countDocuments({ restaurantId: oid, status: "CANCELLED" });
  const billsPerOrder = await BillModel.countDocuments({ restaurantId: oid });
  if (billsPerOrder !== orders - cancelledOrders) {
    fail(`bills (${billsPerOrder}) != non-cancelled orders (${orders - cancelledOrders})`);
  }

  // ---- KOT ↔ order agreement -------------------------------------------
  const kotOrders = await KotModel.distinct("orderId", { restaurantId: oid });
  if (kotOrders.length !== kots) fail(`${kots} KOTs cover only ${kotOrders.length} orders (duplicate KOTs)`);
  const missingKot = await OrderModel.countDocuments({
    restaurantId: oid,
    orderType: { $ne: "QUICK_SALE" },
    status: { $ne: "CANCELLED" },
    _id: { $nin: kotOrders },
  });
  if (missingKot > 0) fail(`${missingKot} kitchen orders have no KOT`);

  const orderNumbers = await OrderModel.find({ restaurantId: oid }).select("orderNumber").lean();
  const orderNumberSet = new Set(orderNumbers.map((o) => o.orderNumber as number));
  if (orderNumberSet.size !== orderNumbers.length) fail("duplicate order numbers");
  const billNumbers = await BillModel.find({ restaurantId: oid }).select("billNumber").lean();
  if (new Set(billNumbers.map((b) => b.billNumber as string)).size !== billNumbers.length) {
    fail("duplicate bill numbers");
  }
  const kotNumbers = await KotModel.find({ restaurantId: oid }).select("kotNumber").lean();
  if (new Set(kotNumbers.map((k) => k.kotNumber as string)).size !== kotNumbers.length) {
    fail("duplicate KOT numbers");
  }

  // ---- Subscription -----------------------------------------------------
  const { getSubscriptionAccess } = await import("@/lib/admin/subscription-service");
  const access = await getSubscriptionAccess(restaurantId);
  const sub = await SubscriptionModel.findById(subscriptionId).lean();
  const silver = await PlanModel.findById(planId).lean();

  console.log("\nSubscription");
  console.log(`  Plan              : ${silver?.name ?? "(missing)"}`);
  console.log(`  Plan ID           : ${planId}`);
  console.log(`  Subscription ID   : ${subscriptionId}`);
  console.log(`  Status            : ${sub?.status} (derived: ${access.status})`);
  console.log(`  Start / Expiry    : ${sub ? new Date(sub.startDate).toISOString().slice(0, 10) : "-"} -> ${sub?.expiryDate ? new Date(sub.expiryDate).toISOString().slice(0, 10) : "-"}`);
  console.log(`  Billing cycle     : ${sub?.billingCycle}  List: ${inr(sub?.listPricePaise ?? 0)}  Final: ${inr(sub?.finalPricePaise ?? 0)}`);
  console.log(`  Services snapshot : ${(sub?.serviceKeys ?? []).join(", ")}`);
  console.log(`  Access allowed    : ${access.allowed}`);
  if (!access.allowed) fail(`getSubscriptionAccess() returned allowed:false (${access.status})`);
  if (sub?.planId?.toString() !== planId) fail("subscription does not point at the Silver plan");
  if (JSON.stringify(sub?.serviceKeys) !== JSON.stringify(silver?.serviceKeys)) {
    fail("subscription service snapshot differs from the Silver plan");
  }

  // ---- Financial totals + breakdowns ------------------------------------
  console.log("\nFinancial totals");
  console.log(`  Total revenue     : ${inr(sums.grandTotal)}`);
  console.log(`  Total tax         : ${inr(sums.tax)}`);
  console.log(`  Total discounts   : ${inr(sums.discount)}`);
  console.log(`  Total service chr : ${inr(sums.serviceCharge)}`);
  console.log(`  Total round-off   : ${inr(sums.roundOff)}`);
  console.log(`  Total payments    : ${inr(paidTotal)}`);
  console.log(`  Orders            : ${orders} (cancelled ${cancelledOrders})`);
  console.log(`  Avg order value   : ${inr(Math.round(sums.grandTotal / Math.max(1, orders - cancelledOrders)))}`);

  console.log("\nMonthly revenue");
  const monthly = await BillModel.aggregate([
    { $match: { restaurantId: oid } },
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        revenue: { $sum: "$grandTotalPaise" },
        tax: { $sum: "$totalTaxPaise" },
        bills: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const row of monthly) {
    const label = `${monthNames[(row._id as { month: number }).month - 1]} ${(row._id as { year: number }).year}`;
    console.log(`  ${label.padEnd(9)}: ${inr(row.revenue as number).padStart(16)}   (${row.bills} bills, tax ${inr(row.tax as number)})`);
  }
  const monthCount = new Set(monthly.map((row) => (row._id as { month: number }).month)).size;
  if (monthCount !== 4) fail(`expected revenue in 4 distinct months, found ${monthCount}`);

  console.log("\nPayment breakdown");
  for (const method of ["UPI", "CASH", "CARD", "OTHER"]) {
    const row = paymentByMethod.find((p) => p._id === method);
    const total = (row?.total as number) ?? 0;
    const count = (row?.count as number) ?? 0;
    const share = paidTotal > 0 ? ((total / paidTotal) * 100).toFixed(1) : "0.0";
    console.log(`  ${method.padEnd(6)}: ${inr(total).padStart(16)}   ${String(count).padStart(5)} payments  ${share}%`);
  }
  if (new Set(paymentByMethod.map((p) => p._id)).size < 3) fail("payment methods are not varied enough");

  console.log("\nOrder breakdown");
  const byType = await OrderModel.aggregate([
    { $match: { restaurantId: oid } },
    { $group: { _id: "$orderType", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  for (const row of byType) {
    console.log(`  ${String(row._id).padEnd(10)}: ${row.count}`);
  }

  console.log("\nOrder statuses");
  for (const row of statusCounts) {
    console.log(`  ${String(row._id).padEnd(10)}: ${row.count}`);
  }

  // ---- 16: reports aggregate correctly ---------------------------------
  console.log("\nReporting checks");
  const topItems = await BillModel.aggregate([
    { $match: { restaurantId: oid } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.nameSnapshot",
        qty: { $sum: "$items.quantity" },
        revenue: { $sum: "$items.lineTotalPaise" },
      },
    },
    { $sort: { qty: -1 } },
    { $limit: 5 },
  ]);
  console.log(`  Best sellers      : ${topItems.map((i) => `${i._id} (${i.qty})`).join(", ")}`);
  if (topItems.length < 3) fail("not enough distinct items sold to populate a best-sellers report");

  const categorySplit = await BillModel.aggregate([
    { $match: { restaurantId: oid } },
    { $unwind: "$items" },
    { $lookup: { from: "menuitems", localField: "items.menuItemId", foreignField: "_id", as: "item" } },
    { $unwind: "$item" },
    { $lookup: { from: "menucategories", localField: "item.categoryId", foreignField: "_id", as: "cat" } },
    { $unwind: "$cat" },
    { $group: { _id: "$cat.name", revenue: { $sum: "$items.lineTotalPaise" } } },
    { $sort: { revenue: -1 } },
  ]);
  console.log(`  Category spread   : ${categorySplit.length} categories sold`);
  if (categorySplit.length < 8) fail(`only ${categorySplit.length} categories appear in sales`);

  const dailySales = await BillModel.aggregate([
    { $match: { restaurantId: oid } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+05:30" } }, revenue: { $sum: "$grandTotalPaise" } } },
  ]);
  console.log(`  Days with sales   : ${dailySales.length} of ${DAY_COUNT}`);
  if (dailySales.length < 90) fail(`only ${dailySales.length} trading days recorded`);

  const tableActivity = await OrderModel.aggregate([
    { $match: { restaurantId: oid, orderType: "DINE_IN" } },
    { $group: { _id: "$tableNameSnapshot", orders: { $sum: 1 }, revenue: { $sum: "$totalPaise" } } },
    { $sort: { orders: -1 } },
  ]);
  console.log(`  Tables with covers: ${tableActivity.length}`);
  if (tableActivity.length < EXPECTED_TABLE_COUNT) fail("not every table was used");

  const weekly = await BillModel.aggregate([
    { $match: { restaurantId: oid } },
    // Separate $project stages: `{ $isoWeek: ..., $isoWeekYear: ... }` inside one
    // object is parsed as a single expression document, which MongoDB rejects.
    { $project: { week: { $isoWeek: "$createdAt" } } },
    { $project: { week: 1, year: { $isoWeekYear: "$createdAt" } } },
    {
      $group: {
        _id: { week: "$week", year: "$year" },
        revenue: { $sum: "$grandTotalPaise" },
      },
    },
  ]);
  console.log(`  ISO weeks covered : ${weekly.length}`);

  // ---- 17/18: auth + SUPER_ADMIN untouched ------------------------------
  const { attemptLogin } = await import("@/lib/auth/login-service");
  const login = await attemptLogin({
    email: DEMO_OWNER_EMAIL,
    password: process.env.DEMO_SEED_PASSWORD as string,
  });
  const loginOk = login.ok && login.userId === ownerId && login.restaurantId === restaurantId;
  console.log(
    `\nDemo owner login   : ${loginOk ? "OK" : `FAILED (${login.ok ? login.userId : login.reason})`}`
  );
  if (!loginOk) fail("demo owner could not authenticate");

  // The account must be byte-identical to how it was found before seeding. A
  // scratch/dev database legitimately has no SUPER_ADMIN at all, so that case
  // is reported as "not present" rather than failed.
  const superAdminNow = await readSuperAdminFingerprint();
  if (!superAdminExistsBefore) {
    console.log(
      `SUPER_ADMIN         : absent before the run${superAdminNow ? " and appeared during it" : ""}`
    );
    if (superAdminNow) fail("a SUPER_ADMIN was created by the seed");
  } else {
    const superAdminOk =
      JSON.stringify(superAdminNow) === JSON.stringify(superAdminBefore);
    console.log(`SUPER_ADMIN intact  : ${superAdminOk ? "OK" : "CHANGED"}`);
    if (!superAdminOk) fail("the existing SUPER_ADMIN changed");
  }

  const silverCount = await PlanModel.countDocuments({ name: SILVER_PLAN_NAME });
  console.log(`Silver plan count   : ${silverCount} (must stay 1)`);
  if (silverCount !== 1) fail(`expected exactly 1 Silver plan, found ${silverCount}`);

  // ---- Result -----------------------------------------------------------
  console.log(`\nIDs: restaurant=${restaurantId} owner=${ownerId} plan=${planId} subscription=${subscriptionId}`);
  if (errors.length === 0) {
    console.log("\nAll 18 integrity checks passed.");
  } else {
    console.error("\nVERIFICATION FAILED:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    console.error(error);
    process.exit(1);
  });