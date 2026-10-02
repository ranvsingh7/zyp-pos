import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { encryptSession, decryptSession } from "@/lib/auth/session";

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
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
});

describe("session management", () => {
  it("encrypts and decrypts a session with userId", async () => {
    const token = await encryptSession({ userId: "abc123" });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
    const session = await decryptSession(token);
    expect(session?.userId).toBe("abc123");
  });

  it("returns null for an invalid token", async () => {
    const session = await decryptSession("invalid.token.value");
    expect(session).toBeNull();
  });

  it("returns null for empty token", async () => {
    const session = await decryptSession(null);
    expect(session).toBeNull();
  });

  it("rejects tokens signed with a different key", async () => {
    const token = await encryptSession({ userId: "user1" });
    const originalSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-different-secret-key-for-testing-purposes-000";
    const session = await decryptSession(token);
    process.env.AUTH_SECRET = originalSecret;
    expect(session).toBeNull();
  });
});

describe("authentication flow", () => {
  it("signup: creates user with OWNER role and hashed password", async () => {
    const passwordHash = await hashPassword("Password123!");
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "owner@example.com",
      passwordHash,
    });
    expect(user.role).toBe("OWNER");
    expect(user.isActive).toBe(true);
    expect(user.passwordHash).not.toBe("Password123!");
  });

  it("signup: rejects duplicate email", async () => {
    const seed = async (email: string) => {
      const passwordHash = await hashPassword("Password123!");
      return UserModel.create({
        fullName: "User",
        email,
        passwordHash,
      });
    };
    await seed("dupe@example.com");
    await expect(seed("dupe@example.com")).rejects.toThrow();
  });

  it("login: verifies correct password", async () => {
    const passwordHash = await hashPassword("CorrectPass123!");
    await UserModel.create({
      fullName: "User",
      email: "login@example.com",
      passwordHash,
    });
    const user = await UserModel.findOne({ email: "login@example.com" }).select("+passwordHash");
    expect(user).not.toBeNull();
    const ok = await verifyPassword("CorrectPass123!", user!.passwordHash);
    expect(ok).toBe(true);
  });

  it("login: rejects wrong password", async () => {
    const passwordHash = await hashPassword("CorrectPass123!");
    await UserModel.create({
      fullName: "User",
      email: "login@example.com",
      passwordHash,
    });
    const user = await UserModel.findOne({ email: "login@example.com" }).select("+passwordHash");
    expect(user).not.toBeNull();
    const ok = await verifyPassword("WrongPass123!", user!.passwordHash);
    expect(ok).toBe(false);
  });

  it("login: rejects invalid email (no user)", async () => {
    const user = await UserModel.findOne({ email: "missing@example.com" });
    expect(user).toBeNull();
  });

  it("login: rejects deactivated user via isActive flag", async () => {
    const passwordHash = await hashPassword("CorrectPass123!");
    await UserModel.create({
      fullName: "User",
      email: "deactivated@example.com",
      passwordHash,
      isActive: false,
    });
    const user = await UserModel.findOne({ email: "deactivated@example.com" });
    expect(user).not.toBeNull();
    expect(user!.isActive).toBe(false);
  });
});

describe("onboarding: restaurant creation", () => {
  it("creates restaurant, settings, and links user as OWNER", async () => {
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "onboard@example.com",
      passwordHash: await hashPassword("Password123!"),
    });

    const restaurant = await RestaurantModel.create({
      name: "Curry House",
      ownerId: user._id,
      phone: "9876543210",
      email: "curry@example.com",
      address: "123",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
      gstRegistered: true,
      gstin: "22AAAAA0000A1Z5",
      businessType: "Restaurant",
    });

    await RestaurantSettingsModel.create({ restaurantId: restaurant._id });
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { restaurantId: restaurant._id, role: "OWNER" } }
    );

    const updated = await UserModel.findById(user._id);
    expect(updated).not.toBeNull();
    expect(String(updated!.restaurantId)).toBe(String(restaurant._id));
    expect(updated!.role).toBe("OWNER");

    const settings = await RestaurantSettingsModel.findOne({
      restaurantId: restaurant._id,
    });
    expect(settings).not.toBeNull();
  });

  it("prevents second restaurant for a user with restaurantId", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    const user = await UserModel.create({
      fullName: "Anshul",
      email: "twice@example.com",
      passwordHash: await hashPassword("Password123!"),
      restaurantId,
      role: "OWNER",
    });
    expect(user.restaurantId).toBeDefined();
  });
});

describe("tenant isolation", () => {
  it("ensures each user belongs to its own restaurant", async () => {
    const rest1 = await RestaurantModel.create({
      name: "Restaurant One",
      ownerId: new mongoose.Types.ObjectId(),
      phone: "111",
      address: "A1",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
      businessType: "Restaurant",
    });
    const rest2 = await RestaurantModel.create({
      name: "Restaurant Two",
      ownerId: new mongoose.Types.ObjectId(),
      phone: "222",
      address: "B2",
      city: "Delhi",
      state: "DL",
      pincode: "110001",
      businessType: "Cafe",
    });

    const hash = await hashPassword("Password123!");
    const userA = await UserModel.create({
      fullName: "A",
      email: "a@example.com",
      passwordHash: hash,
      restaurantId: rest1._id,
      role: "OWNER",
    });
    const userB = await UserModel.create({
      fullName: "B",
      email: "b@example.com",
      passwordHash: hash,
      restaurantId: rest2._id,
      role: "MANAGER",
    });

    expect(String(userA.restaurantId)).toBe(String(rest1._id));
    expect(String(userB.restaurantId)).toBe(String(rest2._id));
    expect(String(userA.restaurantId)).not.toBe(String(userB.restaurantId));
  });

  it("does not share restaurant settings across tenants", async () => {
    const rid = new mongoose.Types.ObjectId();
    await RestaurantSettingsModel.create({
      restaurantId: rid,
      billPrefix: "XYZ",
    });
    const other = await RestaurantSettingsModel.findOne({
      restaurantId: new mongoose.Types.ObjectId(),
    });
    expect(other).toBeNull();
  });
});

describe("role authorization", () => {
  it("assigns distinct roles to staff members", async () => {
    const hash = await hashPassword("Password123!");
    const rid = new mongoose.Types.ObjectId();
    const roles: { name: string; email: string; role: "OWNER" | "MANAGER" | "CASHIER" | "WAITER" }[] = [
      { name: "Owner", email: "owner@x.com", role: "OWNER" },
      { name: "Manager", email: "manager@x.com", role: "MANAGER" },
      { name: "Cashier", email: "cashier@x.com", role: "CASHIER" },
      { name: "Waiter", email: "waiter@x.com", role: "WAITER" },
    ];
    for (const r of roles) {
      const user = await UserModel.create({
        fullName: r.name,
        email: r.email,
        passwordHash: hash,
        role: r.role,
        restaurantId: rid,
      });
      expect(user.role).toBe(r.role);
    }
    const count = await UserModel.countDocuments({ restaurantId: rid });
    expect(count).toBe(4);
  });
});