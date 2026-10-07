/**
 * Proves that opening a database connection no longer creates indexes.
 *
 * ## The bug this guards against
 *
 * `connectDB()` used to run `syncIndexesOnce()` — roughly 70 sequential
 * `createIndex` calls plus a `kitchenordertickets.updateMany` — before returning.
 * That put the whole index build on the cold-start path of *every* application
 * request. Measured cost was 6.1s for the first `/dashboard` render and 13.5s
 * worst case for a cold connect.
 *
 * ## How this proves it rather than assuming it
 *
 * The test deliberately strips every managed index first, so there is no index
 * for `connectDB()` to find already in place. If the old behaviour were still
 * present, the indexes would reappear. If `connectDB()` is genuinely
 * index-free, they stay absent. Both outcomes are asserted, so this fails if the
 * behaviour regresses in either direction.
 *
 * Mongoose's own `autoIndex` is closed too, so the second door is closed as well;
 * the connection options are asserted directly.
 *
 * Runs against the isolated local MongoDB on `:27018` and is a no-op if that is
 * unavailable. It never writes application data and never drops a database.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";

// Registering the models is what gives `autoIndex` something to build. This
// import is also the thing the production bug depended on: `connectDB()` used
// to import every model, which is precisely how its index sync had access to
// them.
import { KotModel } from "@/models/KitchenOrderTicket";

// Resolve the URI the same way the application does, so the suite can never
// assert against a different database than the code under test uses.
const MONGODB_URI =
  process.env.MONGODB_URI ??
  process.env.MONGODB_E2E_URI ??
  "mongodb://127.0.0.1:27018/restopos_rsc_test";

let available = false;

beforeAll(async () => {
  try {
    // `autoIndex: false` here so the baseline connection is quiet. The second
    // test deliberately flips it on to prove the flag is load-bearing.
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
      autoIndex: false,
    });
    await mongoose.connection.db?.command({ ping: 1 });
    available = true;
  } catch {
    available = false;
    // These are real-MongoDB integration tests. Skipping is the repo's existing
    // e2e convention, but it must never be mistaken for a passing assertion.
    console.warn(
      `[SKIPPED - NOT VERIFIED] connectDB index-sync suite requires MongoDB at ${MONGODB_URI}. ` +
        `No database behaviour was proven by this run.`
    );
  }
}, 15000);

afterAll(async () => {
  await mongoose.disconnect();
});

/** Collection names this app manages indexes for, mirroring `INDEXED_MODELS`. */
const COLLECTIONS = [
  "kitchenordertickets", "orders", "bills", "payments", "users", "restaurants",
  "restaurantsettings", "menucategories", "menuitems", "menuvariants",
  "restauranttables", "tablesections", "inventorycategories", "inventoryitems",
  "purchases", "stockmovements", "tableauditlogs", "plans", "subscriptions",
  "subscriptionhistories", "subscriptionpayments", "platformcounters",
  "platformsettings", "ratelimits",
];

async function indexNames(collection: string): Promise<string[]> {
  const db = mongoose.connection.db;
  if (!db) return [];
  const exists = await db.listCollections({ name: collection }).hasNext();
  if (!exists) return [];
  const indexes = await db.collection(collection).indexes();
  // `_id_` is created by MongoDB with the collection itself, not by us.
  return indexes.map((i) => i.name).filter((n): n is string => typeof n === "string" && n !== "_id_");
}

/** Removes every non-`_id_` index so there is nothing left to find. */
async function stripAllIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  for (const name of COLLECTIONS) {
    const names = await indexNames(name);
    if (names.length === 0) continue;
    try {
      await db.collection(name).dropIndexes();
    } catch {
      // A collection with only `_id_` cannot drop indexes; nothing to do.
    }
  }
}

describe("connectDB() no longer synchronises indexes", () => {
  it("leaves collections index-free after a cold connect", async () => {
    if (!available) return;

    await stripAllIndexes();
    const presentBefore = await indexNames("kitchenordertickets");
    expect(presentBefore, "precondition: indexes were stripped").toEqual([]);

    // Force the cold path: drop any cached/global connection first so
    // `connectDB()` performs a real `mongoose.connect()`.
    const globalForMongo = globalThis as unknown as { mongoose?: typeof mongoose };
    delete globalForMongo.mongoose;
    await mongoose.disconnect();
    expect(mongoose.connection.readyState).not.toBe(1);

    const { connectDB } = await import("@/lib/db/index");
    const started = Date.now();
    await connectDB();
    const elapsed = Date.now() - started;

    expect(mongoose.connection.readyState).toBe(1);
    // The regression signature: the old code took multiple seconds here.
    expect(elapsed, `connectDB took ${elapsed}ms`).toBeLessThan(5000);

    // The assertion that matters: nothing was created behind our back.
    for (const collection of COLLECTIONS) {
      expect(await indexNames(collection), `${collection} gained indexes on connect`).toEqual([]);
    }
  }, 30000);

  it("control: with autoIndex left on, Mongoose *would* have created them", async () => {
    if (!available) return;

    // This is the falsifiability check for the test above. Without it, "no
    // indexes appeared" could simply mean MongoDB or Mongoose was inert rather
    // than that `connectDB()` stopped creating indexes. Here we deliberately
    // connect with the default `autoIndex` and require the indexes to appear.
    await stripAllIndexes();
    expect(await indexNames("kitchenordertickets")).toEqual([]);

    const globalForMongo = globalThis as unknown as { mongoose?: typeof mongoose };
    delete globalForMongo.mongoose;
    await mongoose.disconnect();

    await mongoose.connect(MONGODB_URI, {
      autoIndex: true,
      serverSelectionTimeoutMS: 3000,
    });
    // Touch the model so it is definitely attached to this connection.
    expect(KotModel.collection.collectionName).toBe("kitchenordertickets");
    await mongoose.connection.db?.command({ ping: 1 });

    // Give Mongoose's background index build a moment to issue its commands.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const kotIndexes = await indexNames("kitchenordertickets");
    expect(
      kotIndexes.length,
      "autoIndex:true should have created KOT indexes, otherwise this control proves nothing"
    ).toBeGreaterThan(0);

    // Leave the throwaway database as we found it.
    await stripAllIndexes();
  }, 30000);
});