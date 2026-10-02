import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { RateLimitModel } from "@/models/RateLimit";
import { hashPassword } from "@/lib/auth/password";
import { attemptLogin } from "@/lib/auth/login-service";
import { resetRateLimitStore } from "@/lib/rate-limit";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await resetRateLimitStore();
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
  await RateLimitModel.collection.deleteMany({});
});

const IP = "203.0.113.10";

describe("login-service (auth audit + rate limiting)", () => {
  it("logs FAILED_LOGIN for an unknown account and stays anonymous", async () => {
    const result = await attemptLogin({
      email: "nobody@restopos.test",
      password: "Whatever123!",
      ip: IP,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "invalid_credentials" });

    const logs = await TableAuditLogModel.find({ action: "FAILED_LOGIN" }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].entityId).toBe("nobody@restopos.test");
    expect(logs[0].success).toBe(false);
    expect(logs[0].ip).toBe(IP);
    expect(logs[0].entityType).toBe("USER");
  });

  it("logs FAILED_LOGIN for a wrong password on a real account", async () => {
    await UserModel.create({
      fullName: "Cashier",
      email: "cashier@restopos.test",
      passwordHash: await hashPassword("CorrectPass123!"),
      role: "CASHIER",
      isActive: true,
    });

    const result = await attemptLogin({
      email: "cashier@restopos.test",
      password: "WrongPass123!",
      ip: IP,
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "invalid_credentials" });

    const logs = await TableAuditLogModel.find({ action: "FAILED_LOGIN" }).lean();
    expect(logs).toHaveLength(1);
    const user = await UserModel.findOne({ email: "cashier@restopos.test" });
    expect(String(logs[0].entityId)).toBe(String(user?._id));
  });

  it("logs FAILED_LOGIN and rejects a deactivated account", async () => {
    await UserModel.create({
      fullName: "Fired",
      email: "fired@restopos.test",
      passwordHash: await hashPassword("CorrectPass123!"),
      role: "WAITER",
      isActive: false,
    });

    const result = await attemptLogin({
      email: "fired@restopos.test",
      password: "CorrectPass123!",
      ip: IP,
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "deactivated" });

    const logs = await TableAuditLogModel.find({ action: "FAILED_LOGIN" }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).toContain("Deactivated");
  });

  it("logs LOGIN on success and returns the session payload", async () => {
    const user = await UserModel.create({
      fullName: "Owner",
      email: "owner@restopos.test",
      passwordHash: await hashPassword("CorrectPass123!"),
      role: "OWNER",
      isActive: true,
    });
    const restaurant = await RestaurantModel.create({
      name: "Owner Kitchen",
      ownerId: user._id,
      phone: "9876543210",
      address: "1 St",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
      businessType: "Restaurant",
    });
    await UserModel.updateOne({ _id: user._id }, { $set: { restaurantId: restaurant._id } });

    const result = await attemptLogin({
      email: "owner@restopos.test",
      password: "CorrectPass123!",
      ip: IP,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe(String(user._id));
      expect(result.restaurantId).toBe(String(restaurant._id));
      expect(result.role).toBe("OWNER");
    }

    const logs = await TableAuditLogModel.find({ action: "LOGIN" }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(true);
    expect(logs[0].actorRole).toBe("OWNER");
    expect(String(logs[0].userId)).toBe(String(user._id));
    expect(String(logs[0].restaurantId)).toBe(String(restaurant._id));
    expect(logs[0].entityType).toBe("USER");
  });

  it("rate-limits repeated failures from the same email+ip", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await attemptLogin({
        email: "locked@restopos.test",
        password: "WrongPass123!",
        ip: "198.51.100.7",
      });
      expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
    }

    const blocked = await attemptLogin({
      email: "locked@restopos.test",
      password: "CorrectPass123!",
      ip: "198.51.100.7",
    });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });

    const failures = await TableAuditLogModel.find({
      action: "FAILED_LOGIN",
    }).lean();
    expect(failures.length).toBeGreaterThanOrEqual(6);
  });

  it("does not create any audit noise for invalid input shape", async () => {
    const result = await attemptLogin({
      email: "not-an-email",
      password: "",
      ip: IP,
    });
    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(await TableAuditLogModel.countDocuments({})).toBe(0);
  });
});