import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import {
  BASIC_DEFAULT_SERVICE_KEYS,
  normalizeServiceKeys,
  type ServiceKey,
} from "../src/lib/services/catalog";

/**
 * Backfills the plan snapshot fields onto subscriptions and plans written
 * before the Plan document became the source of truth.
 *
 * This is deliberately idempotent and non-destructive: it only fills in fields
 * that are missing, and never rewrites a value that is already stored. Running
 * it twice is a no-op the second time.
 *
 * Usage:
 *   npm run db:backfill-plan-snapshots
 *
 *   --dry-run   report what would change without writing anything
 *
 * What it fills in:
 *   Plan.isFree              derived from billingCycle / pricePaise
 *   Plan.gracePeriodDays    from the platform default, for plans predating it
 *   Plan.serviceKeys        BASIC_DEFAULT_SERVICE_KEYS, when absent
 *   Subscription.planName   from the linked plan
 *   Subscription.isFree      derived from billingCycle / pricePaise
 *   Subscription.durationDays    from startDate -> expiryDate, when absent
 *   Subscription.gracePeriodDays from the linked plan, when absent
 *   Subscription.serviceKeys     from the linked plan, when absent
 *
 * `serviceKeys` is the one field where "absent" genuinely matters at runtime:
 * until it is written, `getServiceAccess()` falls back to the frozen legacy
 * list, so a pre-entitlement venue quietly keeps 9 modules. Filling the field
 * with the BASIC default makes the grant explicit and on the record. A plan
 * that already has an array — including a deliberately empty one — is left
 * exactly as it is, so a venue that intends to grant nothing keeps granting
 * nothing.
 *
 * A subscription whose plan no longer exists keeps its stored pricing and only
 * has its duration derived; it is reported, never dropped. An orphan with no
 * `serviceKeys` falls back to the BASIC default rather than being left on the
 * legacy list.
 */

type PlanDoc = {
  _id: mongoose.Types.ObjectId;
  name: string;
  billingCycle: string;
  pricePaise: number;
  isFree?: boolean;
  gracePeriodDays?: number;
  serviceKeys?: ServiceKey[] | null;
};

type SubscriptionDoc = {
  _id: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  planName?: string | null;
  billingCycle: string;
  listPricePaise: number;
  durationDays?: number | null;
  gracePeriodDays?: number | null;
  isFree?: boolean | null;
  startDate: Date;
  expiryDate: Date;
  serviceKeys?: ServiceKey[] | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Free is a property of the plan: FREE cycle or a ₹0 price.
 * `pricePaise` is the plan field name; callers pass a subscription's
 * `listPricePaise` in as that value.
 */
function deriveIsFree(doc: {
  billingCycle?: string;
  pricePaise?: number;
  isFree?: boolean | null;
}): boolean {
  if (doc.isFree === true) return true;
  if (doc.billingCycle === "FREE") return true;
  return Number(doc.pricePaise ?? 0) === 0;
}

/** Whole days from start to expiry, matching the existing start + duration rule. */
function deriveDurationDays(startDate: Date, expiryDate: Date): number {
  const ms = new Date(expiryDate).getTime() - new Date(startDate).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / DAY_MS);
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type BackfillResult = {
  planUpdates: number;
  subUpdates: number;
  orphaned: number;
  defaultGrace: number;
};

export type BackfillOptions = {
  dryRun?: boolean;
  log?: (line: string) => void;
  warn?: (line: string) => void;
};

/**
 * The migration itself, separated from the CLI so it can be exercised against a
 * throwaway database. Returns what it did (or, for a dry run, what it would do)
 * and never mutates a field that is already present.
 */
export async function backfillPlanSnapshots(
  db: mongoose.mongo.Db,
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const { dryRun = false, log = console.log, warn = console.warn } = options;

  const plans = db.collection<PlanDoc>("plans");
  const subscriptions = db.collection<SubscriptionDoc>("subscriptions");
  const settings = db.collection<{ gracePeriodDays?: number }>("platformsettings");

  const platformSettings = await settings.findOne({});
  const defaultGrace = Number(platformSettings?.gracePeriodDays ?? 0);
  if (!Number.isFinite(defaultGrace) || defaultGrace < 0) {
    throw new Error(`Platform gracePeriodDays is invalid: ${platformSettings?.gracePeriodDays}`);
  }

  log(`Platform default grace period: ${defaultGrace} days`);
  log(dryRun ? "DRY RUN — no writes will be made.\n" : "Backfilling...\n");

  const allPlans = await plans.find({}).toArray();
  const allSubscriptions = await subscriptions.find({}).toArray();

  // ---- Plans: fill in isFree and gracePeriodDays where absent -------------
  let planUpdates = 0;
  for (const plan of allPlans) {
    const $set: Record<string, unknown> = {};

    if (plan.isFree == null) {
      $set.isFree = deriveIsFree(plan);
    }
    if (plan.gracePeriodDays == null) {
      $set.gracePeriodDays = defaultGrace;
    }
    // Absent (or null) means the plan predates entitlements and would silently
    // inherit the 9-module legacy list. An array — even `[]` — is an explicit
    // decision by the platform and is left untouched.
    if (plan.serviceKeys == null) {
      $set.serviceKeys = [...BASIC_DEFAULT_SERVICE_KEYS];
    }
    if (Object.keys($set).length === 0) continue;

    if (!dryRun) {
      await plans.updateOne({ _id: plan._id }, { $set });
    }
    planUpdates += 1;
    log(`plan ${String(plan._id)} (${plan.name}): ${JSON.stringify($set)}`);
  }

  // ---- Subscriptions: fill the snapshot fields where absent ---------------
  const planById = new Map<string, PlanDoc>();
  for (const plan of allPlans) {
    // Mirror the value the plan loop would write, so a dry run and a real run
    // both hand the subscription loop the post-backfill view of the plan.
    const services = plan.serviceKeys ?? [...BASIC_DEFAULT_SERVICE_KEYS];
    planById.set(String(plan._id), { ...plan, serviceKeys: services });
  }

  let subUpdates = 0;
  let orphaned = 0;
  for (const sub of allSubscriptions) {
    const $set: Record<string, unknown> = {};
    const plan = planById.get(String(sub.planId));

    // Only set a name we can actually source. Writing `null` would make every
    // run report this orphan as changed again, breaking idempotency.
    if ((sub.planName == null || sub.planName === "") && plan?.name) {
      $set.planName = plan.name;
    }
    if (sub.isFree == null) {
      // A subscription stores its price as `listPricePaise`, not `pricePaise`.
      $set.isFree = deriveIsFree({
        billingCycle: sub.billingCycle,
        pricePaise: sub.listPricePaise,
      });
    }
    if (sub.durationDays == null) {
      const start = coerceDate(sub.startDate);
      const expiry = coerceDate(sub.expiryDate);
      const derived = start && expiry ? deriveDurationDays(start, expiry) : 0;
      // A duration of 0 means we could not derive one; leave it unset rather
      // than storing a lie the access logic would then trust.
      if (derived > 0) $set.durationDays = derived;
    }
    if (sub.gracePeriodDays == null) {
      $set.gracePeriodDays = plan?.gracePeriodDays ?? defaultGrace;
    }
    // Snapshot the plan's services onto the subscription so future plan edits
    // cannot retroactively change an already-issued subscription. Read from the
    // in-memory `allPlans` value, which already has the backfilled array, rather
    // than re-querying — otherwise a dry run would read pre-write state.
    if (sub.serviceKeys == null) {
      $set.serviceKeys = normalizeServiceKeys(
        plan?.serviceKeys ?? BASIC_DEFAULT_SERVICE_KEYS
      );
    }

    if (!plan) {
      orphaned += 1;
      warn(
        `subscription ${String(sub._id)}: plan ${String(sub.planId)} not found — ` +
          `keeping stored pricing, applying defaults only`
      );
    }

    if (Object.keys($set).length === 0) continue;

    if (!dryRun) {
      await subscriptions.updateOne({ _id: sub._id }, { $set });
    }
    subUpdates += 1;
    log(`subscription ${String(sub._id)}: ${JSON.stringify($set)}`);
  }

  log(`\n${dryRun ? "[dry run] would update" : "Updated"}: ${planUpdates} plan(s), ${subUpdates} subscription(s).`);
  if (orphaned > 0) {
    log(`Orphaned subscriptions (plan missing): ${orphaned} — review these manually.`);
  }
  log(dryRun ? "\nDry run complete; nothing was written." : "\nBackfill complete.");

  return { planUpdates, subUpdates, orphaned, defaultGrace };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME ?? "restopos";

  if (!uri) {
    console.error(
      "MONGODB_URI is not set. Copy .env.example to .env.local and fill in your MongoDB connection string first."
    );
    process.exit(1);
  }

  const connection = await mongoose.connect(uri, { dbName });
  const db = connection.connection.db;
  if (!db) {
    console.error("Could not access database connection.");
    process.exit(1);
  }

  await backfillPlanSnapshots(db, { dryRun });

  await connection.disconnect();
}

// Only run the CLI when executed directly, so importing this module in a test
// does not immediately open a connection against the real database.
const invokedDirectly =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
