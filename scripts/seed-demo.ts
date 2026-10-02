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
import { rupeesToPaise } from "@/lib/menu/prices";

// Demo seed for local development.
//
// Usage:
//   npm run db:seed
//
// Creates (idempotently, safe to run repeatedly):
//   Owner   : demo@restopos.local  / Demo@1234  (OWNER, owns the demo restaurant)
//   Cashier : cashier@restopos.local / Demo@1234 (CASHIER, same restaurant)
//
// The demo restaurant "Demo Spice Kitchen" and its default settings are also
// created. A small demo menu (categories + items with variants) is populated
// the first time. Use `npm run db:reset` to remove the data.

const DEMO_PASSWORD = "Demo@1234";

async function hashDemoPassword(): Promise<string> {
  return argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

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

  // Safety: this writes demo restaurants, users and menu data with known
  // default passwords. Refuse a production target before connecting.
  guardDestructiveScriptOrExit({ operation: "seed", scriptName: "db:seed" });

  await mongoose.connect(uri, { dbName });

  const passwordHash = await hashDemoPassword();

  // 1. Demo owner user.
  let owner = await UserModel.findOne({ email: "demo@restopos.local" });
  if (owner) {
    console.log("Demo owner already exists.");
  } else {
    owner = await UserModel.create({
      fullName: "Demo Owner",
      email: "demo@restopos.local",
      passwordHash,
      phone: "9870000001",
      role: "OWNER",
      restaurantId: null,
      isActive: true,
    });
    console.log("Created demo owner: demo@restopos.local / Demo@1234");
  }
  const ownerId = String(owner._id);

  // 2. Demo restaurant.
  let restaurant = await RestaurantModel.findOne({ ownerId });
  if (!restaurant) {
    restaurant = await RestaurantModel.findOne({ name: "Demo Spice Kitchen" });
  }
  if (!restaurant) {
    restaurant = await RestaurantModel.create({
      name: "Demo Spice Kitchen",
      ownerId,
      phone: "9870000000",
      email: "demo@restopos.local",
      address: "1 MG Road",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      gstRegistered: true,
      gstin: "27AABCD0123A1Z5",
      businessType: "Restaurant",
      isActive: true,
    });
    console.log(`Created restaurant: ${restaurant.name} (${restaurant._id})`);
  } else {
    console.log(`Restaurant already exists: ${restaurant.name} (${restaurant._id})`);
  }

  const restaurantId = String(restaurant._id);

  // 3. Link owner to the restaurant (idempotent).
  if (String(owner.restaurantId ?? "") !== restaurantId) {
    await UserModel.updateOne(
      { _id: owner._id },
      { $set: { restaurantId, role: "OWNER" } }
    );
    console.log("Linked demo owner to restaurant.");
  }

  // 4. Restaurant settings (one per restaurant).
  if (!(await RestaurantSettingsModel.exists({ restaurantId }))) {
    await RestaurantSettingsModel.create({
      restaurantId,
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
    });
    console.log("Created restaurant settings for demo restaurant.");
  }

  // 5. Demo cashier (same restaurant - shows tenant isolation).
  if (!(await UserModel.exists({ email: "cashier@restopos.local" }))) {
    await UserModel.create({
      fullName: "Demo Cashier",
      email: "cashier@restopos.local",
      passwordHash,
      phone: "9870000002",
      role: "CASHIER",
      restaurantId,
      isActive: true,
    });
    console.log("Created demo cashier: cashier@restopos.local / Demo@1234");
  }

  // 6. Demo menu data.
  await seedMenuData(restaurantId);

  console.log("Seed complete.");
}

// ---- Menu seed helpers ----------------------------------------------------

interface VariantSpec {
  displayName: string;
  priceRupees: number;
  sizeValue: number | null;
  sizeUnit: string | null;
}

interface ItemSpec {
  name: string;
  vegType: "VEG" | "NON_VEG" | "EGG" | "NA";
  itemType: "FOOD" | "BEVERAGE" | "OTHER";
  hasVariants: boolean;
  basePriceRupees?: number;
  variants?: VariantSpec[];
}

interface CategorySpec {
  name: string;
  description: string;
  items: ItemSpec[];
}

const MENU_DEMO_DATA: CategorySpec[] = [
  {
    name: "Starters",
    description: "Appetisers and small plates",
    items: [],
  },
  {
    name: "Main Course",
    description: "Hearty curries and gravies",
    items: [
      {
        name: "Paneer Butter Masala",
        vegType: "VEG",
        itemType: "FOOD",
        hasVariants: true,
        variants: [
          { displayName: "Half", priceRupees: 180, sizeValue: null, sizeUnit: null },
          { displayName: "Full", priceRupees: 320, sizeValue: null, sizeUnit: null },
        ],
      },
    ],
  },
  {
    name: "Breads",
    description: "Tandoor-baked breads",
    items: [
      {
        name: "Tandoori Roti",
        vegType: "VEG",
        itemType: "FOOD",
        hasVariants: false,
        basePriceRupees: 25,
      },
      {
        name: "Butter Naan",
        vegType: "VEG",
        itemType: "FOOD",
        hasVariants: false,
        basePriceRupees: 60,
      },
    ],
  },
  {
    name: "Biryani & Rice",
    description: "Fragrant rice dishes",
    items: [
      {
        name: "Veg Biryani",
        vegType: "VEG",
        itemType: "FOOD",
        hasVariants: true,
        variants: [
          { displayName: "Half", priceRupees: 200, sizeValue: null, sizeUnit: null },
          { displayName: "Full", priceRupees: 350, sizeValue: null, sizeUnit: null },
        ],
      },
    ],
  },
  {
    name: "Beverages",
    description: "Cold and refreshing drinks",
    items: [
      {
        name: "Buttermilk",
        vegType: "VEG",
        itemType: "BEVERAGE",
        hasVariants: true,
        variants: [
          { displayName: "200 ml", priceRupees: 20, sizeValue: 200, sizeUnit: "ML" },
          { displayName: "500 ml", priceRupees: 35, sizeValue: 500, sizeUnit: "ML" },
          { displayName: "1 L", priceRupees: 60, sizeValue: 1, sizeUnit: "L" },
        ],
      },
      {
        name: "Cold Drink",
        vegType: "VEG",
        itemType: "BEVERAGE",
        hasVariants: true,
        variants: [
          { displayName: "250 ml", priceRupees: 20, sizeValue: 250, sizeUnit: "ML" },
          { displayName: "500 ml", priceRupees: 30, sizeValue: 500, sizeUnit: "ML" },
        ],
      },
    ],
  },
  {
    name: "Desserts",
    description: "Sweet endings",
    items: [],
  },
];

async function seedMenuData(restaurantId: string): Promise<void> {
  const existingCats = await MenuCategoryModel.countDocuments({ restaurantId });
  if (existingCats > 0) {
    console.log(`Menu already seeded (${existingCats} categories). Skipping.`);
    return;
  }

  console.log("Seeding demo menu categories and items…");

  let catOrder = 0;
  for (const catSpec of MENU_DEMO_DATA) {
    const cat = await MenuCategoryModel.create({
      restaurantId,
      name: catSpec.name,
      description: catSpec.description,
      displayOrder: catOrder++,
      isActive: true,
    });

    for (let i = 0; i < catSpec.items.length; i++) {
      const itemSpec = catSpec.items[i];
      const item = await MenuItemModel.create({
        restaurantId,
        categoryId: cat._id,
        name: itemSpec.name,
        description: null,
        itemType: itemSpec.itemType,
        vegType: itemSpec.vegType,
        imageUrl: null,
        hasVariants: itemSpec.hasVariants,
        basePrice: itemSpec.hasVariants ? null : rupeesToPaise(itemSpec.basePriceRupees ?? 0),
        isAvailable: true,
        isActive: true,
        displayOrder: i,
      });

      if (itemSpec.hasVariants && itemSpec.variants) {
        for (let j = 0; j < itemSpec.variants.length; j++) {
          const vs = itemSpec.variants[j];
          await MenuVariantModel.create({
            restaurantId,
            menuItemId: item._id,
            name: vs.displayName.trim().toUpperCase(),
            displayName: vs.displayName.trim(),
            price: rupeesToPaise(vs.priceRupees),
            description: null,
            sku: null,
            sizeValue: vs.sizeValue,
            sizeUnit: vs.sizeUnit as "ML" | "L" | "GM" | "KG" | "PCS" | null,
            displayOrder: j,
            isActive: true,
          });
        }
      }
    }
  }

  console.log("Demo menu seeded.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });