/**
 * Explicit index management — `npm run db:indexes`.
 *
 * ## Why this exists
 *
 * `connectDB()` used to run `syncIndexes()` for all 24 models after connecting,
 * which put roughly 70 sequential `createIndex` calls on the cold-start path of
 * every application request. Measured cost: 6.1s for the first `/dashboard`,
 * 13.5s worst-case cold connect. That work is a deployment concern, so it lives
 * here instead.
 *
 * ## Usage
 *
 *     npm run db:indexes            # sync indexes (create missing, drop stale)
 *     npm run db:indexes -- --dry-run   # report only, change nothing
 *     npm run db:indexes -- --check      # report and exit non-zero if out of date
 *
 * ## Safety
 *
 *   - Uses the same connection settings the application uses (dbName, timeout).
 *   - Idempotent: `syncIndexes()` issues only the difference, so a second run is
 *     a no-op.
 *   - Creates and drops *indexes* only. Never deletes documents, never drops a
 *     collection, never calls `dropDatabase()`, never seeds or resets data.
 *   - If a unique index cannot be built because existing documents violate it,
 *     the failure is reported per model and the run exits non-zero. Data is
 *     never deleted or rewritten to force an index through.
 *   - `--dry-run` reports the difference without applying anything.
 *
 * This is deliberately NOT behind `guardDestructiveScriptOrExit`: unlike
 * `db:reset`, it must be runnable against production during a deploy. It is
 * still safe there, because index synchronisation cannot lose business data.
 */

import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import {
  INDEXED_MODELS,
  syncAllIndexes,
  type SyncIndexesResult,
} from "../src/lib/db/index-sync";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || args.has("-n");
const checkOnly = args.has("--check");

async function report(results: SyncIndexesResult[]): Promise<{ changed: boolean; failed: number }> {
  let changed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.error) {
      failed += 1;
      console.log(
        `  FAILED  ${r.model.padEnd(24)} ${r.collection}\n            ${r.error}`
      );
      continue;
    }

    const delta =
      (r.created.length ? r.created.length : 0) + (r.dropped.length ? r.dropped.length : 0);
    if (delta > 0) changed += 1;

    const parts: string[] = [`${r.unchanged.length} unchanged`];
    if (r.created.length) parts.push(`created: ${r.created.join(", ")}`);
    if (r.dropped.length) parts.push(`dropped: ${r.dropped.join(", ")}`);

    console.log(
      `  ${delta > 0 ? "CHANGED" : "ok     "} ${r.model.padEnd(24)} ${r.collection.padEnd(28)} ${parts.join(" | ")}`
    );
  }

  return { changed: changed > 0, failed };
}

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

  // Never print the URI — it can contain credentials.
  const host = (() => {
    try {
      return new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://")).host;
    } catch {
      return "unknown";
    }
  })();

  console.log("");
  console.log("================================================================");
  console.log("  ZYP POS — index management");
  console.log("================================================================");
  console.log(`  Database : ${dbName}`);
  console.log(`  Host     : ${host}`);
  console.log(`  Mode     : ${dryRun ? "dry-run (no changes)" : checkOnly ? "check only" : "apply"}`);
  console.log(`  Models   : ${INDEXED_MODELS.length}`);
  console.log("");

  // Same connection semantics as the application.
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    autoIndex: false,
  });

  if (dryRun || checkOnly) {
    // `syncIndexes` would apply changes, so for a read-only report we compare
    // the declared index specs against what each collection actually has.
    const { syncIndexesDryRun } = await import("../src/lib/db/index-sync");
    const results = await syncIndexesDryRun();
    const { changed, failed } = await report(results);
    console.log("");
    if (failed > 0) {
      console.log(`  RESULT: ${failed} model(s) could not be inspected.`);
      process.exitCode = 1;
    } else if (changed) {
      console.log(`  RESULT: indexes are out of date. Re-run without --${dryRun ? "dry-run" : "check"}.`);
      if (checkOnly) process.exitCode = 1;
    } else {
      console.log("  RESULT: all declared indexes are present. Nothing to do.");
    }
  } else {
    const results = await syncAllIndexes();
    const { failed } = await report(results);
    console.log("");
    if (failed > 0) {
      console.log(
        `  RESULT: ${failed} model(s) failed. Existing data was left untouched —` +
          "\n          resolve the duplicates and re-run."
      );
      process.exitCode = 1;
    } else {
      const total = results.reduce((n, r) => n + r.unchanged.length + r.created.length, 0);
      console.log(`  RESULT: ${total} index(es) in place across ${results.length} collections.`);
      console.log("");
      console.log("  No documents were read for modification, none were written, and no");
      console.log("  collection was dropped.");
    }
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("");
  console.error("Index management failed:", error instanceof Error ? error.message : error);
  console.error("");
  process.exit(1);
});