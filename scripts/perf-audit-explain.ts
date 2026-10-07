/**
 * ============================================================================
 * TEMPORARY PERFORMANCE PROFILING HARNESS — NOT PART OF THE APPLICATION
 * ============================================================================
 * Runs `explain("executionStats")` for the exact query shapes the app issues,
 * against the configured database. STRICTLY READ-ONLY: explain only, no writes,
 * no index creation, no drops, no resets.
 *
 * Run  : npx tsx --conditions=react-server scripts/perf-audit-explain.ts
 * Remove: delete this file (nothing imports it).
 * ============================================================================
 */
import "server-only";

import fs from "node:fs";
import mongoose from "mongoose";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i > 0 && process.env[line.slice(0, i)] === undefined) {
    process.env[line.slice(0, i)] = line.slice(i + 1);
  }
}

const RID = new mongoose.Types.ObjectId("6abeaccefeadc0416b5174f9");
const from = new Date(Date.now() - 30 * 86400_000);
const to = new Date(Date.now() + 86400_000);

type Shape = {
  label: string;
  route: string;
  coll: string;
  cmd: "find" | "count" | "aggregate" | "distinct";
  /** Required for find/count/distinct. Aggregates carry their own `$match` stage. */
  filter?: Record<string, unknown>;
  sort?: Record<string, number>;
  skip?: number;
  limit?: number;
  projection?: Record<string, 1>;
  pipeline?: unknown[];
};

const shapes: Shape[] = [
  // ---------- guard prefix (identical on EVERY authenticated page) ----------
  { label: "guard: user by _id", route: "all pages", coll: "users", cmd: "find", filter: { _id: new mongoose.Types.ObjectId("6abeacce982bb11ba6cae041") }, limit: 1, projection: { fullName: 1, role: 1, restaurantId: 1 } },
  { label: "guard: restaurant by _id", route: "all pages", coll: "restaurants", cmd: "find", filter: { _id: RID }, limit: 1, projection: { name: 1, ownerId: 1 } },
  { label: "guard: subscription by restaurantId", route: "all pages", coll: "subscriptions", cmd: "find", filter: { restaurantId: RID }, limit: 1 },
  { label: "guard: platform settings by _id (EMPTY COLL)", route: "all pages", coll: "platformsettings", cmd: "find", filter: { _id: "platform-settings" }, limit: 1 },
  { label: "guard: ALL plans (unfiltered)", route: "all pages", coll: "plans", cmd: "find", filter: {}, projection: { name: 1, serviceKeys: 1 } },
  { label: "guard: staff list for name hydration", route: "orders,reports,billing", coll: "users", cmd: "find", filter: { restaurantId: RID }, projection: { fullName: 1, role: 1 } },

  // ---------- /pos ----------
  { label: "pos: tables (active, sorted)", route: "/pos", coll: "restauranttables", cmd: "find", filter: { restaurantId: RID, isActive: true }, sort: { displayOrder: 1 } },
  { label: "pos: sections", route: "/pos", coll: "tablesections", cmd: "find", filter: { restaurantId: RID }, sort: { displayOrder: 1 } },
  { label: "pos: menu categories", route: "/pos", coll: "menucategories", cmd: "find", filter: { restaurantId: RID, isActive: true }, sort: { displayOrder: 1 } },
  { label: "pos: menu items (full docs)", route: "/pos", coll: "menuitems", cmd: "find", filter: { restaurantId: RID, isActive: true } },
  { label: "pos: menu variants", route: "/pos", coll: "menuvariants", cmd: "find", filter: { restaurantId: RID } },
  { label: "pos: active orders (N+1 feeder)", route: "/pos", coll: "orders", cmd: "find", filter: { restaurantId: RID, status: { $in: ["OPEN", "PLACED", "COOKING", "READY", "SERVED"] } }, sort: { createdAt: -1 } },
  { label: "pos: held orders", route: "/pos", coll: "orders", cmd: "find", filter: { restaurantId: RID, status: "HELD" }, sort: { createdAt: -1 } },
  { label: "pos: printed KOTs for ONE order (runs N times!)", route: "/pos", coll: "kitchenordertickets", cmd: "find", filter: { restaurantId: RID, orderId: new mongoose.Types.ObjectId("6abeaceefeadc0416b51757e"), printedAt: { $ne: null }, status: { $ne: "CANCELLED" } }, projection: { items: 1 } },

  // ---------- /kot ----------
  { label: "kot: list KOTs sorted by printedAt", route: "/kot", coll: "kitchenordertickets", cmd: "find", filter: { restaurantId: RID, status: { $ne: "CANCELLED" } }, sort: { printedAt: -1, createdAt: -1 }, limit: 50 },

  // ---------- /menu, /tables ----------
  { label: "menu: ALL menu items, no projection", route: "/menu", coll: "menuitems", cmd: "find", filter: { restaurantId: RID } },
  { label: "menu: ALL menu categories", route: "/menu", coll: "menucategories", cmd: "find", filter: { restaurantId: RID } },
  { label: "tables: ALL tables", route: "/tables", coll: "restauranttables", cmd: "find", filter: { restaurantId: RID }, sort: { displayOrder: 1 } },

  // ---------- /orders ----------
  { label: "orders: list + count", route: "/orders", coll: "orders", cmd: "count", filter: { restaurantId: RID } },
  { label: "orders: page of orders", route: "/orders", coll: "orders", cmd: "find", filter: { restaurantId: RID }, sort: { createdAt: -1, _id: -1 }, skip: 0, limit: 20 },
  { label: "orders: bills by orderId $in (hydrate)", route: "/orders", coll: "bills", cmd: "find", filter: { restaurantId: RID, orderId: { $in: [new mongoose.Types.ObjectId("6abeaceefeadc0416b51757e")] }, status: { $nin: ["VOID", "CANCELLED"] } } },

  // ---------- /billing ----------
  { label: "billing: list bills (full docs)", route: "/billing", coll: "bills", cmd: "find", filter: { restaurantId: RID }, sort: { createdAt: -1 }, skip: 0, limit: 20 },
  { label: "billing: count bills", route: "/billing", coll: "bills", cmd: "count", filter: { restaurantId: RID } },

  // ---------- /audit  (12,967 docs — biggest collection) ----------
  { label: "audit: page of logs", route: "/audit", coll: "tableauditlogs", cmd: "find", filter: { restaurantId: RID }, sort: { createdAt: -1, _id: -1 }, skip: 0, limit: 25 },
  { label: "audit: count logs", route: "/audit", coll: "tableauditlogs", cmd: "count", filter: { restaurantId: RID } },
  { label: "audit: filter by action (date-range)", route: "/audit", coll: "tableauditlogs", cmd: "count", filter: { restaurantId: RID, action: "ORDER_CREATED", createdAt: { $gte: from, $lt: to } } },

  // ---------- dashboard aggregations ----------
  { label: "dash: bills sales KPI ($match status+paidAt)", route: "/dashboard", coll: "bills", cmd: "aggregate", pipeline: [{ $match: { restaurantId: RID, status: "PAID", paidAt: { $gte: from, $lt: to } } }, { $group: { _id: null, grandTotal: { $sum: "$grandTotalPaise" } } }] },
  { label: "dash: orders facet", route: "/dashboard", coll: "orders", cmd: "aggregate", pipeline: [{ $match: { restaurantId: RID, createdAt: { $gte: from, $lt: to } } }, { $facet: { total: [{ $count: "n" }], cancelled: [{ $match: { status: "CANCELLED" } }, { $count: "n" }] } }] },
  { label: "dash: payments + $lookup bills", route: "/dashboard", coll: "payments", cmd: "aggregate", pipeline: [{ $match: { restaurantId: RID, createdAt: { $gte: from, $lt: to } } }, { $lookup: { from: "bills", localField: "billId", foreignField: "_id", as: "bill" } }, { $match: { "bill.status": { $nin: ["CANCELLED", "REFUNDED"] } } }, { $facet: { total: [{ $group: { _id: null, total: { $sum: "$amountPaise" } } }] } }] },
  { label: "dash: top items ($unwind items)", route: "/dashboard", coll: "bills", cmd: "aggregate", pipeline: [{ $match: { restaurantId: RID, status: "PAID", paidAt: { $gte: from, $lt: to } } }, { $unwind: "$items" }, { $group: { _id: { id: "$items.menuItemId", name: "$items.nameSnapshot" }, quantity: { $sum: "$items.quantity" } } }, { $sort: { quantity: -1 } }, { $limit: 5 }] },
  { label: "dash: category sales ($unwind + 2 $lookup)", route: "/dashboard", coll: "bills", cmd: "aggregate", pipeline: [{ $match: { restaurantId: RID, status: "PAID", paidAt: { $gte: from, $lt: to } } }, { $unwind: "$items" }, { $group: { _id: "$items.menuItemId" } }, { $lookup: { from: "menuitems", localField: "_id", foreignField: "_id", as: "mi" } }, { $unwind: { path: "$mi", preserveNullAndEmptyArrays: true } }, { $lookup: { from: "menucategories", localField: "mi.categoryId", foreignField: "_id", as: "cat" } }, { $group: { _id: "$mi.categoryId", n: { $sum: 1 } } }] },
  { label: "dash: tables occupied count", route: "/dashboard", coll: "restauranttables", cmd: "count", filter: { restaurantId: RID, isActive: true, status: "OCCUPIED" } },
  { label: "dash: recent orders", route: "/dashboard", coll: "orders", cmd: "find", filter: { restaurantId: RID }, sort: { createdAt: -1 }, limit: 8 },

  // ---------- reports ----------
  { label: "reports/sales: count", route: "/reports", coll: "bills", cmd: "count", filter: { restaurantId: RID, status: "PAID", paidAt: { $gte: from, $lt: to } } },
  { label: "reports/sales: page sorted paidAt,_id", route: "/reports", coll: "bills", cmd: "find", filter: { restaurantId: RID, status: "PAID", paidAt: { $gte: from, $lt: to } }, sort: { paidAt: -1, _id: -1 }, skip: 0, limit: 25 },
  { label: "reports/orders: count", route: "/reports", coll: "orders", cmd: "count", filter: { restaurantId: RID, createdAt: { $gte: from, $lt: to } } },
  { label: "reports/payments: distinct orderId by bill", route: "/reports", coll: "bills", cmd: "distinct", filter: { restaurantId: RID } },

  // ---------- admin (unfiltered collection scans) ----------
  { label: "admin: ALL users (to label 25 rows)", route: "/admin/audit-logs", coll: "users", cmd: "find", filter: {}, projection: { fullName: 1, email: 1 } },
  { label: "admin: ALL restaurants (to label 25 rows)", route: "/admin/audit-logs", coll: "restaurants", cmd: "find", filter: {}, projection: { name: 1 } },
  { label: "admin: ALL restaurants (subscriptions list)", route: "/admin/subscriptions", coll: "restaurants", cmd: "find", filter: {}, projection: { name: 1 } },
  { label: "admin: ALL restaurants (admin dashboard)", route: "/admin", coll: "restaurants", cmd: "find", filter: {}, projection: { name: 1 } },
  { label: "admin: restaurants page", route: "/admin/restaurants", coll: "restaurants", cmd: "count", filter: {} },
  { label: "admin: subscriptions by status", route: "/admin/expired", coll: "subscriptions", cmd: "find", filter: { status: "EXPIRED" }, sort: { expiryDate: 1 }, limit: 25 },
  { label: "admin: subscriptions candidate set for status refresh", route: "/admin", coll: "subscriptions", cmd: "find", filter: { status: { $in: ["TRIAL", "ACTIVE", "GRACE_PERIOD", "EXPIRING"] } } },
  { label: "admin: restaurant name regex search", route: "/admin/restaurants", coll: "restaurants", cmd: "find", filter: { name: { $regex: "demo", $options: "i" } }, projection: { name: 1 } },
  { label: "admin: user email/fullName regex search", route: "/admin/restaurants", coll: "users", cmd: "find", filter: { $or: [{ fullName: { $regex: "demo", $options: "i" } }, { email: { $regex: "demo", $options: "i" } }] }, projection: { _id: 1 } },
];

function summarisePlan(plan: Record<string, unknown>, depth = 0): { stage: string; keys: number; docs: number; filter: string }[] {
  const out: { stage: string; keys: number; docs: number; filter: string }[] = [];
  const walk = (p: unknown) => {
    if (!p || typeof p !== "object") return;
    const n = p as Record<string, unknown>;
    const stage = Object.keys(n).find((k) => k.startsWith("$") && /Stage|Plan/.test(k));
    out.push({
      stage: stage ?? "?",
      keys: Number((n.totalKeysExamined as number) ?? 0),
      docs: Number((n.totalDocsExamined as number) ?? 0),
      filter: n.filter ? JSON.stringify(n.filter).slice(0, 60) : "-",
    });
    for (const key of ["inputStage", "inputStages", "thenStage", "shards"]) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v) walk(v);
    }
    if (n.queryPlan) walk(n.queryPlan);
    if (n.shardExplanation) return;
  };
  walk(plan);
  return out;
}

async function explainOne(db: mongoose.mongo.Db, s: Shape) {
  const col = db.collection(s.coll);
  const t0 = performance.now();
  let ex: Record<string, unknown>;
  let explainKind = s.cmd;
  if (s.cmd === "find") {
    // IMPORTANT: build the cursor exactly as the app does, then explain the
    // fully-formed cursor (sort/skip/limit/projection all included).
    let cursor = col.find(s.filter as never, s.projection as never);
    if (s.sort) cursor = cursor.sort(s.sort as never);
    if (s.skip) cursor = cursor.skip(s.skip);
    if (s.limit) cursor = cursor.limit(s.limit);
    ex = await cursor.explain("executionStats");
  } else if (s.cmd === "count") {
    const cursor = col.find(s.filter as never);
    ex = await cursor.explain("executionStats");
  } else if (s.cmd === "distinct") {
    ex = await db.command({
      explain: { distinct: s.coll, key: "orderId", query: s.filter },
      verbosity: "executionStats",
    });
  } else {
    ex = await db.command({ explain: { aggregate: s.coll, pipeline: s.pipeline, cursor: {} }, verbosity: "executionStats" });
    explainKind = "aggregate";
  }
  const wireMs = performance.now() - t0;

  const exec = (ex.executionStats ?? {}) as Record<string, unknown>;
  const qp = (ex.queryPlanner ?? {}) as Record<string, unknown>;
  const ws = qp.winningPlan as Record<string, unknown> | undefined;
  const stages = summarisePlan((ex.queryPlanner as Record<string, unknown>) ?? {});
  const rejected = ((qp.rejectedPlans as unknown[]) ?? []).length;
  return {
    wireMs,
    explainKind,
    stage: stages[0]?.stage ?? "?",
    keys: Number(exec.totalKeysExamined ?? 0),
    docs: Number(exec.totalDocsExamined ?? 0),
    ret: Number(exec.nReturned ?? 0),
    ms: Number(exec.executionTimeMillis ?? 0),
    planObj: exec.executionStages ? JSON.stringify(exec.executionStages).length : 0,
    rejected,
    stages,
    _ws: ws,
  };
}

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string, {
    dbName: process.env.MONGODB_DB_NAME || "restopos",
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 10,
  });
  const db = mongoose.connection.db!;
  console.log(
    "label | wire_ms | exec_ms | nRet | keysExam | docsExam | stage | COLLSCAN? | rejectedPlans"
  );
  const results: Array<Record<string, unknown>> = [];
  for (const s of shapes) {
    try {
      const r = await explainOne(db, s);
      const collscan = r.stages.some((x) => x.stage === "COLLSCAN") || r.stage === "COLLSCAN";
      const idxname =
        ((r._ws?.inputStage as Record<string, unknown> | undefined)?.indexName as string) ??
        (r._ws?.indexName as string) ??
        "";
      results.push({ ...s, ...r, collscan, idxname });
      console.log(
        `${s.label.padEnd(48)} | ${r.wireMs.toFixed(0).padStart(6)} | ${String(r.ms).padStart(6)} | ${String(r.ret).padStart(4)} | ${String(r.keys).padStart(9)} | ${String(r.docs).padStart(9)} | ${r.stage.padEnd(22)} | ${collscan ? "YES" : "no "} | ${r.rejected}${idxname ? " idx=" + idxname : ""}`
      );
      for (const st of r.stages.slice(1)) {
        console.log(`      child: ${st.stage} keys=${st.keys} docs=${st.docs} filter=${st.filter}`);
      }
    } catch (e) {
      console.log(`${s.label.padEnd(48)} | FAILED: ${(e as Error).message.slice(0, 70)}`);
    }
  }

  const slow = results.filter((r) => Number(r.ms) > 2 || r.collscan === true);
  console.log("\n=================== COLLSCAN / SLOW SUMMARY ===================");
  for (const r of slow) {
    console.log(
      `- ${r.label} [${r.route}] coll=${r.coll} exec=${r.ms}ms docsExamined=${r.docs} COLLSCAN=${r.collscan}`
    );
  }
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});