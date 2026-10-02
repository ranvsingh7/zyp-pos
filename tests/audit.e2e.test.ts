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
import { InventoryItemModel } from "@/models/InventoryItem";
import { InventoryCategoryModel } from "@/models/InventoryCategory";
import { PurchaseModel } from "@/models/Purchase";
import { StockMovementModel } from "@/models/StockMovement";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import { createMenuItem } from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import { createOrder, cancelOrder, getOrder } from "@/lib/orders/order-service";
import { generateBill, recordPayment, cancelBill } from "@/lib/billing/bill-service";
import { BillValidationError } from "@/lib/billing/errors";
import { createInventoryItem } from "@/lib/inventory/inventory-service";
import {
  createPurchase,
  reversePurchase,
} from "@/lib/inventory/purchase-service";
import { PurchaseValidationError } from "@/lib/inventory/errors";
import { assertNotDeletable, ProtectedRecordError } from "@/lib/audit/delete-protection";
import { listAuditLogs } from "@/lib/audit/audit-service";
import type { MenuItemInput } from "@/lib/menu/validation";
import type { TableInput } from "@/lib/tables/validation";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_audit_e2e";

let available = false;
let restaurantId = "";
let ownerId = "";

async function createRestaurant(name: string): Promise<string> {
  return UserModel.create({
    fullName: "Owner",
    email: `audit-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
  }).then(async (user) => {
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
  });
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

async function seedMenuAndTable() {
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
  return { plain, t1 };
}

async function dineInOrder(menuItemId: string, tableId: string) {
  return createOrder(restaurantId, ownerId, {
    orderType: "DINE_IN",
    tableId,
    items: [{ menuItemId, quantity: 1 }],
  });
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
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
    MenuCategoryModel.deleteMany({}),
    MenuItemModel.deleteMany({}),
    MenuVariantModel.deleteMany({}),
    RestaurantTableModel.deleteMany({}),
    TableSectionModel.deleteMany({}),
    OrderModel.deleteMany({}),
    KotModel.deleteMany({}),
    BillModel.deleteMany({}),
    PaymentModel.deleteMany({}),
    InventoryItemModel.deleteMany({}),
    InventoryCategoryModel.deleteMany({}),
    PurchaseModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
    TableAuditLogModel.collection.deleteMany({}),
  ]);
  restaurantId = await createRestaurant("Audit Test Restaurant");
  const owner = await UserModel.findOne({ restaurantId, role: "OWNER" });
  ownerId = String(owner?._id ?? "");
});

describe("Security hardening + audit trail E2E against real MongoDB", () => {
  it(
    "audits a cancelled order with actor, role and before/after snapshots",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedMenuAndTable();
      const order = await dineInOrder(plain.id, t1.id);
      await cancelOrder(restaurantId, order.id, ownerId, "Customer changed mind");

      const cancelled = await getOrder(restaurantId, order.id);
      expect(cancelled?.status).toBe("CANCELLED");

      const created = await TableAuditLogModel.findOne({
        restaurantId,
        action: "ORDER_CREATED",
        entityType: "ORDER",
        entityId: order.id,
      }).lean();
      expect(created).not.toBeNull();
      expect(created!.actorRole).toBe("OWNER");
      expect(String(created!.userId)).toBe(ownerId);
      expect(created!.success).toBe(true);

      const cancelledLog = await TableAuditLogModel.findOne({
        restaurantId,
        action: "ORDER_CANCELLED",
        entityType: "ORDER",
        entityId: order.id,
      }).lean();
      expect(cancelledLog).not.toBeNull();
      expect((cancelledLog?.before as Record<string, unknown> | undefined)?.status).toBe("OPEN");
      expect((cancelledLog?.after as Record<string, unknown> | undefined)?.status).toBe("CANCELLED");
    },
    30000
  );

  it(
    "soft-cancels a bill (record stays), and a paid bill cannot be cancelled",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedMenuAndTable();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, ownerId);

      const cancelled = await cancelBill(restaurantId, bill.id, ownerId, "Wrong service");
      expect(cancelled.status).toBe("CANCELLED");

      // The bill was never deleted.
      expect(await BillModel.exists({ _id: bill.id, restaurantId })).toBeTruthy();
      const log = await TableAuditLogModel.findOne({
        restaurantId,
        action: "BILL_CANCELLED",
        entityId: bill.id,
      }).lean();
      expect(log).not.toBeNull();

      // A paid bill rejects cancellation.
      const t2 = await createTable(restaurantId, table("T2"));
      const order2 = await dineInOrder(plain.id, t2.id);
      const bill2 = await generateBill(restaurantId, order2.id, ownerId);
      await recordPayment(restaurantId, bill2.id, ownerId, {
        method: "CASH",
        amountPaise: bill2.grandTotalPaise,
      });
      await expect(
        cancelBill(restaurantId, bill2.id, ownerId, "oops")
      ).rejects.toThrow(BillValidationError);

      const log2 = await TableAuditLogModel.findOne({
        restaurantId,
        action: "BILL_PAID",
        entityId: bill2.id,
      }).lean();
      expect(log2).not.toBeNull();
    },
    30000
  );

  it(
    "payment protection: physical deletes are blocked and logged as DELETE_ATTEMPT",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedMenuAndTable();
      const order = await dineInOrder(plain.id, t1.id);
      const bill = await generateBill(restaurantId, order.id, ownerId);
      await recordPayment(restaurantId, bill.id, ownerId, {
        method: "CASH",
        amountPaise: bill.grandTotalPaise,
      });

      const payment = await PaymentModel.findOne({ restaurantId, billId: bill.id }).lean();
      expect(payment).not.toBeNull();

      await expect(
        assertNotDeletable("PAYMENT", String(payment?._id), {
          restaurantId,
          actorUserId: ownerId,
          reason: "Manual hard-delete attempt.",
        })
      ).rejects.toThrow(ProtectedRecordError);

      // The ledger entry is still there.
      expect(await PaymentModel.exists({ _id: payment?._id, restaurantId })).toBeTruthy();
      const log = await TableAuditLogModel.findOne({
        restaurantId,
        action: "DELETE_ATTEMPT",
        entityType: "PAYMENT",
      }).lean();
      expect(log).not.toBeNull();
      expect(log!.success).toBe(false);
    },
    30000
  );

  it(
    "order protection mirrors the same guard (rejects + logs)",
    async () => {
      if (!available) return;
      const { plain, t1 } = await seedMenuAndTable();
      const order = await dineInOrder(plain.id, t1.id);

      await expect(
        assertNotDeletable("ORDER", order.id, {
          restaurantId,
          actorUserId: ownerId,
        })
      ).rejects.toThrow(ProtectedRecordError);

      expect(await OrderModel.exists({ _id: order.id, restaurantId })).toBeTruthy();
      const log = await TableAuditLogModel.findOne({
        restaurantId,
        action: "DELETE_ATTEMPT",
        entityType: "ORDER",
        entityId: order.id,
      }).lean();
      expect(log).not.toBeNull();
    },
    30000
  );

  it(
    "stock movement protection: append-only ledger, DELETE_ATTEMPT on delete",
    async () => {
      if (!available) return;
      const paneer = await createInventoryItem(restaurantId, ownerId, {
        name: "Paneer",
        description: null,
        categoryId: null,
        unit: "KG",
        minimumStock: 5,
        costPriceRupees: 280,
        sku: null,
        isActive: true,
      });
      const purchase = await createPurchase(restaurantId, ownerId, {
        items: [
          {
            inventoryItemId: paneer.id,
            quantity: 10,
            unit: "KG",
            purchaseRateRupees: 280,
          },
        ],
        idempotencyKey: "audit-purchase-1",
      });

      const movement = await StockMovementModel.findOne({
        restaurantId,
        inventoryItemId: paneer.id,
      }).lean();
      expect(movement).not.toBeNull();

      await expect(
        assertNotDeletable("STOCK_MOVEMENT", String(movement?._id), {
          restaurantId,
          actorUserId: ownerId,
        })
      ).rejects.toThrow(ProtectedRecordError);

      expect(await StockMovementModel.exists({ _id: movement?._id, restaurantId })).toBeTruthy();
      const log = await TableAuditLogModel.findOne({
        restaurantId,
        action: "DELETE_ATTEMPT",
        entityType: "STOCK_MOVEMENT",
      }).lean();
      expect(log).not.toBeNull();

      // Purchase still exists too.
      expect(
        await PurchaseModel.exists({ _id: purchase.id, restaurantId })
      ).toBeTruthy();
    },
    30000
  );

  it(
    "soft-reverses a purchase (POSTED -> REVERSED) and returns stock",
    async () => {
      if (!available) return;
      const paneer = await createInventoryItem(restaurantId, ownerId, {
        name: "Paneer",
        description: null,
        categoryId: null,
        unit: "KG",
        minimumStock: 5,
        costPriceRupees: 280,
        sku: null,
        isActive: true,
      });
      const purchase = await createPurchase(restaurantId, ownerId, {
        items: [
          {
            inventoryItemId: paneer.id,
            quantity: 10,
            unit: "KG",
            purchaseRateRupees: 280,
          },
        ],
        idempotencyKey: "audit-purchase-2",
      });
      // 10 KG bought -> 10000 base (G) on hand.
      const afterPurchase = await InventoryItemModel.findById(paneer.id).lean();
      expect(afterPurchase?.currentStock).toBe(10000);

      const reversed = await reversePurchase(restaurantId, purchase.id, ownerId, "Supplier rectified");
      expect(reversed.status).toBe("REVERSED");

      const afterReversal = await InventoryItemModel.findById(paneer.id).lean();
      expect(afterReversal?.currentStock).toBe(0);
      // Purchase is never deleted.
      expect(await PurchaseModel.exists({ _id: purchase.id, restaurantId })).toBeTruthy();

      const log = await TableAuditLogModel.findOne({
        restaurantId,
        action: "PURCHASE_REVERSED",
        entityType: "PURCHASE",
        entityId: purchase.id,
      }).lean();
      expect(log).not.toBeNull();

      // Reversal is a one-way door.
      await expect(
        reversePurchase(restaurantId, purchase.id, ownerId, "again")
      ).rejects.toThrow(PurchaseValidationError);
    },
    30000
  );

  it(
    "enforces cross-tenant isolation on audit queries and records",
    async () => {
      if (!available) return;
      const { plain: p1, t1 } = await seedMenuAndTable();
      await dineInOrder(p1.id, t1.id);

      const otherRid = await createRestaurant("Other Restaurant");
      const otherOwner = await UserModel.findOne({ restaurantId: otherRid, role: "OWNER" });
      const otherId = String(otherOwner?._id);

      // A bill belonging to the other tenant cannot be fetched.
      const cat = await createCategory(otherRid, {
        name: "B",
        description: undefined,
        displayOrder: 0,
        isActive: true,
      });
      const otherItem = await createMenuItem(
        otherRid,
        item("Bread", { categoryId: cat.id, basePriceRupees: 60 })
      );
      const otherTable = await createTable(otherRid, table("T2"));
      const otherOrder = await createOrder(otherRid, otherId, {
        orderType: "DINE_IN",
        tableId: otherTable.id,
        items: [{ menuItemId: otherItem.id, quantity: 1 }],
      });
      const otherBill = await generateBill(otherRid, otherOrder.id, otherId);
      await expect(
        generateBill(restaurantId, otherOrder.id, ownerId)
      ).rejects.toThrow();

      // listAuditLogs for restaurant A never exposes restaurant B's rows.
      const search = await listAuditLogs(restaurantId, { search: otherBill.id });
      expect(search.total).toBe(0);

      const own = await listAuditLogs(restaurantId, { action: "ORDER_CREATED" });
      expect(own.total).toBe(1);
    },
    30000
  );
});