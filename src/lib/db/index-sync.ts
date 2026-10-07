/**
 * The single source of truth for which models' indexes the application requires,
 * and the one code path that synchronises them.
 *
 * ## Why this lives outside `src/lib/db/index.ts`
 *
 * Index synchronisation used to run inside `connectDB()`, which put roughly 70
 * sequential `createIndex` calls (plus a `kitchenordertickets.updateMany`) on
 * the cold-start path of *every* application request. Measured cost was a 6.1s
 * first `/dashboard` and a 13.5s worst-case `connectDB()`.
 *
 * `connectDB()` now only opens or reuses a connection. Index management is an
 * explicit deployment step (`npm run db:indexes`) that calls
 * `syncAllIndexes()` below.
 *
 * This module deliberately does **not** import `"server-only"`, because both the
 * application (`src/lib/db/index.ts`) and the CLI script
 * (`scripts/sync-indexes.ts`) need it. The single shared list is the point:
 * a model added to the app must not silently miss an index sync.
 */

import { KotModel } from "@/models/KitchenOrderTicket";
import { BillModel } from "@/models/Bill";
import { PaymentModel } from "@/models/Payment";
import { OrderModel } from "@/models/Order";
import { InventoryItemModel } from "@/models/InventoryItem";
import { InventoryCategoryModel } from "@/models/InventoryCategory";
import { PurchaseModel } from "@/models/Purchase";
import { StockMovementModel } from "@/models/StockMovement";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { SubscriptionPaymentModel } from "@/models/SubscriptionPayment";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { PlatformSettingsModel } from "@/models/PlatformSettings";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { TableSectionModel } from "@/models/TableSection";
import { RateLimitModel } from "@/models/RateLimit";

/** Minimal shape shared by every Mongoose model we manage indexes for. */
export interface IndexManagedModel {
  modelName: string;
  collection?: { collectionName?: string } | undefined;
  collectionName?: string | undefined;
  /** Declared indexes as `[spec, options]` pairs, as `Schema#indexes()` reports them. */
  schema: { indexes(): [Record<string, unknown>, { name?: string }][] };
  syncIndexes(options?: Record<string, unknown>): Promise<unknown>;
  listIndexes(): Promise<{ name: string; key?: Record<string, unknown> }[]>;
  createIndexes(): Promise<unknown>;
}

/**
 * Every model whose declared indexes are part of the application's contract.
 *
 * Order matters only for log readability; Mongoose issues each model's index
 * commands independently.
 */
export const INDEXED_MODELS: readonly IndexManagedModel[] = [
  KotModel,
  OrderModel,
  BillModel,
  PaymentModel,
  UserModel,
  RestaurantModel,
  RestaurantSettingsModel,
  MenuCategoryModel,
  MenuItemModel,
  MenuVariantModel,
  RestaurantTableModel,
  TableSectionModel,
  InventoryCategoryModel,
  InventoryItemModel,
  PurchaseModel,
  StockMovementModel,
  TableAuditLogModel,
  PlanModel,
  SubscriptionModel,
  SubscriptionHistoryModel,
  SubscriptionPaymentModel,
  PlatformCounterModel,
  PlatformSettingsModel,
  RateLimitModel,
] as unknown as readonly IndexManagedModel[];

/** Human-readable collection name for reports and dry-run output. */
export function collectionNameOf(model: IndexManagedModel): string {
  return model.collection?.collectionName ?? model.collectionName ?? model.modelName;
}

/**
 * The name MongoDB gives an index.
 *
 * `Schema#indexes()` only carries an explicit `options.name`. When a schema
 * declares `{ restaurantId: 1, createdAt: -1 }` with no name, Mongoose and
 * MongoDB both derive `restaurantId_1_createdAt_-1`. A dry run has to apply that
 * same rule, otherwise every unnamed index looks like it is "missing" and the
 * report is pure noise.
 */
export function declaredIndexName(
  fields: Record<string, unknown>,
  options: { name?: string }
): string {
  if (options.name) return options.name;
  return Object.entries(fields)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join("_");
}

/**
 * One-time data backfill that must happen before the KOT unique index can be
 * built. Kept here (rather than on the request path) for the same reason the
 * index sync moved: it is a maintenance operation, not a render-time one.
 *
 * Legacy KOTs predate `claimKey`. Without a stable value the unique
 * `{ restaurantId, claimKey }` index cannot be created, because every
 * `missing` field would collide with every other. Nothing is deleted or
 * rewritten beyond stamping a derived value onto rows that lack one.
 */
export async function backfillLegacyKotClaimKeys(): Promise<number> {
  const result = await KotModel.updateMany(
    { claimKey: { $exists: false } },
    [{ $set: { claimKey: { $concat: ["legacy-", { $toString: "$_id" }] } } }],
    { updatePipeline: true }
  );
  return result.modifiedCount ?? 0;
}

export interface SyncIndexesResult {
  model: string;
  collection: string;
  created: string[];
  dropped: string[];
  unchanged: string[];
  error: string | null;
}

/**
 * Synchronises declared indexes for every managed model.
 *
 * Idempotent: `syncIndexes()` compares the declared indexes against what the
 * collection actually has and issues only the difference. Running this twice is
 * a no-op the second time.
 *
 * Never destructive to data: it creates and drops *indexes* only. No collection
 * is dropped, no document is deleted, and `dropDatabase()` is never called. If a
 * unique index cannot be built because existing documents violate it, the
 * per-model error is reported and left for a human to resolve — the data is not
 * touched to force it through.
 */
export async function syncAllIndexes(): Promise<SyncIndexesResult[]> {
  const backfilled = await backfillLegacyKotClaimKeys();
  if (backfilled > 0) {
    console.log(
      `  backfilled claimKey on ${backfilled} legacy kitchen ticket(s) so the unique index could be built`
    );
  }

  const results: SyncIndexesResult[] = [];
  for (const model of INDEXED_MODELS) {
    const collection = collectionNameOf(model);
    const before = await model.listIndexes().catch(() => [] as { name: string }[]);
    const beforeNames = new Set(before.map((i) => i.name));

    try {
      await model.syncIndexes();
      const after = await model.listIndexes();
      const afterNames = new Set(after.map((i) => i.name));

      results.push({
        model: model.modelName,
        collection,
        created: [...afterNames].filter((n) => !beforeNames.has(n)),
        dropped: [...beforeNames].filter((n) => !afterNames.has(n)),
        unchanged: [...afterNames].filter((n) => beforeNames.has(n)),
        error: null,
      });
    } catch (error) {
      // Reported, not swallowed and not worked around by mutating data. A
      // duplicate-key violation here means existing documents conflict with a
      // unique index; the operator has to decide how to resolve that.
      results.push({
        model: model.modelName,
        collection,
        created: [],
        dropped: [],
        unchanged: [...beforeNames],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/** Total number of indexes currently present across every managed collection. */
export async function countRequiredIndexes(): Promise<number> {
  let total = 0;
  for (const model of INDEXED_MODELS) {
    const indexes = await model.listIndexes().catch(() => [] as { name: string }[]);
    total += indexes.length;
  }
  return total;
}

/**
 * Read-only comparison of declared indexes against what each collection has.
 *
 * Powers `--dry-run` / `--check`. Never issues a `createIndex` or `dropIndex`,
 * so it is safe to run against production at any time. A model whose
 * `schema.indexes()` cannot be read is reported with an error rather than
 * skipped silently.
 */
export async function syncIndexesDryRun(): Promise<SyncIndexesResult[]> {
  const results: SyncIndexesResult[] = [];

  for (const model of INDEXED_MODELS) {
    const collection = collectionNameOf(model);
    try {
      const declared = model.schema.indexes();
      const declaredNames = new Set<string>(
        declared.map(([fields, options]) => declaredIndexName(fields, options))
      );
      // A collection that does not exist yet simply has no indexes. That is a
      // "everything will be created" outcome, not a failure, so the same guard
      // the apply path uses applies here.
      const actual = await model.listIndexes().catch(() => [] as { name: string }[]);
      // `_id_` is created by MongoDB itself and is not declared in any schema.
      const actualNames = new Set(actual.map((i) => i.name));

      results.push({
        model: model.modelName,
        collection,
        created: [...declaredNames].filter((n) => !actualNames.has(n)).sort(),
        dropped: [...actualNames].filter((n) => n !== "_id_" && !declaredNames.has(n)).sort(),
        unchanged: [...declaredNames].filter((n) => actualNames.has(n)).sort(),
        error: null,
      });
    } catch (error) {
      results.push({
        model: model.modelName,
        collection,
        created: [],
        dropped: [],
        unchanged: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}