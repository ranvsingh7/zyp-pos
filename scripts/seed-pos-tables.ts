import { loadEnvConfig } from "@next/env";
import { guardDestructiveScriptOrExit } from "./lib/production-db-guard";
import mongoose from "mongoose";
import { RestaurantModel } from "@/models/Restaurant";
import { TableSectionModel } from "@/models/TableSection";
import { RestaurantTableModel } from "@/models/RestaurantTable";

// Seeds POS facing tables/sections for the demo restaurant.
//
// Usage: npm run tsx scripts/seed-pos-tables.ts
// Idempotent: sections/tables are created only if they don't already exist.

const DEMO_RESTAURANT_NAME = "Demo Spice Kitchen";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "restopos";
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }
  // Safety: writes demo sections/tables. Refuse a production target before
  // connecting.
  guardDestructiveScriptOrExit({ operation: "seed", scriptName: "seed-pos-tables" });

  await mongoose.connect(uri, { dbName });

  const restaurant = await RestaurantModel.findOne({ name: DEMO_RESTAURANT_NAME });
  if (!restaurant) {
    console.error(
      `Restaurant "${DEMO_RESTAURANT_NAME}" not found. Run npm run db:seed first.`
    );
    process.exit(1);
  }
  const restaurantId = String(restaurant._id);

  const sectionOrder = ["Main Dining", "Bar", "Outdoor"];
  const sections = new Map<string, string>();
  for (const name of sectionOrder) {
    const existing = await TableSectionModel.findOne({ restaurantId, name });
    if (existing) {
      sections.set(name, String(existing._id));
      console.log(`Section "${name}" already exists.`);
      continue;
    }
    const displayOrder = await TableSectionModel.countDocuments({ restaurantId });
    const doc = await TableSectionModel.create({
      restaurantId,
      name,
      displayOrder,
      isActive: true,
    });
    sections.set(name, String(doc._id));
    console.log(`Created section "${name}".`);
  }

  const tableSpecs: {
    name: string;
    capacity: number;
    section: string;
    status?: "AVAILABLE" | "RESERVED" | "OCCUPIED";
  }[] = [
    { name: "T1", capacity: 4, section: "Main Dining" },
    { name: "T2", capacity: 4, section: "Main Dining" },
    { name: "T3", capacity: 6, section: "Main Dining" },
    { name: "T4", capacity: 4, section: "Main Dining" },
    { name: "T5", capacity: 8, section: "Main Dining", status: "RESERVED" },
    { name: "B1", capacity: 2, section: "Bar" },
    { name: "B2", capacity: 2, section: "Bar" },
    { name: "O1", capacity: 6, section: "Outdoor" },
  ] as const;

  for (const spec of tableSpecs) {
    const existing = await RestaurantTableModel.findOne({
      restaurantId,
      name: spec.name,
    });
    if (existing) {
      console.log(`Table "${spec.name}" already exists.`);
      continue;
    }
    const displayOrder = await RestaurantTableModel.countDocuments({
      restaurantId,
    });
    await RestaurantTableModel.create({
      restaurantId,
      name: spec.name,
      capacity: spec.capacity,
      sectionId: sections.get(spec.section),
      status: spec.status ?? "AVAILABLE",
      isActive: true,
      displayOrder,
      position: null,
    });
    console.log(`Created table "${spec.name}".`);
  }

  await mongoose.disconnect();
  console.log("POS tables seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});