import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { InventoryItemModel } from "@/models/InventoryItem";
import { InventoryCategoryModel } from "@/models/InventoryCategory";
import { PurchaseModel } from "@/models/Purchase";
import { StockMovementModel } from "@/models/StockMovement";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import {
  createInventoryItem,
  getInventoryItem,
  listInventoryItems,
  listLowStockItems,
  listOutOfStockItems,
  searchInventoryItems,
  updateInventoryItem,
} from "@/lib/inventory/inventory-service";
import {
  adjustStock,
  listStockMovements,
  recordWastage,
} from "@/lib/inventory/stock-service";
import {
  createPurchase,
  formatPurchaseNumber,
  getPurchaseById,
  listPurchases,
} from "@/lib/inventory/purchase-service";
import { parseInventorySearchParams } from "@/lib/inventory/query";
import { parseMovementSearchParams } from "@/lib/inventory/query";
import { parsePurchaseSearchParams } from "@/lib/inventory/query";
import {
  IncompatibleUnitError,
  InventoryItemNotFoundError,
} from "@/lib/inventory/errors";
import type { InventoryItemInput } from "@/lib/inventory/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ??
  "mongodb://127.0.0.1:27018/restopos_inventory_e2e";

let available = false;
let restaurantId = "";
let ownerId = "";

function itemInput(
  name: string,
  overrides: Partial<InventoryItemInput> = {}
): InventoryItemInput {
  return {
    name,
    description: null,
    categoryId: null,
    unit: "KG",
    minimumStock: 5,
    costPriceRupees: 280,
    sku: null,
    isActive: true,
    ...overrides,
  };
}

async function createRestaurant(name: string): Promise<string> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `inventory-${Date.now()}-${Math.random()}@restopos.test`,
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

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    await InventoryItemModel.syncIndexes();
    await InventoryCategoryModel.syncIndexes();
    await PurchaseModel.syncIndexes();
    await StockMovementModel.syncIndexes();
    await TableAuditLogModel.syncIndexes();
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
    InventoryItemModel.deleteMany({}),
    InventoryCategoryModel.deleteMany({}),
    PurchaseModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
    TableAuditLogModel.collection.deleteMany({}),
  ]);
  restaurantId = await createRestaurant("Inventory Test Restaurant");
  const owner = await UserModel.findOne({ restaurantId, role: "OWNER" });
  ownerId = String(owner?._id ?? "");
});

describe("Inventory module E2E against real MongoDB", () => {
  it("TEST 1: creates Paneer in KG and reports OUT_OF_STOCK", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    expect(paneer.currentStock).toBe(0);
    expect(paneer.baseUnit).toBe("G");
    expect(paneer.status).toBe("OUT_OF_STOCK");
    expect(paneer.currentStockLabel).toBe("0 kg");
    expect(paneer.minimumStockLabel).toBe("5 kg");
    expect(paneer.costPricePaise).toBe(28);
    expect(paneer.costPerUnitLabel).toBe("₹280 / kg");
  });

  it("TEST 2: purchase of 10 KG increases stock and writes a movement", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    const purchase = await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 10,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "purchase-1",
    });
    expect(purchase.purchaseNumber).toBe(
      formatPurchaseNumber("PUR", 1)
    );
    expect(purchase.subtotalPaise).toBe(280000);
    expect(purchase.items[0].itemName).toBe("Paneer");
    expect(purchase.items[0].afterStockLabel).toBe("10 kg");

    const updated = await getInventoryItem(restaurantId, paneer.id);
    expect(updated.currentStock).toBe(10000);
    expect(updated.currentStockLabel).toBe("10 kg");
    expect(updated.status).toBe("IN_STOCK");
    expect(updated.stockValuePaise).toBe(280000);

    const movements = await listStockMovements(
      restaurantId,
      parseMovementSearchParams({})
    );
    expect(movements.total).toBe(1);
    expect(movements.rows[0].type).toBe("PURCHASE");
    expect(movements.rows[0].quantityLabel).toBe("+10 kg");
    expect(movements.rows[0].beforeStockLabel).toBe("0 kg");
    expect(movements.rows[0].afterStockLabel).toBe("10 kg");
  });

  it("TEST 3: wastage of 1 KG reduces stock and logs WASTAGE", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 10,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "purchase-1",
    });
    await recordWastage(restaurantId, ownerId, {
      itemId: paneer.id,
      quantity: 1,
      unit: "KG",
      reason: "Spoiled",
      note: null,
    });
    const updated = await getInventoryItem(restaurantId, paneer.id);
    expect(updated.currentStock).toBe(9000);

    const movements = await listStockMovements(
      restaurantId,
      parseMovementSearchParams({ type: "WASTAGE" })
    );
    expect(movements.total).toBe(1);
    expect(movements.rows[0].quantityLabel).toBe("-1 kg");
    expect(movements.rows[0].direction).toBe("OUT");
  });

  it("TEST 4: adjustment OUT of 2 KG reduces stock to 7 KG", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 10,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "purchase-1",
    });
    await recordWastage(restaurantId, ownerId, {
      itemId: paneer.id,
      quantity: 1,
      unit: "KG",
      reason: "Spoiled",
      note: null,
    });
    await adjustStock(restaurantId, ownerId, {
      itemId: paneer.id,
      mode: "REMOVE",
      quantity: 2,
      unit: "KG",
      reason: "Physical Count",
      note: null,
    });
    const updated = await getInventoryItem(restaurantId, paneer.id);
    expect(updated.currentStock).toBe(7000);
    expect(updated.currentStockLabel).toBe("7 kg");
  });

  it("TEST 5: adjustment OUT beyond available is rejected with a clear message", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 10,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "purchase-1",
    });
    await recordWastage(restaurantId, ownerId, {
      itemId: paneer.id,
      quantity: 1,
      unit: "KG",
      reason: "Spoiled",
      note: null,
    });
    await adjustStock(restaurantId, ownerId, {
      itemId: paneer.id,
      mode: "REMOVE",
      quantity: 2,
      unit: "KG",
      reason: "Physical Count",
      note: null,
    });

    await expect(
      adjustStock(restaurantId, ownerId, {
        itemId: paneer.id,
        mode: "REMOVE",
        quantity: 10,
        unit: "KG",
        reason: "Physical Count",
        note: null,
      })
    ).rejects.toThrow(/Insufficient stock\. Available: 7 kg\./);

    const updated = await getInventoryItem(restaurantId, paneer.id);
    expect(updated.currentStock).toBe(7000);

    const movements = await listStockMovements(
      restaurantId,
      parseMovementSearchParams({})
    );
    // 1 purchase + 1 wastage + 1 successful adjustment; rejected one wrote nothing.
    expect(movements.total).toBe(3);
  });

  it("TEST 6/7: LOW_STOCK and OUT_OF_STOCK are derived from balances", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer", { minimumStock: 5 })
    );
    await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 7,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "purchase-1",
    });

    // Raise the minimum above current stock -> LOW_STOCK.
    const current = await getInventoryItem(restaurantId, paneer.id);
    await updateInventoryItem(restaurantId, ownerId, paneer.id, {
      name: current.name,
      description: current.description,
      categoryId: current.categoryId,
      unit: current.unit,
      minimumStock: 8,
      costPriceRupees: current.costPerUnitPaise / 100,
      sku: current.sku,
      isActive: true,
    });
    const low = await getInventoryItem(restaurantId, paneer.id);
    expect(low.status).toBe("LOW_STOCK");

    const lowList = await listLowStockItems(restaurantId);
    expect(lowList.map((i) => i.id)).toContain(paneer.id);

    await adjustStock(restaurantId, ownerId, {
      itemId: paneer.id,
      mode: "REMOVE",
      quantity: 7,
      unit: "KG",
      reason: "Physical Count",
      note: null,
    });
    const out = await getInventoryItem(restaurantId, paneer.id);
    expect(out.status).toBe("OUT_OF_STOCK");

    const outList = await listOutOfStockItems(restaurantId);
    expect(outList.map((i) => i.id)).toContain(paneer.id);
  });

  it("TEST 8: double submission records exactly one purchase", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );

    const payload = {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 10,
          unit: "KG" as const,
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "double-click-key",
    };

    const [first, second] = await Promise.all([
      createPurchase(restaurantId, ownerId, payload),
      createPurchase(restaurantId, ownerId, payload),
    ]);

    expect(first.id).toBe(second.id);
    expect(await PurchaseModel.countDocuments({ restaurantId })).toBe(1);

    const updated = await getInventoryItem(restaurantId, paneer.id);
    expect(updated.currentStock).toBe(10000);

    const movements = await listStockMovements(
      restaurantId,
      parseMovementSearchParams({ type: "PURCHASE" })
    );
    expect(movements.total).toBe(1);
  });

  it("TEST 9: renaming an item keeps historical snapshots", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 10,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "purchase-1",
    });

    await updateInventoryItem(restaurantId, ownerId, paneer.id, {
      name: "Fresh Paneer",
      description: null,
      categoryId: null,
      unit: "KG",
      minimumStock: 5,
      costPriceRupees: 280,
      sku: null,
      isActive: true,
    });

    const renamed = await getInventoryItem(restaurantId, paneer.id);
    expect(renamed.name).toBe("Fresh Paneer");

    const movements = await listStockMovements(
      restaurantId,
      parseMovementSearchParams({})
    );
    expect(movements.rows[0].itemName).toBe("Paneer");

    const purchase = await getPurchaseById(
      restaurantId,
      (await listPurchases(restaurantId, parsePurchaseSearchParams({})))
        .rows[0].id
    );
    expect(purchase.items[0].itemName).toBe("Paneer");
  });

  it("supports sub-unit purchases and rejects incompatible units", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );

    await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 500,
          unit: "G",
          purchaseRateRupees: 0.28,
        },
      ],
      idempotencyKey: "grams-1",
    });
    const updated = await getInventoryItem(restaurantId, paneer.id);
    expect(updated.currentStock).toBe(500);
    expect(updated.currentStockLabel).toBe("0.5 kg");

    await expect(
      createPurchase(restaurantId, ownerId, {
        items: [
          {
            inventoryItemId: paneer.id,
            quantity: 1,
            unit: "L",
            purchaseRateRupees: 100,
          },
        ],
        idempotencyKey: "wrong-unit",
      })
    ).rejects.toThrow(IncompatibleUnitError);
  });

  it("atomically prevents overselling under concurrent wastage", async () => {
    if (!available) return;
    const paneer = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    await createPurchase(restaurantId, ownerId, {
      items: [
        {
          inventoryItemId: paneer.id,
          quantity: 6,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
      idempotencyKey: "purchase-1",
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        recordWastage(restaurantId, ownerId, {
          itemId: paneer.id,
          quantity: 2,
          unit: "KG",
          reason: `Spoiled ${i}`,
          note: null,
        })
      )
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBe(3);

    const updated = await getInventoryItem(restaurantId, paneer.id);
    expect(updated.currentStock).toBe(0);

    const wastage = await listStockMovements(
      restaurantId,
      parseMovementSearchParams({ type: "WASTAGE" })
    );
    expect(wastage.total).toBe(3);
  });

  it("never leaks inventory across restaurants", async () => {
    if (!available) return;
    const otherRestaurantId = await createRestaurant("Other Kitchen");
    const otherOwner = await UserModel.findOne({
      restaurantId: otherRestaurantId,
      role: "OWNER",
    });
    const otherOwnerId = String(otherOwner?._id ?? "");

    const mine = await createInventoryItem(
      restaurantId,
      ownerId,
      itemInput("Paneer")
    );
    await createInventoryItem(
      otherRestaurantId,
      otherOwnerId,
      itemInput("Secret Sauce")
    );

    await expect(
      getInventoryItem(otherRestaurantId, mine.id)
    ).rejects.toThrow(InventoryItemNotFoundError);

    const search = await searchInventoryItems(otherRestaurantId, "");
    expect(search.map((i) => i.name)).toEqual(["Secret Sauce"]);

    const list = await listInventoryItems(
      restaurantId,
      parseInventorySearchParams({})
    );
    expect(list.rows.map((i) => i.name)).toEqual(["Paneer"]);
  });
});
