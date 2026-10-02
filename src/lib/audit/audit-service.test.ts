import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import {
  writeAuditLog,
  listAuditLogs,
  countAuditLogs,
} from "@/lib/audit/audit-service";
import {
  assertNotDeletable,
  ProtectedRecordError,
} from "@/lib/audit/delete-protection";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

let actorUserId = "";

async function seedRestaurant(name: string): Promise<string> {
  const user = await UserModel.create({
    fullName: "Owner",
    email: `audit-${name}-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash: "x",
    role: "OWNER",
    isActive: true,
  });
  const restaurant = await RestaurantModel.create({
    name,
    ownerId: user._id,
    phone: "9876543210",
    address: "1 St",
    city: "Mumbai",
    state: "MH",
    pincode: "400001",
    businessType: "Restaurant",
  });
  await UserModel.updateOne({ _id: user._id }, { $set: { restaurantId: restaurant._id } });
  actorUserId = String(user._id);
  return String(restaurant._id);
}

beforeEach(async () => {
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
});

describe("audit-service", () => {
  it("writes an entry and resolves the actor role from the user", async () => {
    const restaurantId = await seedRestaurant("A");
    await writeAuditLog({
      restaurantId,
      actorUserId,
      action: "ORDER_CREATED",
      resourceType: "ORDER",
      resourceId: new mongoose.Types.ObjectId().toString(),
      success: true,
      reason: "New order",
    });

    const logs = await TableAuditLogModel.find({ restaurantId }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].actorRole).toBe("OWNER");
    expect(logs[0].action).toBe("ORDER_CREATED");
    expect(logs[0].success).toBe(true);
    expect(String(logs[0].restaurantId)).toBe(restaurantId);
  });

  it("keeps tenants isolated: listAuditLogs only returns the scoped restaurant", async () => {
    const a = await seedRestaurant("A");
    const b = await seedRestaurant("B");
    for (let i = 0; i < 3; i++) {
      await writeAuditLog({
        restaurantId: a,
        actorUserId,
        action: "ORDER_CREATED",
        resourceType: "ORDER",
        resourceId: String(i),
      });
    }
    await writeAuditLog({
      restaurantId: b,
      actorUserId,
      action: "ORDER_CREATED",
      resourceType: "ORDER",
      resourceId: "b1",
    });

    const forA = await listAuditLogs(a, {});
    const forB = await listAuditLogs(b, {});
    expect(forA.total).toBe(3);
    expect(forB.total).toBe(1);
    expect(forA.rows.every((r) => r.resourceId !== "b1")).toBe(true);
  });

  it("supports filters: action, success, date window", async () => {
    const restaurantId = await seedRestaurant("A");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await TableAuditLogModel.create({
      restaurantId,
      action: "ORDER_CANCELLED",
      entityType: "ORDER",
      entityId: "x1",
      success: false,
      createdAt: yesterday,
    });
    await writeAuditLog({
      restaurantId,
      actorUserId,
      action: "LOGIN",
      resourceType: "USER",
      resourceId: actorUserId,
    });

    expect(await countAuditLogs(restaurantId, { action: "LOGIN" })).toBe(1);
    expect(await countAuditLogs(restaurantId, { action: "ORDER_CANCELLED" })).toBe(1);
    expect(await countAuditLogs(restaurantId, { success: false })).toBe(1);
    expect(await countAuditLogs(restaurantId, { success: true })).toBe(1);
    // Date-windowed count includes only yesterday's cancellation.
    expect(
      await countAuditLogs(restaurantId, {
        action: "ORDER_CANCELLED",
        fromYmd: yesterday.toISOString().slice(0, 10),
      })
    ).toBe(1);
  });

  it("searches by resource id", async () => {
    const restaurantId = await seedRestaurant("A");
    await writeAuditLog({
      restaurantId,
      actorUserId,
      action: "ORDER_CANCELLED",
      resourceType: "ORDER",
      resourceId: "K-000042",
    });
    const { total, rows } = await listAuditLogs(restaurantId, { search: "000042" });
    expect(total).toBe(1);
    expect(rows[0].resourceId).toBe("K-000042");
  });
});

describe("delete protection", () => {
  it("rejects physical deletes of protected records and logs DELETE_ATTEMPT", async () => {
    const restaurantId = await seedRestaurant("A");
    const paymentId = new mongoose.Types.ObjectId().toString();

    await expect(
      assertNotDeletable("PAYMENT", paymentId, {
        restaurantId,
        actorUserId,
        reason: "Attempt to hard-delete a payment.",
      })
    ).rejects.toThrow(ProtectedRecordError);

    const logs = await TableAuditLogModel.find({ action: "DELETE_ATTEMPT" }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].entityType).toBe("PAYMENT");
    expect(String(logs[0].entityId)).toBe(paymentId);
    expect(logs[0].success).toBe(false);
    expect(logs[0].reason).toContain("hard-delete");
  });

  it("allows deletes of non-protected records (catalog/floor-plan)", async () => {
    const restaurantId = await seedRestaurant("A");
    await expect(
      assertNotDeletable("TABLE", "t1", { restaurantId, actorUserId })
    ).resolves.toBeUndefined();
    expect(await TableAuditLogModel.countDocuments({})).toBe(0);
  });
});

describe("audit immutability", () => {
  it("rejects update and delete operations at the model boundary", async () => {
    const restaurantId = await seedRestaurant("A");
    await writeAuditLog({
      restaurantId,
      actorUserId,
      action: "ORDER_CREATED",
      resourceType: "ORDER",
      resourceId: "abc",
    });
    const doc = await TableAuditLogModel.findOne({ restaurantId }).lean();

    await expect(
      TableAuditLogModel.updateOne({ _id: doc?._id }, { $set: { reason: "tampered" } })
    ).rejects.toThrow(/append-only/);
    await expect(
      TableAuditLogModel.findByIdAndUpdate(doc?._id, { $set: { reason: "tampered" } })
    ).rejects.toThrow(/append-only/);
    await expect(
      TableAuditLogModel.deleteOne({ _id: doc?._id })
    ).rejects.toThrow(/append-only/);
    await expect(
      TableAuditLogModel.deleteMany({ restaurantId })
    ).rejects.toThrow(/append-only/);

    // The evidence is untouched.
    const fresh = await TableAuditLogModel.findOne({ restaurantId }).lean();
    expect(String(fresh?._id)).toBe(String(doc?._id));
  });
});