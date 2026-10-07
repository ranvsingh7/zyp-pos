import "server-only";

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "restopos";

if (!MONGODB_URI) {
  throw new Error(
    "MONGODB_URI is not defined. Please set it in your .env.local file."
  );
}

const globalForMongo = globalThis as unknown as {
  mongoose?: typeof mongoose;
};

/**
 * Opens or reuses the Mongoose connection.
 *
 * ## This does not create indexes
 *
 * Index synchronisation used to run here, after connecting and before returning,
 * which meant every cold start paid ~70 sequential `createIndex` calls (and a
 * `kitchenordertickets.updateMany`) inside the first user request. Measured cost
 * was 6.1s for the first `/dashboard` and 13.5s worst-case for a cold connect.
 *
 * It is now an explicit deployment step: `npm run db:indexes`.
 *
 * `autoIndex: false` closes the same door for Mongoose's own automatic index
 * creation, which would otherwise still fire on each serverless cold start. The
 * application continues to assume the declared indexes exist — they are created
 * and kept in sync by the explicit command, not by serving traffic.
 *
 * The request path is therefore exactly:
 *
 *     request -> connectDB() / reuse -> query -> response
 *
 * Warm calls are free: the global cache returns in ~0.2ms and no new connection
 * is ever created per request.
 */
export async function connectDB(): Promise<typeof mongoose> {
  const globalCached = globalForMongo.mongoose;
  if (globalCached && globalCached.connection.readyState === 1) {
    return globalCached;
  }
  if (mongoose.connection.readyState === 1) {
    globalForMongo.mongoose = mongoose;
    return mongoose;
  }

  try {
    const connection = await mongoose.connect(MONGODB_URI as string, {
      dbName: MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      // Indexes are managed explicitly via `npm run db:indexes`; see above.
      autoIndex: false,
    });
    globalForMongo.mongoose = connection;
    return connection;
  } catch {
    console.error("Failed to connect to MongoDB");
    throw new Error("Unable to connect to the database.");
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}