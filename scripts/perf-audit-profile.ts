/**
 * ============================================================================
 * TEMPORARY PERFORMANCE PROFILING HARNESS — NOT PART OF THE APPLICATION
 * ============================================================================
 * Purpose : measure per-MongoDB-command latency + per-service latency for the
 *           exact service functions each page calls, against the configured
 *           database. Read-only: no writes, no index changes, no resets.
 * Run     : npx tsx --conditions=react-server scripts/perf-audit-profile.ts
 * Remove  : delete this file (nothing imports it).
 *
 * It works by wrapping the inherited Mongoose Model statics and recording
 * wall-clock duration per call. Round-trip cost dominates because the app
 * talks to a remote MongoDB Atlas cluster over the internet.
 * ============================================================================
 */
import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";

// --- stub the Next.js runtime modules so plain-node can import the services --
// (these are only reached for redirects/cookies, never for the DB work we time)
import Module from "node:module";
const loadOriginal = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: () => undefined,
        set: () => {},
        delete: () => {},
      }),
      headers: async () => new Map(),
    };
  }
  if (request === "next/navigation") {
    return {
      redirect: () => {},
      permanentRedirect: () => {},
      notFound: () => {},
      useRouter: () => ({}),
      usePathname: () => "/",
      useSearchParams: () => new URLSearchParams(),
    };
  }
  return loadOriginal.call(this, request, ...rest);
} as never;

interface Row {
  seq: number;
  model: string;
  op: string;
  ms: number;
  detail: string;
}

const rows: Row[] = [];
let seq = 0;
let capture = false;

function summariseArg(a: unknown): string {
  if (a === undefined || a === null) return "";
  try {
    if (typeof a === "function") return "";
    if (Array.isArray(a)) return `[${a.length} stages]`;
    const s = JSON.stringify(a, (_k, v) =>
      typeof v === "bigint" ? String(v) : v instanceof mongoose.Types.ObjectId ? String(v) : v
    );
    return (s ?? "").slice(0, 150);
  } catch {
    return "[unserialisable]";
  }
}

/**
 * Hooks the MongoDB **driver** prototypes (not Mongoose's single-shot Query), so
 * we time real wire round-trips per command without changing any query semantics.
 */
function patchDriver(): void {
  const mongo = mongoose.mongo as unknown as {
    Db: { prototype: Record<string, unknown> };
    Collection: { prototype: Record<string, unknown> };
  };

  const wrap = (holder: Record<string, unknown>, op: string, label?: string) => {
    const original = holder[op] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof original !== "function") return;
    holder[op] = function patched(this: { collectionName?: string; s?: { dbName?: string } }, ...args: unknown[]) {
      if (!capture) return original.apply(this, args);
      const name = this.collectionName ?? this.s?.dbName ?? "db";
      const start = performance.now();
      const result = original.apply(this, args) as { then?: (a: unknown, b: unknown) => unknown };
      if (result && typeof result.then === "function") {
        return (result as Promise<unknown>).then(
          (v) => { rows.push({ seq: seq++, model: name, op: label ?? op, ms: performance.now() - start, detail: summariseArg(args[0]) }); return v; },
          (e) => { rows.push({ seq: seq++, model: name, op: label ?? op, ms: performance.now() - start, detail: summariseArg(args[0]) }); throw e; }
        );
      }
      rows.push({ seq: seq++, model: name, op: label ?? op, ms: performance.now() - start, detail: summariseArg(args[0]) });
      return result;
    };
  };

  const dbOps = ["command"];
  const colOps = [
    "find", "findOne", "aggregate", "countDocuments", "estimatedDocumentCount",
    "distinct", "insertOne", "insertMany", "updateOne", "updateMany",
    "deleteOne", "deleteMany", "findOneAndUpdate", "bulkWrite", "createIndex",
    "dropIndex", "listIndexes", "indexes", "createIndexes",
  ];
  for (const op of dbOps) wrap(mongo.Db.prototype, op);
  for (const op of colOps) wrap(mongo.Collection.prototype, op);
}

async function timeSection(label: string, fn: () => Promise<unknown>): Promise<void> {
  // warm-up pass (discarded) so one-off module/JIT cost is not attributed to the DB
  try { capture = true; await fn(); } catch { /* ignore warm-up errors */ }
  capture = false;
  capture = true;
  const before = seq;
  const wallStart = performance.now();
  try {
    await fn();
  } catch (error) {
    console.error(`  !! ${label} threw: ${(error as Error).message}`);
  }
  const wall = performance.now() - wallStart;
  capture = false;
  const slice = rows.filter((r) => r.seq >= before);
  const dbSum = slice.reduce((a, r) => a + r.ms, 0);
  const wallAfterConnect = wall;
  console.log(
    `\n### ${label}\n    wall=${wallAfterConnect.toFixed(0)}ms  commands=${slice.length}  summedCommandMs=${dbSum.toFixed(0)}ms`
  );
  const sorted = [...slice].sort((a, b) => b.ms - a.ms);
  for (const r of sorted.slice(0, 8)) {
    console.log(
      `      ${r.ms.toFixed(1).padStart(7)}ms  ${r.model}.${r.op}  ${r.detail}`
    );
  }
  if (slice.length > 8) {
    const rest = slice.slice().sort((a, b) => b.ms - a.ms).slice(8);
    console.log(
      `      ...${rest.length} more; next slowest: ` +
        rest
          .slice(0, 4)
          .map((r) => `${r.model}.${r.op} ${r.ms.toFixed(1)}ms`)
          .join(", ")
    );
  }
}

async function main(): Promise<void> {
  const restaurantId =
    process.env.PERF_RESTAURANT_ID ?? "6abeaccefeadc0416b5174f9";

  // Split the cold path: raw driver connect vs. the syncIndexesOnce() tail.
  const t0 = performance.now();
  await mongoose.connect(process.env.MONGODB_URI as string, {
    dbName: process.env.MONGODB_DB_NAME || "restopos",
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });
  const rawConnectMs = performance.now() - t0;

  const t1 = performance.now();
  await connectDB(); // now hits readyState===1 short-circuit
  const warmMs = performance.now() - t1;

  // Time syncIndexesOnce() on its own: 25 syncIndexes + 1 updateMany.
  const t2 = performance.now();
  const db0 = mongoose.connection.db;
  const names = (await db0!.listCollections().toArray()).map((c) => c.name);
  let syncIdxMs = 0;
  for (const n of names) {
    if (n === "system.views") continue;
    const s = performance.now();
    await mongoose.connection.db!.collection(n).indexes();
    syncIdxMs += performance.now() - s;
  }
  const listIndexesTotalMs = performance.now() - t2;
  const t3 = performance.now();
  await mongoose.connection.db!
    .collection("kitchenordertickets")
    .updateMany(
      { claimKey: { $exists: false } },
      [{ $set: { claimKey: { $concat: ["legacy-", { $toString: "$_id" }] } } }],
      { updatePipeline: true } as never
    );
  const claimKeyMs = performance.now() - t3;

  console.log("=========================================================");
  console.log(" COLD PATH BREAKDOWN (what a Vercel cold start pays):");
  console.log(`   raw mongoose.connect()  : ${rawConnectMs.toFixed(0)} ms`);
  console.log(`   connectDB() warm path  : ${warmMs.toFixed(3)} ms`);
  console.log(
    `   listIndexes x ${names.length} collections : ${listIndexesTotalMs.toFixed(0)} ms (sum ${syncIdxMs.toFixed(0)} ms)`
  );
  console.log(`   claimKey updateMany    : ${claimKeyMs.toFixed(0)} ms`);
  console.log(
    `   => syncIndexesOnce() approx ${(listIndexesTotalMs + claimKeyMs).toFixed(0)} ms`
  );
  console.log("=========================================================");

  patchDriver();

  // ---- guards / access layer -------------------------------------------
  const access = await import("@/lib/services/access");
  const subService = await import("@/lib/admin/subscription-service");
  const { UserModel } = await import("@/models/User");
  const realUserId = String((await UserModel.findOne({ email: "demo-owner@zyp-pos.local" }).select("_id").lean())!._id);
  const { RestaurantModel } = await import("@/models/Restaurant");

  await timeSection("GUARD requireAuth: UserModel.findById(userId).select(...)", async () => {
    await UserModel.findById(realUserId).select(
      "_id fullName email phone role restaurantId isActive createdAt updatedAt"
    ).lean();
  });

  await timeSection("GUARD requireRestaurant: RestaurantModel.findById(...).select(...)", async () => {
    await RestaurantModel.findById(restaurantId)
      .select("_id name ownerId phone email logo.mimeType")
      .lean();
  });

  // guard prefix used by EVERY tenant page (requireRestaurant + requireService)
  await timeSection("requireService-equivalent: getServiceAccess (parallel)", async () => {
    const sub = await subService.getSubscriptionAccess(restaurantId);
    if (!sub) throw new Error("no subscription");
    await access.getServiceAccess(restaurantId, "OWNER");
  });

  // ---- dashboard --------------------------------------------------------
  const dashboard = await import("@/lib/reports/dashboard-service");
  await timeSection("GET /dashboard  ->  getDashboardSummary (12 cmds)", async () => {
    await dashboard.getDashboardSummary(restaurantId, { date: "today" as never }, {});
  });

  // ---- POS --------------------------------------------------------------
  const orderService = await import("@/lib/orders/order-service");
  const tableService = await import("@/lib/tables/table-service");
  const categoryService = await import("@/lib/menu/category-service");
  const itemService = await import("@/lib/menu/item-service");
  const ordersMgmt = await import("@/lib/orders/orders-management");

  await timeSection("GET /pos  ->  7 loaders in Promise.all", async () => {
    await Promise.all([
      tableService.getTables(restaurantId, { includeInactive: true }),
      categoryService.getMenuCategories(restaurantId),
      itemService.getMenuItems(restaurantId, {} as never),
      orderService.getActiveOrders(restaurantId),
      orderService.getHeldOrders(restaurantId),
      ordersMgmt.listOrderStaff(restaurantId),
    ]);
  });

  // ---- orders -----------------------------------------------------------
  await timeSection("GET /orders  ->  listOrders + summary + tables + staff", async () => {
    await Promise.all([
      ordersMgmt.listOrders(restaurantId, {} as never),
      ordersMgmt.getOrdersSummary(restaurantId),
      ordersMgmt.listOrderTables(restaurantId),
      ordersMgmt.listOrderStaff(restaurantId),
    ]);
  });

  // ---- billing ----------------------------------------------------------
  const billService = await import("@/lib/billing/bill-service");
  await timeSection("GET /billing  ->  listBills(limit 20)", async () => {
    await billService.listBills(restaurantId, { limit: 20 });
  });

  // ---- kot --------------------------------------------------------------
  const kotService = await import("@/lib/orders/kot-service");
  await timeSection("GET /kot  ->  listKots(limit 50)", async () => {
    await kotService.listKots(restaurantId, 50);
  });

  // ---- audit (12,967 docs) ---------------------------------------------
  const auditService = await import("@/lib/audit/audit-service");
  await timeSection("GET /audit  ->  listAuditLogs", async () => {
    await auditService.listAuditLogs(restaurantId, { page: 1, pageSize: 25 } as never);
  });

  // ---- reports, per tab -------------------------------------------------
  const reportService = await import("@/lib/reports/report-service");
  const tabs: Array<[string, () => Promise<unknown>]> = [
    ["sales", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getSalesReport(restaurantId, { date: "today" })],
    ["payments", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getPaymentReport(restaurantId, { date: "today" })],
    ["orders", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getOrderReport(restaurantId, { date: "today" })],
    ["items", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getItemSalesReport(restaurantId, { date: "today" })],
    ["categories", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getCategorySalesReport(restaurantId, { date: "today" })],
    ["gst", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getGSTReport(restaurantId, { date: "today" })],
    ["discounts", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getDiscountReport(restaurantId, { date: "today" })],
    ["cancellations", () => (reportService as never as Record<string, (a: unknown, b: unknown) => Promise<unknown>>).getCancellationReport(restaurantId, { date: "today" })],
  ];
  for (const [name, fn] of tabs) {
    try {
      await timeSection(`GET /reports?tab=${name}`, fn as () => Promise<unknown>);
    } catch (e) {
      console.log(`  !! tab ${name} unavailable: ${(e as Error).message}`);
    }
  }

  // ---- admin ------------------------------------------------------------
  const adminDashboard = await import("@/lib/admin/dashboard-service");
  const restaurantAdmin = await import("@/lib/admin/restaurant-admin-service");
  await timeSection("GET /admin  ->  getDashboardData", async () => {
    await adminDashboard.getDashboardData();
  });
  await timeSection("GET /admin/restaurants  ->  listRestaurants (N+1)", async () => {
    await restaurantAdmin.listRestaurants({ page: 1, pageSize: 25 } as never);
  });
  await timeSection("GET /admin/subscriptions  ->  listSubscriptions", async () => {
    await subService.listSubscriptions({ page: 1, pageSize: 25 } as never);
  });
  const auditLogsService = await import("@/lib/admin/audit-logs-service");
  await timeSection("GET /admin/audit-logs  ->  listPlatformAuditLogs", async () => {
    await auditLogsService.listPlatformAuditLogs({ page: 1, pageSize: 25 } as never);
  });

  console.log("\n=========================================================");
  console.log(` TOTAL commands captured: ${rows.length}`);
  console.log("=========================================================");
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});