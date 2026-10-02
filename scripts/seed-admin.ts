import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import argon2 from "argon2";
import { UserModel } from "@/models/User";

// Creates the platform SUPER_ADMIN account (idempotent, safe to repeat).
//
// Usage:
//   npm run db:seed:admin
//   npx tsx scripts/seed-admin.ts
//
// Log in at /login with:
//   admin@restopos.local  /  Admin@1234
//
// SUPER_ADMIN users have no restaurantId; after login they land on /admin.

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@restopos.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@1234";
const ADMIN_NAME = process.env.ADMIN_NAME ?? "Platform Admin";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "restopos";

  if (!uri) {
    console.error(
      "MONGODB_URI is not set. Copy .env.example to .env.local and fill in your MongoDB connection string first."
    );
    process.exit(1);
  }

  // This script is intentionally NOT blocked in production: bootstrapping the
  // first SUPER_ADMIN against the real database is a legitimate, required
  // operation (see PRODUCTION_ENV_EXAMPLE.md). It is idempotent and only ever
  // creates/updates the one admin account.
  //
  // It does, however, fall back to a well-known default password, which would be
  // a serious exposure in production. Warn loudly rather than blocking, because
  // blocking would make production impossible to bootstrap.
  if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
    console.warn(
      [
        "",
        "  WARNING: bootstrapping SUPER_ADMIN in production with the built-in",
        "  default password. Set ADMIN_PASSWORD to a strong unique value for",
        "  this run, and change the password immediately after first login.",
        "",
      ].join("\n")
    );
  }

  await mongoose.connect(uri, { dbName });

  const existing = await UserModel.findOne({ email: ADMIN_EMAIL.toLowerCase().trim() });
  if (existing) {
    await UserModel.updateOne(
      { _id: existing._id },
      { $set: { role: "SUPER_ADMIN", isActive: true } }
    );
    console.log(`Super admin already exists — ensured role=SUPER_ADMIN, isActive=true (${ADMIN_EMAIL}).`);
  } else {
    const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await UserModel.create({
      fullName: ADMIN_NAME,
      email: ADMIN_EMAIL.toLowerCase().trim(),
      passwordHash,
      phone: null,
      role: "SUPER_ADMIN",
      restaurantId: null,
      isActive: true,
    });
    console.log(`Created super admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }

  console.log("Log in at /login — you will be redirected to /admin.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });