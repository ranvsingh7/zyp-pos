import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import path from "node:path";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { RateLimitModel } from "@/models/RateLimit";
import { hashPassword } from "@/lib/auth/password";
import { attemptLogin } from "@/lib/auth/login-service";
import { rateLimit, resetRateLimitStore } from "@/lib/rate-limit";

/**
 * Production requirement under test: the login rate-limit budget is SHARED
 * across independent application instances/processes and stays correct under
 * concurrency.
 *
 * "Independent instance" is modelled honestly — each probe below is a separate
 * OS process with its own memory and its own mongoose client. Nothing is
 * mocked: the probes execute the real limiter against a real MongoDB collection
 * with the real unique + TTL indexes. On Vercel the same property comes from the
 * shared database rather than shared process memory.
 */
const E2E_URI =
  process.env.MONGODB_E2E_URI ??
  "mongodb://127.0.0.1:27018/restopos_ratelimit_e2e";
const E2E_DB = "restopos_ratelimit_e2e";

const PROBE = path.resolve(__dirname, "fixtures/rate-limit-probe.mts");
const TSX = path.resolve(__dirname, "../node_modules/.bin/tsx");

const LIMIT = 5;
const WINDOW = 15 * 60 * 1000;

let available = false;

interface ProbeResult {
  pid: number;
  allowed: number;
  total: number;
  results: { allowed: boolean; retryAfterSeconds: number }[];
}

function runProbe(
  key: string,
  limit: number,
  windowMs: number,
  mode: string
): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      TSX,
      ["--conditions=react-server", PROBE, key, String(limit), String(windowMs), mode],
      {
        // Environment is supplied AT SPAWN so the child's connectDB() reads the
        // test database from the moment its modules load.
        env: {
          ...process.env,
          MONGODB_URI: E2E_URI,
          MONGODB_DB_NAME: E2E_DB,
          AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret",
        },
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}\n${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim().split("\n").pop() as string) as ProbeResult);
        } catch {
          reject(new Error(`Unparseable probe output: ${stdout}\n${stderr}`));
        }
      }
    );
  });
}

beforeAll(async () => {
  try {
    await mongoose.connect(E2E_URI, {
      dbName: E2E_DB,
      serverSelectionTimeoutMS: 3000,
    });
    await RateLimitModel.syncIndexes();
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  if (!available) return;
  await resetRateLimitStore();
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
});

/** Two real users in two different restaurants (tenants). */
async function seedTenantUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const restaurant = await RestaurantModel.create({
    name: `RL Tenant ${email}`,
    ownerId: new mongoose.Types.ObjectId(),
    isActive: true,
    businessType: "Restaurant",
    address: "1 Test St",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411001",
    phone: "9820000000",
  } as never);
  const ownerId = new mongoose.Types.ObjectId();
  const user = await UserModel.create({
    fullName: `Owner ${email}`,
    email,
    passwordHash,
    role: "OWNER",
    isActive: true,
    restaurantId: restaurant._id,
  } as never);
  await RestaurantModel.updateOne({ _id: restaurant._id }, { $set: { ownerId: user._id } });
  await RestaurantSettingsModel.create({ restaurantId: restaurant._id, currency: "INR" } as never);
  return { user, restaurant, ownerId };
}

describe("shared rate limiting across independent instances", () => {
  /**
   * Guards against a silent no-op. If the real database is unreachable the other
   * cases would return early and this suite would "pass" while proving nothing —
   * unacceptable for a security control. This fails loudly instead.
   */
  it("is running against a real MongoDB instance", () => {
    expect(
      available,
      `could not reach ${E2E_URI} — these tests verify real cross-process behaviour and must not be skipped`
    ).toBe(true);
    expect(RateLimitModel.collection.collectionName).toBe("ratelimits");
    expect(mongoose.connection.name).toBe(E2E_DB);
  });

  it("a second process inherits the budget burned by a first process", async () => {
    if (!available) return;

    const key = "login:shared@example.com:203.0.113.1";
    const first = await runProbe(key, LIMIT, WINDOW, `seq:${LIMIT}`);
    expect(first.allowed).toBe(LIMIT);
    expect(first.pid).toBeGreaterThan(0);

    // A DIFFERENT OS process, empty in-memory state, same database.
    const second = await runProbe(key, LIMIT, WINDOW, "seq:3");
    expect(second.pid).not.toBe(first.pid);
    expect(second.allowed).toBe(0);
    expect(second.results.every((r) => !r.allowed)).toBe(true);
    expect(second.results[0].retryAfterSeconds).toBeGreaterThan(0);
  });

  it("restarting a process does NOT reset the shared state", async () => {
    if (!available) return;

    const key = "login:restart@example.com:203.0.113.2";
    const pids = new Set<number>();

    const a = await runProbe(key, LIMIT, WINDOW, `seq:${LIMIT}`);
    pids.add(a.pid);
    expect(a.allowed).toBe(LIMIT);

    // Simulate instance #2 booting cold and retrying the same credentials.
    const b = await runProbe(key, LIMIT, WINDOW, "seq:1");
    pids.add(b.pid);
    expect(b.allowed).toBe(0);

    // Simulate instance #2 being recycled again (fresh cold start).
    const c = await runProbe(key, LIMIT, WINDOW, "seq:1");
    pids.add(c.pid);
    expect(c.allowed).toBe(0);

    // Genuinely different processes were involved at every step.
    expect(pids.size).toBeGreaterThanOrEqual(2);

    // And the state is demonstrably persisted, not held in any memory.
    const doc = await RateLimitModel.findOne({ key }).lean();
    expect(doc?.hits).toHaveLength(LIMIT);
  });

  it("survives a full in-memory wipe: the persisted bucket is the source of truth", async () => {
    if (!available) return;

    const key = "login:wipe@example.com:203.0.113.3";
    await runProbe(key, LIMIT, WINDOW, `seq:${LIMIT}`);

    // Delete every trace of in-process state (there is none by design) and
    // confirm a brand-new process is still blocked by the database record.
    const probe2 = await runProbe(key, LIMIT, WINDOW, "seq:1");
    expect(probe2.allowed).toBe(0);
  });

  it("concurrent requests across separate processes cannot bypass the limit", async () => {
    if (!available) return;

    const key = "login:concurrent@example.com:203.0.113.4";
    // 8 independent processes x 10 simultaneous requests each = 80 racing
    // requests hitting one shared bucket at once.
    const probes = await Promise.all(
      Array.from({ length: 8 }, () => runProbe(key, LIMIT, WINDOW, "par:10"))
    );

    const pids = new Set(probes.map((p) => p.pid));
    expect(pids.size, "each probe must be its own process").toBe(8);

    const totalAllowed = probes.reduce((sum, p) => sum + p.allowed, 0);
    const totalRequests = probes.reduce((sum, p) => sum + p.total, 0);
    expect(totalRequests).toBe(80);
    expect(totalAllowed, "exactly the limit may pass across all processes").toBe(LIMIT);

    const doc = await RateLimitModel.findOne({ key }).lean();
    expect(doc?.hits).toHaveLength(LIMIT);
    expect(await RateLimitModel.countDocuments({ key })).toBe(1);
  });

  it("window expiry observed across processes frees the budget", async () => {
    if (!available) return;

    const SHORT = 1200;
    const key = "login:expiry@example.com:203.0.113.5";

    const before = await runProbe(key, LIMIT, SHORT, `seq:${LIMIT}`);
    expect(before.allowed).toBe(LIMIT);
    expect((await runProbe(key, LIMIT, SHORT, "seq:1")).allowed).toBe(0);

    await new Promise((r) => setTimeout(r, SHORT + 400));

    // A different process, after the window slid, is allowed again.
    const after = await runProbe(key, LIMIT, SHORT, "seq:1");
    expect(after.allowed).toBe(1);

    const doc = await RateLimitModel.findOne({ key }).lean();
    expect(doc?.hits).toHaveLength(1);
  });

  it("does not leak buckets across processes for different users/tenants", async () => {
    if (!available) return;

    const a = `login:tenant-a@example.com:203.0.113.6`;
    const b = `login:tenant-b@example.com:203.0.113.6`;
    const c = `login:tenant-a@example.com:198.51.100.9`;

    expect((await runProbe(a, LIMIT, WINDOW, `seq:${LIMIT}`)).allowed).toBe(LIMIT);
    expect((await runProbe(a, LIMIT, WINDOW, "seq:1")).allowed).toBe(0);

    // Other tenant, same IP -> untouched budget.
    expect((await runProbe(b, LIMIT, WINDOW, "seq:1")).allowed).toBe(1);
    // Same tenant, different IP -> untouched budget.
    expect((await runProbe(c, LIMIT, WINDOW, "seq:1")).allowed).toBe(1);

    const keys = (await RateLimitModel.find({}, { key: 1 }).lean()).map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("login flow against the shared limiter", () => {
  const IP = "203.0.113.20";
  const GOOD = "CorrectPass123!";

  it("successful authentication still works", async () => {
    if (!available) return;
    await seedTenantUser("ok@example.com", GOOD);

    const result = await attemptLogin({
      email: "ok@example.com",
      password: GOOD,
      ip: IP,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe("OWNER");
    expect(await TableAuditLogModel.countDocuments({ action: "LOGIN", success: true })).toBe(1);
  });

  it("repeated failures across a single instance still get the existing error", async () => {
    if (!available) return;
    await seedTenantUser("locked@example.com", GOOD);

    for (let i = 0; i < LIMIT; i++) {
      const result = await attemptLogin({
        email: "locked@example.com",
        password: "WrongPass123!",
        ip: "198.51.100.7",
      });
      expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
    }

    // Even the CORRECT password is refused once throttled.
    const blocked = await attemptLogin({
      email: "locked@example.com",
      password: GOOD,
      ip: "198.51.100.7",
    });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("failures recorded by one process throttle the SAME account from another", async () => {
    if (!available) return;
    await seedTenantUser("cross@example.com", GOOD);

    // Process A burns the whole budget with wrong passwords.
    const key = `login:cross@example.com:${"198.51.100.77"}`;
    const burned = await runProbe(key, LIMIT, WINDOW, `seq:${LIMIT}`);
    expect(burned.allowed).toBe(LIMIT);

    // Process B — a different instance — is now blocked on the real login path,
    // and the error semantics are unchanged.
    const result = await attemptLogin({
      email: "cross@example.com",
      password: GOOD,
      ip: "198.51.100.77",
    });
    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });

    // The throttled attempt is still audited, as before.
    expect(
      await TableAuditLogModel.countDocuments({ action: "FAILED_LOGIN" })
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not throttle an unrelated account or IP", async () => {
    if (!available) return;
    await seedTenantUser("victim@example.com", GOOD);

    // Hammer one account from one IP until it is locked out.
    for (let i = 0; i < LIMIT + 2; i++) {
      await attemptLogin({
        email: "victim@example.com",
        password: "WrongPass123!",
        ip: "203.0.113.99",
      });
    }

    // A different user, and the same user from a different IP, are unaffected.
    await seedTenantUser("bystander@example.com", GOOD);
    const other = await attemptLogin({
      email: "bystander@example.com",
      password: GOOD,
      ip: "203.0.113.99",
    });
    expect(other.ok).toBe(true);

    const sameUserOtherIp = await attemptLogin({
      email: "victim@example.com",
      password: GOOD,
      ip: "203.0.113.100",
    });
    expect(sameUserOtherIp.ok).toBe(true);
  });

  it("recovers after the window expires", async () => {
    if (!available) return;
    await seedTenantUser("recovers@example.com", GOOD);

    const ip = "203.0.113.77";
    const key = `login:recovers@example.com:${ip}`;
    for (let i = 0; i < LIMIT; i++) await rateLimit(key, LIMIT, WINDOW);
    expect(
      await attemptLogin({ email: "recovers@example.com", password: GOOD, ip })
    ).toMatchObject({ ok: false, reason: "rate_limited" });

    // The login window is a fixed 15 minutes, so instead of sleeping we age the
    // persisted bucket past the window — exactly the state time produces. Real
    // elapsed-time expiry is verified above with a real short window.
    await rateLimit(key, LIMIT, WINDOW);
    await RateLimitModel.updateOne(
      { key },
      { $set: { hits: [Date.now() - WINDOW - 5000], expiresAt: new Date(Date.now() + WINDOW) } }
    );

    expect(
      await attemptLogin({ email: "recovers@example.com", password: GOOD, ip })
    ).toMatchObject({ ok: true });

    // The stale bucket was pruned in place rather than duplicated.
    const doc = await RateLimitModel.findOne({ key }).lean();
    expect(doc?.hits).toHaveLength(1);
    expect(await RateLimitModel.countDocuments({ key })).toBe(1);
  });

  it("throttling does not leak passwords into stored buckets or audit logs", async () => {
    if (!available) return;
    await seedTenantUser("secretive@example.com", GOOD);

    for (let i = 0; i < LIMIT + 2; i++) {
      await attemptLogin({
        email: "secretive@example.com",
        password: "SuperSecret123!",
        ip: "203.0.113.55",
      });
    }

    const buckets = JSON.stringify(await RateLimitModel.collection.find({}).toArray());
    expect(buckets).not.toContain("SuperSecret123!");
    expect(buckets).not.toMatch(/\$2[aby]\$/);

    const logs = JSON.stringify(
      (await TableAuditLogModel.collection.find({}).toArray()).map((l) => ({
        reason: l.reason,
        metadata: l.metadata,
      }))
    );
    expect(logs).not.toContain("SuperSecret123!");
  });
});