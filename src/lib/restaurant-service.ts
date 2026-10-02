import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { DEFAULT_TAX_CONFIG } from "@/lib/billing/constants";
import { resolveEffectiveTaxEnabled } from "@/lib/billing/tax-config";
import type { RestaurantRegistrationInput } from "@/lib/validations";

async function createRestaurantBundle(
  userId: string,
  payload: RestaurantRegistrationInput,
  session?: mongoose.ClientSession
): Promise<string> {
  const [restaurant] = await RestaurantModel.create(
    [
      {
        name: payload.name,
        ownerId: userId,
        phone: payload.phone,
        email: payload.email || null,
        address: payload.address,
        city: payload.city,
        state: payload.state,
        pincode: payload.pincode,
        gstRegistered: payload.gstRegistered,
        gstin: payload.gstRegistered ? payload.gstin : null,
        businessType: payload.businessType,
        isActive: true,
      },
    ],
    session ? { session } : undefined
  );

  const restaurantId = String(restaurant._id);

  await RestaurantSettingsModel.create(
    [
      {
        restaurantId,
        currency: "INR",
        // GST registration is the master control: an unregistered restaurant
        // is created with tax always disabled.
        taxEnabled: resolveEffectiveTaxEnabled(
          DEFAULT_TAX_CONFIG.taxEnabled,
          payload.gstRegistered
        ),
        defaultTaxRate: DEFAULT_TAX_CONFIG.defaultTaxRate,
        taxInclusive: false,
        gstScheme: "INTRA_STATE",
        cgstRatePercent: DEFAULT_TAX_CONFIG.cgstRatePercent,
        sgstRatePercent: DEFAULT_TAX_CONFIG.sgstRatePercent,
        igstRatePercent: DEFAULT_TAX_CONFIG.igstRatePercent,
        serviceChargeEnabled: false,
        serviceChargeRate: 0,
        roundOffEnabled: false,
        billPrefix: "BILL",
        kotPrefix: "KOT",
      },
    ],
    session ? { session } : undefined
  );

  await UserModel.updateOne(
    { _id: userId },
    { $set: { restaurantId, role: "OWNER" } },
    session ? { session } : undefined
  );

  return restaurantId;
}

function deploymentSupportsTransactions(): boolean {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    const client = mongoose.connection.getClient() as unknown as {
      topology?: { description?: { type?: string } };
    };
    const type = client.topology?.description?.type;
    return (
      type === "ReplicaSetNoPrimary" ||
      type === "ReplicaSetWithPrimary" ||
      type === "Sharded"
    );
  } catch {
    return false;
  }
}

/**
 * Sets up a restaurant for an authenticated owner.
 *
 * Preferred path: MongoDB transaction (atomic across Restaurant,
 * RestaurantSettings, and User). Falls back to sequential creation when the
 * deployment does not support transactions (e.g. MongoDB Atlas M0 free tier or
 * a standalone mongod).
 *
 * Idempotent: if the user already owns a restaurant, the existing restaurant id
 * is returned instead of creating a duplicate.
 */
export async function createRestaurantForUser(
  userId: string,
  payload: RestaurantRegistrationInput
): Promise<{ restaurantId: string; userExists: boolean; userActive: boolean }> {
  await connectDB();

  const user = await UserModel.findById(userId)
    .select("_id role restaurantId isActive")
    .lean();

  if (!user) {
    return { restaurantId: "", userExists: false, userActive: true };
  }

  const userRecord = user as unknown as {
    _id: unknown;
    role: string;
    restaurantId: unknown;
    isActive: boolean;
  };

  if (!userRecord.isActive) {
    return { restaurantId: "", userExists: true, userActive: false };
  }

  if (userRecord.restaurantId) {
    return {
      restaurantId: String(userRecord.restaurantId),
      userExists: true,
      userActive: true,
    };
  }

  if (!deploymentSupportsTransactions()) {
    // Standalone mongod (e.g. MongoDB Atlas M0 free tier or local dev) cannot
    // run multi-document transactions. Use sequential creation, guarded by the
    // idempotency check above.
    const existing = await RestaurantModel.findOne({ ownerId: userId }).select("_id");
    if (existing) {
      return { restaurantId: String(existing._id), userExists: true, userActive: true };
    }
    const restaurantId = await createRestaurantBundle(userId, payload);
    return { restaurantId, userExists: true, userActive: true };
  }

  try {
    const session = await mongoose.startSession();
    try {
      const restaurantId = await session.withTransaction(() =>
        createRestaurantBundle(userId, payload, session)
      );
      return { restaurantId, userExists: true, userActive: true };
    } finally {
      await session.endSession();
    }
  } catch (transactionError) {
    console.warn(
      "ZYP POS: transaction failed, using sequential creation",
      transactionError instanceof Error ? transactionError.message : transactionError
    );
    const existing = await RestaurantModel.findOne({ ownerId: userId }).select("_id");
    if (existing) {
      return { restaurantId: String(existing._id), userExists: true, userActive: true };
    }
    const restaurantId = await createRestaurantBundle(userId, payload);
    return { restaurantId, userExists: true, userActive: true };
  }
}