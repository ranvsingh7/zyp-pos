import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { guardDestructiveScriptOrExit } from "./lib/production-db-guard";

// Dev-only helper: drops all ZYP POS collections in the configured database.
//
// Usage:
//   npm run db:reset
//
// Warning: this permanently deletes users, restaurants and settings. Only use
// in development or against a throwaway database.
//
// Safety: `guardDestructiveScriptOrExit` runs immediately after the environment
// is loaded and BEFORE any connection is opened, so a production target is
// refused without MongoDB ever being reached.

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

  guardDestructiveScriptOrExit({ operation: "destructive", scriptName: "db:reset" });

  const connection = await mongoose.connect(uri, { dbName });
  const db = connection.connection.db;

  if (!db) {
    console.error("Could not access database connection.");
    process.exit(1);
  }

  const dropped = await Promise.all(
    ["users", "restaurants", "restaurantsettings"].map((collection) =>
      db.collection(collection).drop().catch(() => false)
    )
  );

  dropped.forEach((wasDropped, index) => {
    const name = ["users", "restaurants", "restaurantsettings"][index];
    console.log(wasDropped ? `Dropped collection: ${name}` : `No collection to drop: ${name}`);
  });

  console.log("Database reset complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Reset failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });