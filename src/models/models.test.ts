import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserModel } from "./User";
import { RestaurantModel } from "./Restaurant";
import { RestaurantSettingsModel } from "./RestaurantSettings";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

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

describe("User model", () => {
  it("creates a user with hashed password", async () => {
    const hash = await hashPassword("Password123!");
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "anshul@example.com",
      passwordHash: hash,
      role: "OWNER",
      isActive: true,
    });
    expect(user.email).toBe("anshul@example.com");
    expect(user.role).toBe("OWNER");
  });

  it("enforces unique email", async () => {
    const hash = await hashPassword("Password123!");
    await UserModel.create({
      fullName: "One",
      email: "same@example.com",
      passwordHash: hash,
    });
    await expect(
      UserModel.create({
        fullName: "Two",
        email: "same@example.com",
        passwordHash: hash,
      })
    ).rejects.toThrow();
  });

  it("stores passwordHash and verifies correctly", async () => {
    const hash = await hashPassword("SecretPass123!");
    const valid = await verifyPassword("SecretPass123!", hash);
    const invalid = await verifyPassword("wrong", hash);
    expect(valid).toBe(true);
    expect(invalid).toBe(false);
  });

  it("sets restaurantId ref field", async () => {
    const restaurant = await RestaurantModel.create({
      name: "Curry House",
      ownerId: new mongoose.Types.ObjectId(),
      phone: "9876543210",
      address: "Address",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
      businessType: "Restaurant",
    });
    const hash = await hashPassword("Password123!");
    const user = await UserModel.create({
      fullName: "Owner",
      email: "owner@example.com",
      passwordHash: hash,
      restaurantId: restaurant._id,
      role: "OWNER",
    });
    expect(String(user.restaurantId)).toBe(String(restaurant._id));
  });

  it("allows only valid roles", async () => {
    const hash = await hashPassword("Password123!");
    await expect(
      UserModel.create({
        fullName: "Bad",
        email: "bad@example.com",
        passwordHash: hash,
        role: "SUPERUSER" as never,
      })
    ).rejects.toThrow();
  });
});

describe("Restaurant model", () => {
  it("creates a restaurant with ownerId", async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const restaurant = await RestaurantModel.create({
      name: "Taco Bell",
      ownerId,
      phone: "9876543210",
      email: "taco@example.com",
      address: "123",
      city: "Delhi",
      state: "DL",
      pincode: "110001",
      gstRegistered: true,
      gstin: "22AAAAA0000A1Z5",
      businessType: "Fast Food",
    });
    expect(String(restaurant.ownerId)).toBe(String(ownerId));
    expect(restaurant.gstin).toBe("22AAAAA0000A1Z5");
  });
});

describe("RestaurantSettings model", () => {
  it("creates settings linked to a restaurant", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    const settings = await RestaurantSettingsModel.create({
      restaurantId,
      currency: "INR",
      defaultTaxRate: 0,
      taxInclusive: false,
      serviceChargeEnabled: false,
      serviceChargeRate: 0,
      roundOffEnabled: false,
      billPrefix: "BILL",
      kotPrefix: "KOT",
    });
    expect(String(settings.restaurantId)).toBe(String(restaurantId));
    expect(settings.currency).toBe("INR");
    expect(settings.billPrefix).toBe("BILL");
  });

  it("defaults new restaurants to 5% GST (CGST 2.5 + SGST 2.5) enabled", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    const settings = await RestaurantSettingsModel.create({ restaurantId });
    expect(settings.taxEnabled).toBe(true);
    expect(settings.defaultTaxRate).toBe(5);
    expect(settings.cgstRatePercent).toBe(2.5);
    expect(settings.sgstRatePercent).toBe(2.5);
    expect(settings.igstRatePercent).toBe(5);
  });

  it("enforces one settings doc per restaurant", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    await RestaurantSettingsModel.create({ restaurantId });
    await expect(
      RestaurantSettingsModel.create({ restaurantId })
    ).rejects.toThrow();
  });
});