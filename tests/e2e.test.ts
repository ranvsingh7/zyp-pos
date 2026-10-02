import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { encryptSession, decryptSession } from "@/lib/auth/session";
import { createRestaurantForUser } from "@/lib/restaurant-service";

// Full end-to-end check against a real MongoDB instance (docker).
// Connection is established directly so that connectDB() reuses this live
// connection. Skip silently when no server is reachable so `npm test` stays
// green in environments without a local mongo.
const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_e2e";

let available = false;

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
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
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
});

describe("E2E against real MongoDB", () => {
  it(
    "completes the full signup → onboarding → login flow",
    async () => {
      if (!available) return;

      // 1. Signup
      const passwordHash = await hashPassword("Password123!");
      const user = await UserModel.create({
        fullName: "Anshul Sharma",
        email: "anshul@restopos.test",
        passwordHash,
        isActive: true,
      });
      expect(user.role).toBe("OWNER");

      const token = await encryptSession({ userId: String(user._id) });
      const session = await decryptSession(token);
      expect(session?.userId).toBe(String(user._id));

      // 2. Onboarding
      const result = await createRestaurantForUser(String(user._id), {
        name: "Curry House E2E",
        ownerName: "Anshul Sharma",
        phone: "9876543210",
        email: "curry@restopos.test",
        address: "123 Food Street",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        gstRegistered: true,
        gstin: "22AAAAA0000A1Z5",
        businessType: "Restaurant",
      });
      expect(result.restaurantId).toBeTruthy();

      const restaurant = await RestaurantModel.findById(result.restaurantId);
      expect(restaurant?.name).toBe("Curry House E2E");
      expect(restaurant?.gstin).toBe("22AAAAA0000A1Z5");

      const settings = await RestaurantSettingsModel.findOne({
        restaurantId: result.restaurantId,
      });
      expect(settings?.currency).toBe("INR");

      const updated = await UserModel.findById(user._id);
      expect(String(updated?.restaurantId)).toBe(result.restaurantId);
      expect(updated?.role).toBe("OWNER");

      // 3. Login verification
      const stored = await UserModel.findOne({
        email: "anshul@restopos.test",
      }).select("+passwordHash");
      expect(await verifyPassword("Password123!", stored!.passwordHash)).toBe(true);

      // Unique index enforced
      await expect(
        UserModel.create({
          fullName: "Duplicate",
          email: "anshul@restopos.test",
          passwordHash,
        })
      ).rejects.toThrow();
    },
    30000
  );

  it(
    "is idempotent against real MongoDB",
    async () => {
      if (!available) return;
      const passwordHash = await hashPassword("Password123!");
      const user = await UserModel.create({
        fullName: "Owner",
        email: "owner@restopos.test",
        passwordHash,
      });
      const first = await createRestaurantForUser(String(user._id), {
        name: "Taco Stand",
        ownerName: "Owner",
        phone: "111",
        address: "1",
        city: "Delhi",
        state: "DL",
        pincode: "110001",
        gstRegistered: false,
        gstin: "",
        businessType: "Fast Food",
      });
      const second = await createRestaurantForUser(String(user._id), {
        ...{
          name: "Taco Stand 2",
          ownerName: "Owner",
          phone: "222",
          address: "2",
          city: "Delhi",
          state: "DL",
          pincode: "110001",
          gstRegistered: false,
          gstin: "",
          businessType: "Fast Food",
        },
      });
      expect(second.restaurantId).toBe(first.restaurantId);
      const count = await RestaurantModel.countDocuments({ ownerId: user._id });
      expect(count).toBe(1);
    },
    30000
  );
});