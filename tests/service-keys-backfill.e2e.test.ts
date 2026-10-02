/**
 * Regression tests for the `serviceKeys` half of the plan backfill.
 *
 * The bug this exists for: a venue's plan and subscription were written before
 * entitlements existed, so both documents have no `serviceKeys` field at all.
 * `getServiceAccess()` then falls back to the frozen legacy list, and a venue
 * that paid for five modules silently gets nine — including BILLING, KOT,
 * INVENTORY and REPORTS.
 *
 * The migration is only safe if it is:
 *   - additive  (never overwrites a value that is already stored),
 *   - idempotent (a second run is a no-op, so it is safe to re-run in prod),
 *   - dry-runnable (writes nothing when asked to preview),
 *   - careful with an explicit empty array, which means "this plan grants
 *     nothing" and must survive untouched.
 *
 * Everything here runs against a throwaway database, never the dev one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import {
  backfillPlanSnapshots,
  type BackfillResult,
} from "../scripts/backfill-plan-snapshots";
import {
  BASIC_DEFAULT_SERVICE_KEYS,
  LEGACY_SUBSCRIPTION_SERVICE_KEYS,
  isServiceKey,
  normalizeServiceKeys,
  type ServiceKey,
} from "@/lib/services/catalog";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018";
const SCRATCH_DB = "restopos_backfill_e2e";

let available = false;
let db: mongoose.mongo.Db;

type RawPlan = {
  name: string;
  billingCycle?: string;
  pricePaise?: number;
  isFree?: boolean;
  gracePeriodDays?: number;
  serviceKeys?: ServiceKey[];
  [k: string]: unknown;
};
type RawSub = {
  restaurantId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  planName?: string | null;
  // Supplied by default in insertSub; override only when a test cares.
  billingCycle?: string;
  listPricePaise?: number;
  isFree?: boolean;
  durationDays?: number | null;
  gracePeriodDays?: number | null;
  startDate?: Date;
  expiryDate?: Date;
  serviceKeys?: ServiceKey[];
  [k: string]: unknown;
};

const BASIC = [...BASIC_DEFAULT_SERVICE_KEYS];

/** Raw insert — the schemas would stamp a default and destroy the very state under test. */
async function insertPlan(doc: RawPlan): Promise<mongoose.Types.ObjectId> {
  const { insertedId } = await db.collection("plans").insertOne({
    billingCycle: "MONTHLY",
    pricePaise: 99900,
    isFree: false,
    gracePeriodDays: 3,
    ...doc,
  } as never);
  return insertedId;
}

async function insertSub(doc: RawSub): Promise<mongoose.Types.ObjectId> {
  const { insertedId } = await db.collection("subscriptions").insertOne({
    billingCycle: "MONTHLY",
    listPricePaise: 99900,
    isFree: false,
    durationDays: 30,
    gracePeriodDays: 3,
    planName: null,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    expiryDate: new Date("2026-01-31T00:00:00.000Z"),
    ...doc,
  } as never);
  return insertedId;
}

const readPlan = async (id: mongoose.Types.ObjectId) =>
  db.collection("plans").findOne({ _id: id });
const readSub = async (id: mongoose.Types.ObjectId) =>
  db.collection("subscriptions").findOne({ _id: id });

/** Silent run: the assertions are about the database, not the console. */
function run(options: { dryRun?: boolean } = {}): Promise<BackfillResult> {
  return backfillPlanSnapshots(db, { dryRun: options.dryRun ?? false, log: () => {}, warn: () => {} });
}

beforeAll(async () => {
  try {
    const conn = await mongoose
      .createConnection(MONGODB_E2E_URI, {
        dbName: SCRATCH_DB,
        serverSelectionTimeoutMS: 3000,
      })
      // `conn.db` stays undefined until the handshake resolves, so await it
      // before touching it rather than after.
      .asPromise();
    await conn.db?.command({ ping: 1 });
    if (!conn.db) throw new Error("no database handle");
    db = conn.db;
    available = true;
  } catch {
    available = false;
  }
}, 15000);

afterAll(async () => {
  if (available && db) {
    await db.dropDatabase().catch(() => undefined);
  }
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!available) return;
  await Promise.all([
    db.collection("plans").deleteMany({}),
    db.collection("subscriptions").deleteMany({}),
    db.collection("platformsettings").deleteMany({}),
  ]);
});

describe("plan backfill: serviceKeys", () => {
  it("fills a plan that predates entitlements with the BASIC default", async () => {
    if (!available) return;
    const planId = await insertPlan({ name: "Silver" });
    expect((await readPlan(planId))?.serviceKeys).toBeUndefined();

    await run();

    expect((await readPlan(planId))?.serviceKeys).toEqual(BASIC);
  });

  it("snapshots the plan's services onto a subscription that has none", async () => {
    if (!available) return;
    const planId = await insertPlan({ name: "Pro", serviceKeys: ["DASHBOARD", "POS", "MENU", "BILLING"] });
    const subId = await insertSub({ restaurantId: new mongoose.Types.ObjectId(), planId });
    expect((await readSub(subId))?.serviceKeys).toBeUndefined();

    await run();

    // Copied from the PLAN, not from BASIC: the plan is the source of truth.
    expect((await readSub(subId))?.serviceKeys).toEqual(
      normalizeServiceKeys(["DASHBOARD", "POS", "MENU", "BILLING"])
    );
  });

  it("uses the backfilled plan value when the plan was itself missing services", async () => {
    if (!available) return;
    // Plan has no array; the subscription must inherit what the plan is being
    // given in this same run, not a stale read from before the write.
    const planId = await insertPlan({ name: "Silver" });
    const subId = await insertSub({ restaurantId: new mongoose.Types.ObjectId(), planId });

    await run();

    expect((await readSub(subId))?.serviceKeys).toEqual(BASIC);
  });

  it("never overwrites a plan that already has services", async () => {
    if (!available) return;
    const custom = ["DASHBOARD", "POS", "MENU", "TABLES", "ORDERS", "KOT", "INVENTORY"];
    const planId = await insertPlan({ name: "Pro", serviceKeys: custom as ServiceKey[] });

    const result = await run();

    expect(result.planUpdates).toBe(0);
    expect((await readPlan(planId))?.serviceKeys).toEqual(custom);
  });

  it("treats an explicit empty array as 'grants nothing' and leaves it alone", async () => {
    if (!available) return;
    const planId = await insertPlan({ name: "Kiosk", serviceKeys: [] });
    const subId = await insertSub({
      restaurantId: new mongoose.Types.ObjectId(),
      planId,
      serviceKeys: [],
    });

    await run();

    // This is the one case where a naive `if (!keys.length)` would silently
    // grant five modules to a plan the platform deliberately emptied.
    expect((await readPlan(planId))?.serviceKeys).toEqual([]);
    expect((await readSub(subId))?.serviceKeys).toEqual([]);
  });

  it("never overwrites a subscription that already has a snapshot", async () => {
    if (!available) return;
    const planId = await insertPlan({ name: "Silver" });
    const snapshot = ["DASHBOARD", "POS"] as ServiceKey[];
    const subId = await insertSub({
      restaurantId: new mongoose.Types.ObjectId(),
      planId,
      serviceKeys: snapshot,
    });

    await run();

    // `subUpdates` counts every field the backfill touches, and this
    // subscription also picks up a `planName`; the invariant under test is
    // specifically that the stored snapshot is left alone.
    expect((await readSub(subId))?.serviceKeys).toEqual(snapshot);
  });

  it("is idempotent: a second run changes nothing", async () => {
    if (!available) return;
    const planId = await insertPlan({ name: "Silver" });
    const subId = await insertSub({ restaurantId: new mongoose.Types.ObjectId(), planId });

    const first = await run();
    expect(first.planUpdates).toBeGreaterThan(0);
    expect(first.subUpdates).toBeGreaterThan(0);

    const planAfter = (await readPlan(planId))?.serviceKeys;
    const subAfter = (await readSub(subId))?.serviceKeys;

    const second = await run();

    // The property that makes this safe to re-run against production.
    expect(second).toMatchObject({ planUpdates: 0, subUpdates: 0 });
    expect((await readPlan(planId))?.serviceKeys).toEqual(planAfter);
    expect((await readSub(subId))?.serviceKeys).toEqual(subAfter);
  });

  it("writes nothing in a dry run but still reports the work", async () => {
    if (!available) return;
    const planId = await insertPlan({ name: "Silver" });
    const subId = await insertSub({ restaurantId: new mongoose.Types.ObjectId(), planId });

    const result = await run({ dryRun: true });

    expect(result).toMatchObject({ planUpdates: 1, subUpdates: 1 });
    expect((await readPlan(planId))?.serviceKeys).toBeUndefined();
    expect((await readSub(subId))?.serviceKeys).toBeUndefined();
  });

  it("gives an orphaned subscription the BASIC default and reports it", async () => {
    if (!available) return;
    const subId = await insertSub({
      restaurantId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(), // no such plan
      serviceKeys: undefined,
    });

    const result = await run();

    expect(result.orphaned).toBe(1);
    // Must not be left on the legacy list, which is the bug being fixed.
    expect((await readSub(subId))?.serviceKeys).toEqual(BASIC);
  });

  it("only ever writes keys the catalog recognises", async () => {
    if (!available) return;
    const planId = await insertPlan({ name: "Silver" });
    const subId = await insertSub({ restaurantId: new mongoose.Types.ObjectId(), planId });
    await run();

    for (const doc of [await readPlan(planId), await readSub(subId)]) {
      for (const key of doc?.serviceKeys ?? []) {
        expect(isServiceKey(key), `${key} is not a real service key`).toBe(true);
      }
    }
  });
});

describe("the value the migration writes", () => {
  it("is strictly narrower than the legacy fallback it replaces", async () => {
    if (!available) return;
    // Guards the intent of the choice made for this fix: after the migration a
    // legacy venue must actually LOSE the modules it was borrowing.
    const legacyOnly = LEGACY_SUBSCRIPTION_SERVICE_KEYS.filter(
      (key) => !BASIC_DEFAULT_SERVICE_KEYS.includes(key)
    );
    expect(legacyOnly).toEqual(["BILLING", "KOT", "INVENTORY", "REPORTS"]);
  });
});
