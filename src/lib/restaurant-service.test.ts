import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
});

const validPayload = {
  name: "Curry House",
  ownerName: "Anshul Sharma",
  phone: "9876543210",
  email: "curry@example.com",
  address: "123 Food Street",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  gstRegistered: true,
  gstin: "22AAAAA0000A1Z5",
  businessType: "Restaurant" as const,
};

describe("createRestaurantForUser", () => {
  it("creates restaurant, settings, and links owner", async () => {
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "owner@example.com",
      passwordHash: await hashPassword("Password123!"),
    });

    const result = await createRestaurantForUser(String(user._id), validPayload);
    expect(result.userExists).toBe(true);
    expect(result.userActive).toBe(true);
    expect(result.restaurantId).toBeTruthy();

    const restaurant = await RestaurantModel.findById(result.restaurantId);
    expect(restaurant).not.toBeNull();
    expect(restaurant!.ownerId.toString()).toBe(String(user._id));

    const settings = await RestaurantSettingsModel.findOne({
      restaurantId: result.restaurantId,
    });
    expect(settings).not.toBeNull();

    const updatedUser = await UserModel.findById(user._id);
    expect(String(updatedUser!.restaurantId)).toBe(result.restaurantId);
    expect(updatedUser!.role).toBe("OWNER");
  });

  it("is idempotent — does not create a duplicate restaurant", async () => {
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "owner2@example.com",
      passwordHash: await hashPassword("Password123!"),
    });

    const first = await createRestaurantForUser(String(user._id), validPayload);
    const second = await createRestaurantForUser(String(user._id), {
      ...validPayload,
      name: "Second Attempt",
    });

    expect(second.restaurantId).toBe(first.restaurantId);
    const count = await RestaurantModel.countDocuments({ ownerId: user._id });
    expect(count).toBe(1);
    const settingsCount = await RestaurantSettingsModel.countDocuments({
      restaurantId: first.restaurantId,
    });
    expect(settingsCount).toBe(1);
  });

  it("reports missing user", async () => {
    const result = await createRestaurantForUser(
      new mongoose.Types.ObjectId().toString(),
      validPayload
    );
    expect(result.userExists).toBe(false);
    expect(result.restaurantId).toBe("");
  });

  it("reports deactivated user and does not create restaurant", async () => {
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "inactive@example.com",
      passwordHash: await hashPassword("Password123!"),
      isActive: false,
    });

    const result = await createRestaurantForUser(String(user._id), validPayload);
    expect(result.userActive).toBe(false);
    expect(result.restaurantId).toBe("");

    const count = await RestaurantModel.countDocuments({ ownerId: user._id });
    expect(count).toBe(0);
  });

  it("stores GSTIN only when GST-registered", async () => {
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "gst@example.com",
      passwordHash: await hashPassword("Password123!"),
    });

    const result = await createRestaurantForUser(String(user._id), {
      ...validPayload,
      gstRegistered: false,
      gstin: "",
    });

    const restaurant = await RestaurantModel.findById(result.restaurantId);
    expect(restaurant!.gstRegistered).toBe(false);
    expect(restaurant!.gstin).toBeNull();
  });

  it("disables tax on onboarding when not GST-registered", async () => {
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "unregistered@example.com",
      passwordHash: await hashPassword("Password123!"),
    });

    const result = await createRestaurantForUser(String(user._id), {
      ...validPayload,
      gstRegistered: false,
      gstin: "",
    });

    const settings = await RestaurantSettingsModel.findOne({
      restaurantId: result.restaurantId,
    });
    expect(settings?.taxEnabled).toBe(false);
  });

  it("enables the default 5% tax on onboarding when GST-registered", async () => {
    const user = await UserModel.create({
      fullName: "Anshul Sharma",
      email: "registered@example.com",
      passwordHash: await hashPassword("Password123!"),
    });

    const result = await createRestaurantForUser(String(user._id), validPayload);

    const settings = await RestaurantSettingsModel.findOne({
      restaurantId: result.restaurantId,
    });
    expect(settings?.taxEnabled).toBe(true);
    expect(settings?.defaultTaxRate).toBe(5);
  });
});