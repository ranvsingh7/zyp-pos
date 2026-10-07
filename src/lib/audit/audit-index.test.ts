import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { listAuditLogs, countAuditLogs } from "@/lib/audit/audit-service";
import { declaredIndexName } from "@/lib/db/index-sync";

/**
 * Covers the `/audit` compound index introduced for the viewer query.
 *
 * The query under test is the one `listAuditLogs()` actually issues:
 *
 *     find({ restaurantId })
 *       .sort({ createdAt: -1, _id: -1 })
 *       .skip((page - 1) * 25)
 *       .limit(25)
 *
 * Assertions are structural (which index the planner picks, how many documents
 * it examines) rather than millisecond-based, so they cannot flake on a slow
 * machine while still failing if the index regressed.
 */

let mongod: MongoMemoryServer;
let tenantA = "";
let tenantB = "";

const PAGE_SIZE = 25;
/** Rows written for the tenant whose history is scanned. */
const TENANT_ROWS = 400;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await TableAuditLogModel.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function newId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

async function seedTenant(rows: number, action: string): Promise<mongoose.Types.ObjectId> {
  const oid = newId();
  const base = Date.UTC(2025, 0, 1);
  const docs = Array.from({ length: rows }, (_, i) => ({
    restaurantId: oid,
    action,
    entityType: "ORDER",
    entityId: `ORD-${String(i).padStart(6, "0")}`,
    success: true,
    // Every 5th row shares a timestamp so the `_id` tiebreaker in the sort is
    // genuinely exercised rather than being cosmetic.
    createdAt: new Date(base + Math.floor(i / 5) * 60_000),
  }));
  await TableAuditLogModel.insertMany(docs as never[], { ordered: false });
  return oid;
}

beforeEach(async () => {
  await TableAuditLogModel.collection.deleteMany({});
  tenantA = String(await seedTenant(TENANT_ROWS, "ORDER_CREATED"));
  tenantB = String(await seedTenant(30, "ORDER_CREATED"));
});

/** Runs the exact application query and returns the executionStats plan. */
async function explainListQuery(restaurantId: string, page = 1): Promise<{
  stage: string;
  plan: string;
  docsExamined: number;
  keysExamined: number;
  indexName: string | null;
}> {
  const ex = (await TableAuditLogModel.find({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  })
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .lean()
    .explain("executionStats")) as unknown as {
    executionStats: { totalDocsExamined: number; totalKeysExamined: number };
    queryPlanner: { winningPlan: Record<string, unknown> };
  };

  const chain: string[] = [];
  let indexName: string | null = null;
  let cur: Record<string, unknown> | undefined =
    ex.queryPlanner.winningPlan as Record<string, unknown>;
  while (cur) {
    chain.push(String(cur.stage));
    if (cur.indexName) indexName = String(cur.indexName);
    cur = cur.inputStage as Record<string, unknown> | undefined;
  }
  return {
    stage: chain[0] ?? "",
    plan: chain.join(" -> "),
    docsExamined: ex.executionStats.totalDocsExamined,
    keysExamined: ex.executionStats.totalKeysExamined,
    indexName,
  };
}

describe("/audit index declaration", () => {
  it("declares { restaurantId, createdAt:-1, _id:-1 } on the audit model", () => {
    const declared = TableAuditLogModel.schema.indexes().map(([fields, options]) =>
      declaredIndexName(fields, options ?? {})
    );
    expect(declared).toContain("restaurantId_1_createdAt_-1__id_-1");
  });

  it("keeps every previously declared audit index", () => {
    const declared = TableAuditLogModel.schema.indexes().map(([fields, options]) =>
      declaredIndexName(fields, options ?? {})
    );
    for (const preExisting of [
      "restaurantId_1_createdAt_-1",
      "restaurantId_1_userId_1_createdAt_-1",
      "restaurantId_1_entityType_1_entityId_1",
      "action_1_createdAt_-1",
      "entityType_1_entityId_1",
      "userId_1_createdAt_-1",
    ]) {
      expect(declared, `${preExisting} must not be removed`).toContain(preExisting);
    }
  });

  it("creates the index on the collection without dropping others", async () => {
    const indexes = await TableAuditLogModel.collection.indexes();
    const names = indexes.map((i) => i.name);
    expect(names).toContain("restaurantId_1_createdAt_-1__id_-1");
    expect(names).toContain("restaurantId_1_createdAt_-1");
    // No audit index is unique, and none may be silently removed.
    expect(indexes.filter((i) => i.unique)).toHaveLength(0);
  });
});

describe("/audit query uses the new index", () => {
  it("serves the unfiltered page load with an index scan and no sort stage", async () => {
    const q = await explainListQuery(tenantA);
    expect(q.indexName).toBe("restaurantId_1_createdAt_-1__id_-1");
    // A top-level SORT stage means MongoDB buffered the tenant history to
    // impose the { createdAt, _id } ordering — the bug this index fixes.
    expect(q.stage).not.toBe("SORT");
    expect(q.plan).toContain("IXSCAN");
  });

  it("examines only the returned page, not the tenant's whole history", async () => {
    const q = await explainListQuery(tenantA);
    // Before the index this was TENANT_ROWS (400); the index bounds it to the page.
    expect(q.docsExamined).toBeLessThanOrEqual(PAGE_SIZE);
    expect(q.keysExamined).toBeLessThanOrEqual(PAGE_SIZE);
    expect(q.docsExamined).toBeLessThan(TENANT_ROWS);
  });

  it("still scales: examined docs stay bounded as history grows", async () => {
    const before = await explainListQuery(tenantA);
    await TableAuditLogModel.insertMany(
      Array.from({ length: 5_000 }, (_, i) => ({
        restaurantId: new mongoose.Types.ObjectId(tenantA),
        action: "ORDER_CREATED",
        entityType: "ORDER",
        entityId: `BULK-${i}`,
        success: true,
        createdAt: new Date(Date.UTC(2024, 0, 1) + i * 1_000),
      })) as never[],
      { ordered: false }
    );
    const after = await explainListQuery(tenantA);
    // 5,400 documents in the tenant now, yet the page-1 scan is unchanged.
    expect(after.docsExamined).toBeLessThanOrEqual(PAGE_SIZE);
    expect(after.indexName).toBe(before.indexName);
  });
});

describe("/audit query behaviour is unchanged", () => {
  it("scopes every query to the authenticated restaurant", async () => {
    const forA = await listAuditLogs(tenantA, {});
    const forB = await listAuditLogs(tenantB, {});
    expect(forA.total).toBe(TENANT_ROWS);
    expect(forB.total).toBe(30);
    expect(forA.rows.every((r) => r.resourceId?.startsWith("ORD-"))).toBe(true);
  });

  it("never leaks another tenant's rows", async () => {
    const { rows } = await listAuditLogs(tenantA, { search: "ORD-" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actorName !== undefined)).toBe(true);
    // The other tenant exists but must not appear in A's page or total.
    expect(rows.some((r) => r.resourceId === undefined)).toBe(false);
    expect((await listAuditLogs(tenantA, {})).total).toBe(TENANT_ROWS);
  });

  it("keeps the { createdAt: -1, _id: -1 } ordering", async () => {
    const { rows } = await listAuditLogs(tenantA, {}, { page: 1, pageSize: PAGE_SIZE });
    expect(rows).toHaveLength(PAGE_SIZE);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const prevT = Date.parse(prev.createdAt);
      const curT = Date.parse(cur.createdAt);
      expect(prevT).toBeGreaterThanOrEqual(curT);
      if (prevT === curT) {
        // Same millisecond -> deterministic _id tiebreaker, still descending.
        expect(prev.id >= cur.id).toBe(true);
      }
    }
  });

  it("keeps pagination semantics: page size, totals and deep pages", async () => {
    const p1 = await listAuditLogs(tenantA, {}, { page: 1, pageSize: PAGE_SIZE });
    const p2 = await listAuditLogs(tenantA, {}, { page: 2, pageSize: PAGE_SIZE });
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(PAGE_SIZE);
    expect(p1.total).toBe(TENANT_ROWS);
    expect(p2.total).toBe(TENANT_ROWS);
    expect(p1.rows[0].id).not.toBe(p2.rows[0].id);
    // No overlap between consecutive pages.
    const ids1 = new Set(p1.rows.map((r) => r.id));
    expect(p2.rows.some((r) => ids1.has(r.id))).toBe(false);
  });

  it("keeps the action filter working", async () => {
    expect(await countAuditLogs(tenantA, { action: "ORDER_CREATED" })).toBe(TENANT_ROWS);
    expect(await countAuditLogs(tenantA, { action: "PAYMENT_RECORDED" })).toBe(0);
  });

  it("keeps the date-range filter working", async () => {
    // History starts 2025-01-01; a window inside it must match, one after it must not.
    expect(await countAuditLogs(tenantA, { fromYmd: "2025-01-01", toYmd: "2025-12-31" })).toBe(
      TENANT_ROWS
    );
    expect(await countAuditLogs(tenantA, { fromYmd: "2030-01-01" })).toBe(0);
  });
});