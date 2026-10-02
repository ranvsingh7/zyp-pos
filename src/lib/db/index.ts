import "server-only";

import mongoose from "mongoose";

import { KotModel } from "@/models/KitchenOrderTicket";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { OrderModel } from "@/models/Order";
import { InventoryItemModel } from "@/models/InventoryItem";
import { InventoryCategoryModel } from "@/models/InventoryCategory";
import { PurchaseModel } from "@/models/Purchase";
import { StockMovementModel } from "@/models/StockMovement";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { SubscriptionPaymentModel } from "@/models/SubscriptionPayment";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { PlatformSettingsModel } from "@/models/PlatformSettings";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { TableSectionModel } from "@/models/TableSection";
import { RateLimitModel } from "@/models/RateLimit";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "restopos";

if (!MONGODB_URI) {
  throw new Error(
    "MONGODB_URI is not defined. Please set it in your .env.local file."
  );
}

const globalForMongo = globalThis as unknown as {
  mongoose?: typeof mongoose;
  syncIndexesRun?: boolean;
};

export async function connectDB(): Promise<typeof mongoose> {
  const globalCached = globalForMongo.mongoose;
  if (globalCached && globalCached.connection.readyState === 1) {
    return globalCached;
  }
  if (mongoose.connection.readyState === 1) {
    globalForMongo.mongoose = mongoose;
    return mongoose;
  }

  try {
    const connection = await mongoose.connect(MONGODB_URI as string, {
      dbName: MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });
    globalForMongo.mongoose = connection;
    await syncIndexesOnce();
    return connection;
  } catch {
    console.error("Failed to connect to MongoDB");
    throw new Error("Unable to connect to the database.");
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

async function syncIndexesOnce(): Promise<void> {
  if (globalForMongo.syncIndexesRun) return;
  globalForMongo.syncIndexesRun = true;
  try {
    // Legacy KOTs predate `claimKey`; give them a stable value so the unique
    // restaurantId+claimKey index can be built (and older one-KOT-per-order
    // indexes are dropped by syncIndexes).
    await KotModel.updateMany(
      { claimKey: { $exists: false } },
      [{ $set: { claimKey: { $concat: ["legacy-", { $toString: "$_id" }] } } }],
      { updatePipeline: true }
    );
    await KotModel.syncIndexes();
    await OrderModel.syncIndexes();
    await BillModel.syncIndexes();
    await PaymentModel.syncIndexes();
    await UserModel.syncIndexes();
    await RestaurantModel.syncIndexes();
    await RestaurantSettingsModel.syncIndexes();
    await MenuCategoryModel.syncIndexes();
    await MenuItemModel.syncIndexes();
    await MenuVariantModel.syncIndexes();
    await RestaurantTableModel.syncIndexes();
    await TableSectionModel.syncIndexes();
    await InventoryCategoryModel.syncIndexes();
    await InventoryItemModel.syncIndexes();
    await PurchaseModel.syncIndexes();
    await StockMovementModel.syncIndexes();
    await TableAuditLogModel.syncIndexes();
    await PlanModel.syncIndexes();
    await SubscriptionModel.syncIndexes();
    await SubscriptionHistoryModel.syncIndexes();
    await SubscriptionPaymentModel.syncIndexes();
    await PlatformCounterModel.syncIndexes();
    await PlatformSettingsModel.syncIndexes();
  await RateLimitModel.syncIndexes();
  } catch (error) {
    console.warn("Could not sync collection indexes:", error);
  }
}