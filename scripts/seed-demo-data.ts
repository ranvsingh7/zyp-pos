//
// Rich, deterministic 30-day demo dataset for local development.
//
// Usage:
//   npm run db:seed:demo          # seed (idempotent, skips if already present)
//   npm run db:seed:demo:reset    # wipe the demo restaurant and reseed
//
// Creates a NEW demo restaurant ("ZYP POS Demo Restaurant") owned by
// demo@zyp-pos.local / Demo@1234 with:
//   - a ~56 item menu across 9 categories (with Half/Full & size variants)
//   - 3 floor sections and 10 tables
//   - inventory categories/items, backdated purchases, adjustments and wastage
//   - 30 days of realistic POS history (orders -> kitchen KOTs -> bills ->
//     payments, plus cancellations), generated with a seeded RNG so the data
//     is fully reproducible.
//
// Everything is generated through the production service layer (order-service,
// kot-service, bill-service, ...) rather than raw model writes, so invariants
// (order numbers, bill numbers, taxes, stock) come from the same code the app
// runs. Timestamps are then backdated to the simulated time.
//
// The seed is scoped to the demo restaurant only: --reset never touches
// restaurants/settings/users that were not created by this script.

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
import { InventoryCategoryModel } from "@/models/InventoryCategory";
import { InventoryItemModel } from "@/models/InventoryItem";
import { PurchaseModel } from "@/models/Purchase";
import { StockMovementModel } from "@/models/StockMovement";
import { OrderModel } from "@/models/Order";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { KotModel } from "@/models/KitchenOrderTicket";

import type { OrderType } from "@/lib/orders/constants";
import type { CreateOrderInput } from "@/lib/orders/validation";

// ---------------------------------------------------------------------------
// Demo identity
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = "Demo@1234";
const DEMO_RESTAURANT_NAME = "ZYP POS Demo Restaurant";
const DEMO_OWNER_EMAIL = "demo@zyp-pos.local";
const DEMO_MANAGER_EMAIL = "demo-manager@zyp-pos.local";
const DEMO_CASHIER_EMAIL = "demo-cashier@zyp-pos.local";
const DEMO_WAITER_EMAIL = "demo-waiter@zyp-pos.local";
const DEMO_EMAILS = [
  DEMO_OWNER_EMAIL,
  DEMO_MANAGER_EMAIL,
  DEMO_CASHIER_EMAIL,
  DEMO_WAITER_EMAIL,
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 3600 + 30 * 60) * 1000;
const SEED = 20240314;
const DAYS_BACK = 29;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
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
  return arr[Math.floor(rng() * arr.length)];
}

function pickMany<T>(rng: () => number, arr: readonly T[], count: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

function weighted<T>(rng: () => number, entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

// ---------------------------------------------------------------------------
// IST day helpers (Kolkata = UTC+5:30, no DST)
// ---------------------------------------------------------------------------

function istDayStart(dayOffset: number): number {
  const now = Date.now();
  const istNow = now + IST_OFFSET_MS;
  const istTodayStart = istNow - (istNow % DAY_MS);
  return istTodayStart - dayOffset * DAY_MS - IST_OFFSET_MS;
}

function timeInDay(dayStartMs: number, isoTime: string): Date {
  const [h, m] = isoTime.split(":").map(Number);
  return new Date(dayStartMs + (h * 60 + m) * 60_000);
}

// ---------------------------------------------------------------------------
// Menu + tables + inventory specs
// ---------------------------------------------------------------------------

interface VariantSpec {
  displayName: string;
  priceRupees: number;
  sizeValue?: number | null;
  sizeUnit?: string | null;
}

type MenuSizeUnit = "ML" | "L" | "GM" | "KG" | "PCS";

interface ItemSpec {
  name: string;
  vegType: "VEG" | "NON_VEG" | "EGG" | "NA";
  itemType: "FOOD" | "BEVERAGE" | "OTHER";
  basePriceRupees?: number;
  variants?: VariantSpec[];
}

interface CategorySpec {
  name: string;
  description: string;
  items: ItemSpec[];
}

const MENU_SPEC: CategorySpec[] = [
  {
    name: "Starters",
    description: "Shareable plates and crunchy bites",
    items: [
      { name: "Paneer Tikka", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 145 }, { displayName: "Full", priceRupees: 260 }] },
      { name: "Veg Manchurian", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 150 }, { displayName: "Full", priceRupees: 270 }] },
      { name: "Chicken 65", vegType: "NON_VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 180 }, { displayName: "Full", priceRupees: 320 }] },
      { name: "Gobi 65", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 130 }, { displayName: "Full", priceRupees: 230 }] },
      { name: "Crispy Corn", vegType: "VEG", itemType: "FOOD", basePriceRupees: 220 },
      { name: "Hara Bhara Kebab", vegType: "VEG", itemType: "FOOD", basePriceRupees: 210 },
      { name: "Tandoori Kebab Platter", vegType: "NON_VEG", itemType: "FOOD", basePriceRupees: 480 },
      { name: "Spring Rolls", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 100 }, { displayName: "Full", priceRupees: 180 }] },
    ],
  },
  {
    name: "Soups & Salads",
    description: "Light starters and fresh greens",
    items: [
      { name: "Tomato Soup", vegType: "VEG", itemType: "FOOD", basePriceRupees: 130 },
      { name: "Sweet Corn Veg Soup", vegType: "VEG", itemType: "FOOD", basePriceRupees: 140 },
      { name: "Hot & Sour Soup", vegType: "VEG", itemType: "FOOD", basePriceRupees: 150 },
      { name: "Fresh Green Salad", vegType: "VEG", itemType: "FOOD", basePriceRupees: 120 },
    ],
  },
  {
    name: "Breads & Rotis",
    description: "Tandoor-fired breads",
    items: [
      { name: "Tandoori Roti", vegType: "VEG", itemType: "FOOD", basePriceRupees: 30 },
      { name: "Butter Naan", vegType: "VEG", itemType: "FOOD", basePriceRupees: 60 },
      { name: "Garlic Naan", vegType: "VEG", itemType: "FOOD", basePriceRupees: 75 },
      { name: "Laccha Paratha", vegType: "VEG", itemType: "FOOD", basePriceRupees: 70 },
      { name: "Missi Roti", vegType: "VEG", itemType: "FOOD", basePriceRupees: 55 },
    ],
  },
  {
    name: "Biryani & Rice",
    description: "Slow-cooked fragrant rices",
    items: [
      { name: "Veg Biryani", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 210 }, { displayName: "Full", priceRupees: 380 }] },
      { name: "Chicken Biryani", vegType: "NON_VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 250 }, { displayName: "Full", priceRupees: 440 }] },
      { name: "Mutton Biryani", vegType: "NON_VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 320 }, { displayName: "Full", priceRupees: 560 }] },
      { name: "Egg Biryani", vegType: "EGG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 200 }, { displayName: "Full", priceRupees: 350 }] },
      { name: "Jeera Rice", vegType: "VEG", itemType: "FOOD", basePriceRupees: 170 },
      { name: "Steamed Rice", vegType: "VEG", itemType: "FOOD", basePriceRupees: 140 },
      { name: "Curd Rice", vegType: "VEG", itemType: "FOOD", basePriceRupees: 150 },
    ],
  },
  {
    name: "North Indian Curries",
    description: "Classic gravies and dals",
    items: [
      { name: "Paneer Butter Masala", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 220 }, { displayName: "Full", priceRupees: 390 }] },
      { name: "Kadai Paneer", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 210 }, { displayName: "Full", priceRupees: 370 }] },
      { name: "Palak Paneer", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 200 }, { displayName: "Full", priceRupees: 350 }] },
      { name: "Dal Makhani", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 180 }, { displayName: "Full", priceRupees: 320 }] },
      { name: "Chana Masala", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 160 }, { displayName: "Full", priceRupees: 290 }] },
      { name: "Butter Chicken", vegType: "NON_VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 250 }, { displayName: "Full", priceRupees: 450 }] },
      { name: "Chicken Curry", vegType: "NON_VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 220 }, { displayName: "Full", priceRupees: 390 }] },
      { name: "Veg Kofta", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 190 }, { displayName: "Full", priceRupees: 340 }] },
    ],
  },
  {
    name: "South Indian",
    description: "Dosas, idlis and vadas",
    items: [
      { name: "Masala Dosa", vegType: "VEG", itemType: "FOOD", basePriceRupees: 130 },
      { name: "Plain Dosa", vegType: "VEG", itemType: "FOOD", basePriceRupees: 100 },
      { name: "Ghee Roast Dosa", vegType: "VEG", itemType: "FOOD", basePriceRupees: 160 },
      { name: "Idli Sambhar (2 pcs)", vegType: "VEG", itemType: "FOOD", basePriceRupees: 90 },
      { name: "Medu Vada (2 pcs)", vegType: "VEG", itemType: "FOOD", basePriceRupees: 100 },
    ],
  },
  {
    name: "Chinese & Wok",
    description: "Hakka staples and wok-fried classics",
    items: [
      { name: "Veg Hakka Noodles", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 160 }, { displayName: "Full", priceRupees: 280 }] },
      { name: "Chicken Hakka Noodles", vegType: "NON_VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 190 }, { displayName: "Full", priceRupees: 330 }] },
      { name: "Veg Fried Rice", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 160 }, { displayName: "Full", priceRupees: 280 }] },
      { name: "Chicken Fried Rice", vegType: "NON_VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 190 }, { displayName: "Full", priceRupees: 330 }] },
      { name: "Chilli Paneer", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "Half", priceRupees: 210 }, { displayName: "Full", priceRupees: 380 }] },
    ],
  },
  {
    name: "Beverages",
    description: "Hot and cold drinks",
    items: [
      { name: "Masala Chai", vegType: "VEG", itemType: "BEVERAGE", variants: [{ displayName: "Small", priceRupees: 20, sizeValue: 200, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 30, sizeValue: 300, sizeUnit: "ML" }] },
      { name: "Filter Coffee", vegType: "VEG", itemType: "BEVERAGE", variants: [{ displayName: "Small", priceRupees: 30, sizeValue: 200, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 50, sizeValue: 300, sizeUnit: "ML" }] },
      { name: "Cold Coffee", vegType: "VEG", itemType: "BEVERAGE", variants: [{ displayName: "Small", priceRupees: 120, sizeValue: 250, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 160, sizeValue: 400, sizeUnit: "ML" }] },
      { name: "Mango Lassi", vegType: "VEG", itemType: "BEVERAGE", variants: [{ displayName: "Small", priceRupees: 80, sizeValue: 250, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 120, sizeValue: 400, sizeUnit: "ML" }] },
      { name: "Sweet Lassi", vegType: "VEG", itemType: "BEVERAGE", variants: [{ displayName: "Small", priceRupees: 60, sizeValue: 250, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 100, sizeValue: 400, sizeUnit: "ML" }] },
      { name: "Fresh Lime Soda", vegType: "VEG", itemType: "BEVERAGE", variants: [{ displayName: "Small", priceRupees: 70, sizeValue: 200, sizeUnit: "ML" }, { displayName: "Large", priceRupees: 100, sizeValue: 350, sizeUnit: "ML" }] },
      { name: "Cola", vegType: "VEG", itemType: "BEVERAGE", variants: [{ displayName: "250 ml", priceRupees: 25, sizeValue: 250, sizeUnit: "ML" }, { displayName: "500 ml", priceRupees: 45, sizeValue: 500, sizeUnit: "ML" }] },
      { name: "Mineral Water", vegType: "VEG", itemType: "BEVERAGE", basePriceRupees: 20 },
    ],
  },
  {
    name: "Desserts",
    description: "A sweet ending",
    items: [
      { name: "Gulab Jamun (2 pcs)", vegType: "VEG", itemType: "FOOD", basePriceRupees: 80 },
      { name: "Rasmalai", vegType: "VEG", itemType: "FOOD", basePriceRupees: 110 },
      { name: "Kulfi", vegType: "VEG", itemType: "FOOD", basePriceRupees: 90 },
      { name: "Ice Cream", vegType: "VEG", itemType: "FOOD", variants: [{ displayName: "1 Scoop", priceRupees: 70 }, { displayName: "2 Scoops", priceRupees: 130 }] },
      { name: "Brownie with Ice Cream", vegType: "VEG", itemType: "FOOD", basePriceRupees: 160 },
      { name: "Phirni", vegType: "VEG", itemType: "FOOD", basePriceRupees: 100 },
    ],
  },
];

const SECTION_SPEC = [
  { name: "Main Hall", tableCount: 4 },
  { name: "Garden", tableCount: 3 },
  { name: "Private", tableCount: 3 },
];

const INVENTORY_CATEGORY_SPEC = [
  { name: "Produce" },
  { name: "Dairy & Chilled" },
  { name: "Dry Goods" },
  { name: "Beverages" },
];

const INVENTORY_ITEM_SPEC = [
  { name: "Tomatoes", category: "Produce", unit: "KG" as const, minimumStock: 5, costPriceRupees: 40 },
  { name: "Onions", category: "Produce", unit: "KG" as const, minimumStock: 5, costPriceRupees: 35 },
  { name: "Potatoes", category: "Produce", unit: "KG" as const, minimumStock: 5, costPriceRupees: 30 },
  { name: "Basmati Rice", category: "Dry Goods", unit: "KG" as const, minimumStock: 8, costPriceRupees: 120 },
  { name: "Refined Oil", category: "Dry Goods", unit: "L" as const, minimumStock: 5, costPriceRupees: 130 },
  { name: "Milk", category: "Dairy & Chilled", unit: "L" as const, minimumStock: 10, costPriceRupees: 60 },
  { name: "Paneer", category: "Dairy & Chilled", unit: "KG" as const, minimumStock: 3, costPriceRupees: 340 },
  { name: "Chicken Breast", category: "Dairy & Chilled", unit: "KG" as const, minimumStock: 4, costPriceRupees: 320 },
  { name: "Eggs", category: "Dairy & Chilled", unit: "DOZEN" as const, minimumStock: 3, costPriceRupees: 90 },
  { name: "Sugar", category: "Dry Goods", unit: "KG" as const, minimumStock: 5, costPriceRupees: 45 },
  { name: "Tea & Coffee", category: "Beverages", unit: "PACK" as const, minimumStock: 4, costPriceRupees: 250 },
  { name: "Mineral Water (Case)", category: "Beverages", unit: "BOX" as const, minimumStock: 6, costPriceRupees: 240 },
];

const CUSTOMER_NAMES = [
  "Aarav Sharma",
  "Ishita Patel",
  "Rohan Mehta",
  "Sneha Iyer",
  "Arjun Nair",
  "Priya Reddy",
  "Vikram Joshi",
  "Ananya Gupta",
  "Karthik Subramanian",
  "Divya Krishnan",
  "Rahul Verma",
  "Sanya Kapoor",
  "Aditya Singh",
  "Meera Pillai",
  "Nikhil Rao",
];

const CANCEL_REASONS = [
  "Customer changed their mind",
  "Item unavailable",
  "Order placed by mistake",
  "Table left before service",
  "Long wait, order cancelled",
];

const PAYMENT_METHODS: Array<"CASH" | "UPI" | "CARD" | "OTHER"> = [
  "CASH",
  "CASH",
  "CASH",
  "UPI",
  "UPI",
  "UPI",
  "CARD",
  "CARD",
  "OTHER",
];

const SUPPLIERS = [
  "Sri Ganesh Traders",
  "Fresh Farms Produce",
  "Metro Wholesale",
  "Krishna Foods & Co",
  "Green Valley Mart",
  "Sharma Cold Storage",
];

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

// Duck-typed handle to any mongoose model for backdating timestamps. The
// concrete mongoose Model<T> types are structurally incompatible with each
// other (generic variance on bulkSave etc), so we accept anything with the
// updateOne method we rely on.
interface AnyMongooseModel {
  updateOne(
    filter: unknown,
    update: unknown,
    options?: unknown
  ): unknown;
  deleteMany(filter: unknown): { exec(): Promise<unknown> };
}

type AnyModel = AnyMongooseModel;

async function restamp(
  model: AnyModel,
  filter: Record<string, unknown>,
  patch: Record<string, unknown>
): Promise<void> {
  await model.updateOne(filter, { $set: patch }, { timestamps: false });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "restopos";

  if (!uri) {
    console.error(
      "MONGODB_URI is not set. Copy .env.example to .env.local and fill in your MongoDB connection string first."
    );
    process.exit(1);
  }

  const reset = process.argv.includes("--reset");

  // Safety: refuse a production target BEFORE opening a connection. `--reset`
  // permanently deletes every record belonging to the demo restaurant, and even
  // without it this script writes demo users, restaurants and menu data.
  guardDestructiveScriptOrExit({
    operation: reset ? "destructive" : "seed",
    scriptName: reset ? "db:seed:demo:reset" : "db:seed:demo",
  });

  await mongoose.connect(uri, { dbName, maxPoolSize: 1 });

  // Dynamic imports: service modules pull in db/index which reads MONGODB_URI
  // at import time (must run after loadEnvConfig) and import server-only.
  const catService = await import("@/lib/menu/category-service");
  const itemService = await import("@/lib/menu/item-service");
  const sectionService = await import("@/lib/tables/section-service");
  const tableService = await import("@/lib/tables/table-service");
  const invCatService = await import("@/lib/inventory/inventory-service");
  const invItemService = await import("@/lib/inventory/inventory-service");
  const purchaseService = await import("@/lib/inventory/purchase-service");
  const stockService = await import("@/lib/inventory/stock-service");
  const orderService = await import("@/lib/orders/order-service");
  const kotService = await import("@/lib/orders/kot-service");
  const billService = await import("@/lib/billing/bill-service");
  const restaurantService = await import("@/lib/restaurant-service");

  // Existing demo restaurant already seeded? Guard idempotency.
  const existingRestaurant = await RestaurantModel.findOne({
    name: DEMO_RESTAURANT_NAME,
  });

  if (existingRestaurant) {
    if (!reset) {
      console.log(
        `Demo restaurant "${DEMO_RESTAURANT_NAME}" already exists. Use ` +
          "`npm run db:seed:demo:reset` to wipe and reseed it."
      );
      await mongoose.disconnect();
      process.exit(0);
    }
    console.log(`--reset: wiping "${DEMO_RESTAURANT_NAME}" data…`);
    await wipeDemoData(String(existingRestaurant._id));
    console.log("Previous demo data removed.");
  }

  const rng = mulberry32(SEED);

  // ---- Users -------------------------------------------------------------

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  let owner = await UserModel.findOne({ email: DEMO_OWNER_EMAIL });
  if (!owner) {
    owner = await UserModel.create({
      fullName: "Zyp Demo Owner",
      email: DEMO_OWNER_EMAIL,
      passwordHash,
      phone: "9000000001",
      role: "OWNER",
      restaurantId: null,
      isActive: true,
    });
  }
  const ownerId = String(owner._id);

  // ---- Restaurant + settings --------------------------------------------

  const result = await restaurantService.createRestaurantForUser(ownerId, {
    name: DEMO_RESTAURANT_NAME,
    ownerName: "Zyp Demo Owner",
    phone: "9000000001",
    email: DEMO_OWNER_EMAIL,
    address: "12 MG Road, Brigade Road Area",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    gstRegistered: true,
    gstin: "29ABCDE1234F1Z5",
    businessType: "Restaurant",
  });
  const restaurantId = result.restaurantId;

  if (!restaurantId || result.userExists === false) {
    console.error("Failed to create demo restaurant for owner.");
    await mongoose.disconnect();
    process.exit(1);
  }

  await RestaurantSettingsModel.updateOne(
    { restaurantId },
    {
      $set: {
        currency: "INR",
        taxEnabled: true,
        defaultTaxRate: 5,
        taxInclusive: false,
        gstScheme: "INTRA_STATE",
        cgstRatePercent: 2.5,
        sgstRatePercent: 2.5,
        igstRatePercent: 5,
        serviceChargeEnabled: false,
        serviceChargeRate: 0,
        roundOffEnabled: false,
        billPrefix: "BILL",
        kotPrefix: "KOT",
        purchasePrefix: "PUR",
      },
    }
  );

  const manager = await createStaffUser(DEMO_MANAGER_EMAIL, "Zyp Demo Manager", "MANAGER", restaurantId, passwordHash);
  const cashier = await createStaffUser(DEMO_CASHIER_EMAIL, "Zyp Demo Cashier", "CASHIER", restaurantId, passwordHash);
  const waiter = await createStaffUser(DEMO_WAITER_EMAIL, "Zyp Demo Waiter", "WAITER", restaurantId, passwordHash);

  // Link owner to restaurant (createRestaurantForUser already does this).
  await UserModel.updateOne(
    { _id: ownerId },
    { $set: { restaurantId } }
  );

  console.log(`Seeding "${DEMO_RESTAURANT_NAME}" (${restaurantId})…`);

  // ---- Menu --------------------------------------------------------------

  const menuItems = await seedMenu(restaurantId, rng, {
    categoryService: catService,
    itemService,
  });

  // ---- Tables ------------------------------------------------------------

  const tableIds = await seedTables(restaurantId, rng, {
    sectionService,
    tableService,
  });

  // ---- Inventory ---------------------------------------------------------

  const inventoryOutcome = await seedInventory(
    restaurantId,
    ownerId,
    rng,
    {
      inventoryCategoryService: invCatService,
      inventoryItemService: invItemService,
      purchaseService,
      stockService,
    }
  );

  // ---- Orders across the last 30 days ------------------------------------

  const staff = [ownerId, manager, cashier, waiter];

  let totalOrders = 0;
  let totalCancelled = 0;
  const perDayCounts: number[] = [];

  for (let dayOffset = DAYS_BACK; dayOffset >= 0; dayOffset--) {
    const dayStart = istDayStart(dayOffset);
    const count = randInt(rng, 20, 25);
    const slots = pickUniqueMinutes(rng, count, dayOffset);
    let dayOrders = 0;

    for (const minute of slots) {
      const placedAt = new Date(dayStart + minute * 60_000);
      const user = pick(rng, staff);
      const orderType = weighted<OrderType>(rng, [
        ["DINE_IN", 60],
        ["TAKEAWAY", 25],
        ["QUICK_SALE", 15],
      ]);

      const lines = buildOrderLines(rng, menuItems, orderType);
      if (lines.length === 0) continue;

      const discountInput =
        orderType === "DINE_IN" && rng() < 0.25
          ? {
              discountType: "PERCENTAGE" as const,
              discountValue: pick(rng, [5, 8, 10, 12]),
              discountReason: pick(rng, [
                "Round off",
                "Birthday treat",
                "Promotion",
                "Regular guest",
              ]),
            }
          : undefined;

      const cancelled =
        orderType !== "QUICK_SALE" && dayOffset > 0 && rng() < 0.1;

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

      const orderView = await orderService.createOrder(
        restaurantId,
        user,
        orderInput
      );
      totalOrders++;

      if (cancelled) {
        totalCancelled++;
        dayOrders++;
        const cancelAtMs =
          placedAt.getTime() + randInt(rng, 5, 25) * 60_000;
        await orderService.cancelOrder(
          restaurantId,
          orderView.id,
          user,
          pick(rng, CANCEL_REASONS)
        );
        await restamp(OrderModel, { _id: orderView.id }, {
          createdAt: placedAt,
          updatedAt: new Date(cancelAtMs),
          cancelledAt: new Date(cancelAtMs),
        });
        continue;
      }

      dayOrders++;
      if (orderType !== "QUICK_SALE") {
        await orderService.sendOrderToKitchen(restaurantId, orderView.id);
        const printed = await kotService.printPendingKot(restaurantId, orderView.id, user);
        if (printed.kot) {
          await kotService.markKotSent(restaurantId, printed.kot.id);
          const kotTime = new Date(placedAt.getTime() + randInt(rng, 2, 5) * 60_000);
          await restamp(KotModel, { _id: printed.kot.id }, {
            createdAt: kotTime,
            updatedAt: kotTime,
            printedAt: kotTime,
          });
          await restamp(OrderModel, { _id: orderView.id }, {
            sentToKitchenAt: kotTime,
          });
        }
      }

      const bill = await billService.generateBill(
        restaurantId,
        orderView.id,
        user,
        discountInput
      );
      const billDelayMin =
        orderType === "DINE_IN"
          ? randInt(rng, 20, 45)
          : orderType === "TAKEAWAY"
            ? randInt(rng, 8, 15)
            : randInt(rng, 1, 3);
      const billAt = new Date(placedAt.getTime() + billDelayMin * 60_000);
      const paidAt = new Date(billAt.getTime() + randInt(rng, 0, 3) * 60_000);

      const method1 = pick(rng, PAYMENT_METHODS);
      const split = orderType === "DINE_IN" && rng() < 0.15;

      if (split) {
        const part = Math.round(bill.grandTotalPaise * (0.4 + rng() * 0.3));
        const method2 = pick(rng, PAYMENT_METHODS);
        await billService.recordPayment(restaurantId, bill.id, user, {
          method: method1,
          amountPaise: part,
          referenceNumber: paymentReference(rng, method1),
        });
        await billService.completePayment(restaurantId, bill.id, user, {
          method: method2,
          referenceNumber: paymentReference(rng, method2),
        });
      } else {
        await billService.completePayment(restaurantId, bill.id, user, {
          method: method1,
          referenceNumber: paymentReference(rng, method1),
        });
      }

      // Backdate everything to the simulated point in time.
      await restamp(OrderModel, { _id: orderView.id }, {
        createdAt: placedAt,
        updatedAt: paidAt,
        paidAt,
      });
      await restamp(BillModel, { _id: bill.id }, {
        createdAt: billAt,
        updatedAt: paidAt,
        paidAt,
      });
      const payments = await PaymentModel.find({ billId: bill.id });
      if (split && payments.length >= 2) {
        await restamp(PaymentModel, { _id: payments[0]._id }, {
          createdAt: billAt,
          updatedAt: billAt,
        });
        await restamp(PaymentModel, { _id: payments[1]._id }, {
          createdAt: paidAt,
          updatedAt: paidAt,
        });
      } else if (payments.length >= 1) {
        await restamp(PaymentModel, { _id: payments[0]._id }, {
          createdAt: paidAt,
          updatedAt: paidAt,
        });
      }
    }

    perDayCounts.push(dayOrders);
    console.log(
      `  day -${dayOffset}${dayOffset === 0 ? " (today)" : ""}: ${dayOrders} orders`
    );
  }

  console.log(
    `Seeded ${totalOrders} orders (${totalCancelled} cancelled) across ${perDayCounts.length} days.`
  );

  const summary: Record<string, string> = {
    ...inventoryOutcome,
    "menu categories": String(await MenuCategoryModel.countDocuments({ restaurantId })),
    "menu items": String(await MenuItemModel.countDocuments({ restaurantId })),
    tables: String(await RestaurantTableModel.countDocuments({ restaurantId })),
    orders: String(await OrderModel.countDocuments({ restaurantId })),
    bills: String(await BillModel.countDocuments({ restaurantId })),
    payments: String(await PaymentModel.countDocuments({ restaurantId })),
    kots: String(await KotModel.countDocuments({ restaurantId })),
  };

  console.log("Seed summary:");
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${v}`);
  }

  await verify(restaurantId);

  await mongoose.disconnect();
  console.log("Done.");
}

async function createStaffUser(
  email: string,
  fullName: string,
  role: "OWNER" | "MANAGER" | "CASHIER" | "WAITER",
  restaurantId: string,
  passwordHash: string
): Promise<string> {
  let user = await UserModel.findOne({ email });
  if (!user) {
    user = await UserModel.create({
      fullName,
      email,
      passwordHash,
      phone: "9000000099",
      role,
      restaurantId,
      isActive: true,
    });
  }
  return String(user._id);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

async function seedMenu(
  restaurantId: string,
  rng: () => number,
  deps: {
    categoryService: typeof import("@/lib/menu/category-service");
    itemService: typeof import("@/lib/menu/item-service");
  }
): Promise<
  Array<{
    menuItemId: string;
    variantId: string | null;
    pricePaise: number;
    itemType: "FOOD" | "BEVERAGE" | "OTHER";
    vegType: "VEG" | "NON_VEG" | "EGG" | "NA";
    displayName: string;
  }>
> {
  const lines: Array<{
    menuItemId: string;
    variantId: string | null;
    pricePaise: number;
    itemType: "FOOD" | "BEVERAGE" | "OTHER";
    vegType: "VEG" | "NON_VEG" | "EGG" | "NA";
    displayName: string;
  }> = [];

  for (const cat of MENU_SPEC) {
    const catView = await deps.categoryService.createCategory(restaurantId, {
      name: cat.name,
      description: cat.description,
      isActive: true,
    });
    const categoryId = catView.id;

    for (const itemSpec of cat.items) {
      const itemView = await deps.itemService.createMenuItem(restaurantId, {
        name: itemSpec.name,
        description: `${itemSpec.name} – ${cat.name}`,
        categoryId,
        itemType: itemSpec.itemType,
        vegType: itemSpec.vegType,
        hasVariants: Array.isArray(itemSpec.variants) && itemSpec.variants.length > 0,
        basePriceRupees: itemSpec.basePriceRupees ?? null,
        isAvailable: true,
        isActive: true,
        variants: itemSpec.variants?.map((v) => ({
          displayName: v.displayName,
          priceRupees: v.priceRupees,
          sizeValue: v.sizeValue ?? null,
          sizeUnit:
            (v.sizeUnit as MenuSizeUnit | null | undefined) ?? null,
          displayOrder: 0,
          isActive: true,
        })) ?? [],
      });

      if (itemView.hasVariants) {
        for (const v of itemView.variants) {
          lines.push({
            menuItemId: itemView.id,
            variantId: v.id,
            pricePaise: v.pricePaise,
            itemType: itemView.itemType as "FOOD" | "BEVERAGE" | "OTHER",
            vegType: itemView.vegType as "VEG" | "NON_VEG" | "EGG" | "NA",
            displayName: v.displayName,
          });
        }
      } else {
        lines.push({
          menuItemId: itemView.id,
          variantId: null,
          pricePaise: itemView.basePrice ?? 0,
          itemType: itemView.itemType as "FOOD" | "BEVERAGE" | "OTHER",
          vegType: itemView.vegType as "VEG" | "NON_VEG" | "EGG" | "NA",
          displayName: itemView.name,
        });
      }
      void rng;
    }
  }

  return lines;
}

function buildOrderLines(
  rng: () => number,
  menuLines: Array<{
    menuItemId: string;
    variantId: string | null;
    pricePaise: number;
    itemType: "FOOD" | "BEVERAGE" | "OTHER";
    vegType: "VEG" | "NON_VEG" | "EGG" | "NA";
    displayName: string;
  }>,
  orderType: OrderType
): Array<{ menuItemId: string; variantId: string | null; quantity: number; pricePaise: number }> {
  const maxLines = orderType === "DINE_IN" ? randInt(rng, 2, 5) : orderType === "TAKEAWAY" ? randInt(rng, 1, 4) : 1;
  const chosen = pickMany(rng, menuLines, maxLines);
  return chosen.map((c) => ({
    menuItemId: c.menuItemId,
    variantId: c.variantId,
    quantity: weighted(rng, [[1, 70], [2, 25], [3, 5]]),
    pricePaise: c.pricePaise,
  }));
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

async function seedTables(
  restaurantId: string,
  rng: () => number,
  deps: {
    sectionService: typeof import("@/lib/tables/section-service");
    tableService: typeof import("@/lib/tables/table-service");
  }
): Promise<string[]> {
  const tableIds: string[] = [];
  for (const section of SECTION_SPEC) {
    const sectionView = await deps.sectionService.createSection(restaurantId, {
      name: section.name,
      isActive: true,
    });
    for (let i = 1; i <= section.tableCount; i++) {
      const tableView = await deps.tableService.createTable(restaurantId, {
        name: `${section.name.slice(0, 3).toUpperCase()}-${i}`,
        capacity: randInt(rng, 2, 8),
        sectionId: sectionView.id,
        status: "AVAILABLE",
        isActive: true,
      });
      tableIds.push(tableView.id);
    }
  }
  return tableIds;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

async function seedInventory(
  restaurantId: string,
  userId: string,
  rng: () => number,
  deps: {
    inventoryCategoryService: typeof import("@/lib/inventory/inventory-service");
    inventoryItemService: typeof import("@/lib/inventory/inventory-service");
    purchaseService: typeof import("@/lib/inventory/purchase-service");
    stockService: typeof import("@/lib/inventory/stock-service");
  }
): Promise<Record<string, string>> {
  for (const cat of INVENTORY_CATEGORY_SPEC) {
    await deps.inventoryCategoryService.createInventoryCategory(restaurantId, {
      name: cat.name,
      isActive: true,
    });
  }

  const catByName = new Map<string, string>();
  const invItems = await InventoryCategoryModel.find({ restaurantId }).lean();
  for (const c of invItems) {
    catByName.set(c.name as string, String(c._id));
  }

  const itemIdByName = new Map<string, string>();
  for (const item of INVENTORY_ITEM_SPEC) {
    const view = await deps.inventoryItemService.createInventoryItem(restaurantId, userId, {
      name: item.name,
      categoryId: catByName.get(item.category) ?? undefined,
      unit: item.unit,
      minimumStock: item.minimumStock,
      costPriceRupees: item.costPriceRupees,
      isActive: true,
    });
    itemIdByName.set(item.name, view.id);
  }

  // Purchases spread across the last 30 days.
  const purchaseDays = pickMany(rng, [2, 5, 8, 12, 15, 18, 21, 24, 27], 8).sort((a, b) => a - b);
  let purchaseCount = 0;

  for (const day of purchaseDays) {
    const invoiceNumber = `INV-${String(202600 + day)}`;
    const items = pickMany(rng, INVENTORY_ITEM_SPEC, randInt(rng, 2, 4));
    const purchaseDate = timeInDay(
      istDayStart(day),
      `${randInt(rng, 6, 9)}:00`
    );

    await deps.purchaseService.createPurchase(restaurantId, userId, {
      supplierName: pick(rng, SUPPLIERS),
      invoiceNumber,
      purchaseDate,
      items: items.map((it) => ({
        inventoryItemId: itemIdByName.get(it.name) as string,
        quantity: randInt(rng, 5, 25),
        unit: it.unit,
        purchaseRateRupees: it.costPriceRupees,
      })),
      notes: "Weekly stock top-up",
    });

    // Backdate the purchase + its movements.
    const purchaseDoc = await PurchaseModel.findOne({
      restaurantId,
      invoiceNumber,
    });
    if (purchaseDoc) {
      await restamp(PurchaseModel, { _id: purchaseDoc._id }, {
        createdAt: purchaseDate,
        updatedAt: purchaseDate,
      });
      await StockMovementModel.updateMany(
        { restaurantId, referenceId: String(purchaseDoc._id) },
        { $set: { createdAt: purchaseDate, updatedAt: purchaseDate } }
      );
    }
    purchaseCount++;
  }

  // A couple of stock movements for realism.
  const milkId = itemIdByName.get("Milk");
  const riceId = itemIdByName.get("Basmati Rice");
  if (milkId) {
    const wastage = await deps.stockService.recordWastage(restaurantId, userId, {
      itemId: milkId,
      quantity: 3,
      unit: "L",
      reason: "Spoiled",
    });
    const wAt = timeInDay(istDayStart(4), "20:00");
    await StockMovementModel.updateOne(
      { _id: wastage.movementId },
      { $set: { createdAt: wAt, updatedAt: wAt } }
    );
  }
  if (riceId) {
    await deps.stockService.adjustStock(restaurantId, userId, {
      itemId: riceId,
      mode: "ADD",
      quantity: 10,
      unit: "KG",
      reason: "Physical Count",
    });
  }

  return {
    "inventory categories": String(await InventoryCategoryModel.countDocuments({ restaurantId })),
    "inventory items": String(await InventoryItemModel.countDocuments({ restaurantId })),
    "inventory purchases": String(purchaseCount),
    "inventory movements": String(await StockMovementModel.countDocuments({ restaurantId })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickUniqueMinutes(
  rng: () => number,
  count: number,
  dayOffset: number
): number[] {
  // Open 11:00 - 22:30. For "today", cap at the current IST minute so we
  // never create orders in the future.
  const openMin = 11 * 60;
  let closeMin = 22 * 60 + 30;
  if (dayOffset === 0) {
    const nowISTMinutes = Math.floor((Date.now() + IST_OFFSET_MS) % DAY_MS / 60_000);
    closeMin = Math.min(closeMin, Math.max(openMin + 10, nowISTMinutes - 2));
  }
  const pool: number[] = [];
  for (let m = openMin; m <= closeMin; m++) pool.push(m);
  // Sample a spread of slots deterministically.
  const chosen: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  chosen.sort((a, b) => a - b);
  return chosen;
}

function paymentReference(rng: () => number, method: string): string | undefined {
  if (method === "UPI") return `UPI${randInt(rng, 1000000000, 9999999999)}`;
  if (method === "CARD") return `CARD-${randInt(rng, 1000, 9999)}`;
  if (method === "OTHER") return `REF-${randInt(rng, 100000, 999999)}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Wipe (scoped to the demo restaurant)
// ---------------------------------------------------------------------------

async function wipeDemoData(restaurantId: string): Promise<void> {
  const tenantModels: Array<[AnyModel, Record<string, unknown>]> = [
    [MenuCategoryModel, { restaurantId }],
    [MenuItemModel, { restaurantId }],
    [MenuVariantModel, { restaurantId }],
    [TableSectionModel, { restaurantId }],
    [RestaurantTableModel, { restaurantId }],
    [InventoryCategoryModel, { restaurantId }],
    [InventoryItemModel, { restaurantId }],
    [PurchaseModel, { restaurantId }],
    [StockMovementModel, { restaurantId }],
    [OrderModel, { restaurantId }],
    [BillModel, { restaurantId }],
    [PaymentModel, { restaurantId }],
    [KotModel, { restaurantId }],
    [RestaurantSettingsModel, { restaurantId }],
  ];

  await Promise.all(
    tenantModels.map(([model, filter]) => model.deleteMany(filter).exec())
  );

  await UserModel.deleteMany({ email: { $in: DEMO_EMAILS } });
  await RestaurantModel.deleteMany({ _id: restaurantId });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verify(restaurantId: string): Promise<void> {
  console.log("Verifying seeded data…");
  const errors: string[] = [];

  const [menuItems, orders, bills, payments, kots, tables, sections] =
    await Promise.all([
      MenuItemModel.countDocuments({ restaurantId }),
      OrderModel.countDocuments({ restaurantId }),
      BillModel.countDocuments({ restaurantId }),
      PaymentModel.countDocuments({ restaurantId }),
      KotModel.countDocuments({ restaurantId }),
      RestaurantTableModel.countDocuments({ restaurantId }),
      TableSectionModel.countDocuments({ restaurantId }),
    ]);

  if (sections !== 3) errors.push(`expected 3 sections, got ${sections}`);
  if (tables !== 10) errors.push(`expected 10 tables, got ${tables}`);
  if (menuItems < 50 || menuItems > 60)
    errors.push(`expected 50-60 menu items, got ${menuItems}`);
  // 29 full days × 20-25 orders + a (possibly partial) "today" capped by the
  // current time -> band must tolerate a short first/last day.
  if (orders < 560 || orders > 760)
    errors.push(`unexpected order volume (${orders}); want ~560-760`);

  // Every order must have exactly one bill (cancelled orders excepted).
  const cancelled = await OrderModel.countDocuments({
    restaurantId,
    status: "CANCELLED",
  });
  const expectedBills = orders - cancelled;
  if (bills !== expectedBills)
    errors.push(`expected ${expectedBills} bills, got ${bills}`);

  // All bills must be PAID.
  const unpaid = await BillModel.countDocuments({
    restaurantId,
    status: { $ne: "PAID" },
  });
  if (unpaid !== 0) errors.push(`found ${unpaid} unpaid bills`);

  // Payments must sum exactly to the bills' grand totals (paid in full).
  const [billsAgg, paymentsAgg] = await Promise.all([
    BillModel.aggregate([
      { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
      { $group: { _id: null, total: { $sum: "$grandTotalPaise" } } },
    ]),
    PaymentModel.aggregate([
      { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
      { $group: { _id: null, total: { $sum: "$amountPaise" } } },
    ]),
  ]);
  const billTotal = billsAgg[0]?.total ?? 0;
  const paymentTotal = paymentsAgg[0]?.total ?? 0;
  if (billTotal !== paymentTotal) {
    errors.push(
      `revenue mismatch: bills ₹${(billTotal / 100).toFixed(2)} vs payments ₹${(paymentTotal / 100).toFixed(2)}`
    );
  }

  // Order numbers must be unique and start at 1001.
  const orderNumbers = await OrderModel.find({ restaurantId })
    .select("orderNumber")
    .sort({ orderNumber: 1 })
    .lean();
  const onSet = new Set(orderNumbers.map((o) => o.orderNumber));
  if (onSet.size !== orderNumbers.length)
    errors.push("duplicate order numbers found");
  if (orderNumbers[0]?.orderNumber !== 1001)
    errors.push(`first order number is ${orderNumbers[0]?.orderNumber}, expected 1001`);

  // Bill numbers must be unique.
  const billNumbers = await BillModel.find({ restaurantId })
    .select("billNumber")
    .lean();
  const bnSet = new Set(billNumbers.map((b) => b.billNumber));
  if (bnSet.size !== billNumbers.length)
    errors.push("duplicate bill numbers found");

  // Cancellation rate sanity (5-15% of non-quick-sale orders).
  const cancellationRate = orders ? (cancelled / orders) * 100 : 0;
  if (cancellationRate < 5 || cancellationRate > 15)
    errors.push(`cancellation rate ${cancellationRate.toFixed(1)}% out of 5-15% range`);

  if (errors.length === 0) {
    console.log("All verification checks passed ✓");
  } else {
    console.error("VERIFICATION FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
  }

  console.log(
    `  orders=${orders} cancelled=${cancelled} bills=${bills} payments=${payments} kots=${kots}`
  );
  console.log(`  revenue: ₹${(billTotal / 100).toFixed(2)}`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    console.error(error);
    process.exit(1);
  });