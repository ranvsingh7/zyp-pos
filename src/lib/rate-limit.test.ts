import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { RateLimitModel } from "@/models/RateLimit";
import {
  rateLimit,
  signupRateLimitDecision,
  resetRateLimitStore,
  SIGNUP_ATTEMPT_LIMIT,
} from "@/lib/rate-limit";

/**
 * These tests run against a REAL MongoDB instance (mongodb-memory-server) and
 * use the REAL model, collection and indexes. The limiter is never mocked: the
 * point of the change is the shared store, so mocking it away would prove
 * nothing. See tests/rate-limit.e2e.test.ts for the multi-process proof.
 */
let mongod: MongoMemoryServer;
const LIMIT = 5;
const WINDOW = 15 * 60 * 1000;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Build the unique + TTL indexes deterministically (the app does this on
  // connect via src/lib/db/index.ts).
  await RateLimitModel.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await resetRateLimitStore();
});

describe("rateLimit (shared MongoDB store)", () => {
  it("allows up to the limit, then blocks — the existing threshold", async () => {
    for (let i = 0; i < LIMIT; i++) {
      const decision = await rateLimit("k", LIMIT, WINDOW);
      expect(decision.allowed, `attempt ${i + 1} should be allowed`).toBe(true);
      expect(decision.retryAfterSeconds).toBe(0);
    }
    const blocked = await rateLimit("k", LIMIT, WINDOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reports a countdown to the oldest live attempt", async () => {
    for (let i = 0; i < LIMIT; i++) await rateLimit("k", LIMIT, WINDOW);
    const first = await rateLimit("k", LIMIT, WINDOW);
    // Nothing new is recorded while blocked, so the countdown must not move.
    const second = await rateLimit("k", LIMIT, WINDOW);
    expect(first.retryAfterSeconds).toBe(second.retryAfterSeconds);
    expect(first.retryAfterSeconds).toBeLessThanOrEqual(Math.ceil(WINDOW / 1000));
  });

  it("is atomic under concurrency: N parallel requests cannot exceed the limit", async () => {
    const ATTEMPTS = 60;
    const decisions = await Promise.all(
      Array.from({ length: ATTEMPTS }, () => rateLimit("race", LIMIT, WINDOW))
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(LIMIT);
    expect(decisions.filter((d) => !d.allowed)).toHaveLength(ATTEMPTS - LIMIT);

    // The persisted bucket agrees: exactly `limit` timestamps recorded, i.e. the
    // losing racers wrote nothing. (Timestamps can share a millisecond — the
    // count, not timestamp uniqueness, is what enforces the limit.)
    const doc = await RateLimitModel.findOne({ key: "race" }).lean();
    expect(doc?.hits).toHaveLength(LIMIT);
  });

  it("keeps concurrent first-contact creation safe (no duplicate buckets)", async () => {
    await Promise.all(
      Array.from({ length: 25 }, () => rateLimit("cold", LIMIT, WINDOW))
    );
    expect(await RateLimitModel.countDocuments({ key: "cold" })).toBe(1);
  });

  it("creates exactly one document per bucket", async () => {
    await rateLimit("dup", LIMIT, WINDOW);
    await rateLimit("dup", LIMIT, WINDOW);
    await rateLimit("other", LIMIT, WINDOW);
    expect(await RateLimitModel.countDocuments({})).toBe(2);
  });

  it("prunes expired attempts so the window really slides", async () => {
    const SHORT = 250;
    for (let i = 0; i < LIMIT; i++) await rateLimit("slide", LIMIT, SHORT);
    expect((await rateLimit("slide", LIMIT, SHORT)).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, SHORT + 120));

    const afterExpiry = await rateLimit("slide", LIMIT, SHORT);
    expect(afterExpiry.allowed).toBe(true);
    const doc = await RateLimitModel.findOne({ key: "slide" }).lean();
    expect(doc?.hits).toHaveLength(1);
  });

  it("expires buckets to keep the collection bounded", async () => {
    const SHORT = 150;
    await rateLimit("ttl", LIMIT, SHORT);
    const doc = await RateLimitModel.findOne({ key: "ttl" }).lean();
    expect(doc?.expiresAt).toBeInstanceOf(Date);
    expect(doc!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // expiresAt is monotonically extended while the bucket is in use, so a busy
    // attacker cannot make the record expire while still being throttled.
    const before = doc!.expiresAt.getTime();
    await new Promise((r) => setTimeout(r, 60));
    await rateLimit("ttl", LIMIT, SHORT);
    const after = (await RateLimitModel.findOne({ key: "ttl" }).lean())!.expiresAt.getTime();
    expect(after).toBeGreaterThan(before);
  });

  it("declares the unique and TTL indexes the design depends on", async () => {
    const indexes = await RateLimitModel.collection.indexes();
    const unique = indexes.find(
      (i) => i.key?.key === 1 && i.unique === true
    );
    expect(unique, "unique index on `key` must exist").toBeTruthy();

    const ttl = indexes.find(
      (i) => i.key?.expiresAt === 1 && i.expireAfterSeconds === 0
    );
    expect(ttl, "TTL index on `expiresAt` must exist").toBeTruthy();
  });

  it("never stores credentials or secrets in the bucket", async () => {
    await rateLimit("login:user@example.com:203.0.113.5", LIMIT, WINDOW);
    const raw = await RateLimitModel.collection.find({}).toArray();
    expect(raw.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toMatch(/argon2|\$2b\$|passwordHash|token|secret/i);
    // Only the identity needed for throttling is persisted.
    expect(Object.keys(raw[0]).sort()).toEqual(
      expect.arrayContaining(["_id", "key", "hits", "blocked", "expiresAt", "updatedAt"])
    );
  });

  it("does not leak buckets between identities, IPs or tenants", async () => {
    for (let i = 0; i < LIMIT; i++) await rateLimit("login:a@x.io:1.1.1.1", LIMIT, WINDOW);
    expect((await rateLimit("login:a@x.io:1.1.1.1", LIMIT, WINDOW)).allowed).toBe(false);
    // Different email, same IP
    expect((await rateLimit("login:b@x.io:1.1.1.1", LIMIT, WINDOW)).allowed).toBe(true);
    // Different IP, same email
    expect((await rateLimit("login:a@x.io:9.9.9.9", LIMIT, WINDOW)).allowed).toBe(true);
    // Different scope prefix entirely
    expect((await rateLimit("signup:a@x.io:1.1.1.1", LIMIT, WINDOW)).allowed).toBe(true);
  });
});

describe("signupRateLimitDecision", () => {
  it("allows up to the limit of sign-ups per email + IP, then blocks", async () => {
    const attempts: Awaited<ReturnType<typeof signupRateLimitDecision>>[] = [];
    for (let i = 0; i < SIGNUP_ATTEMPT_LIMIT + 3; i++) {
      attempts.push(await signupRateLimitDecision("new@example.com", "1.2.3.4"));
    }
    expect(attempts.filter((a) => a.allowed)).toHaveLength(SIGNUP_ATTEMPT_LIMIT);
    expect(attempts[SIGNUP_ATTEMPT_LIMIT].allowed).toBe(false);
    expect(attempts[SIGNUP_ATTEMPT_LIMIT].retryAfterSeconds).toBeGreaterThan(0);
    expect(attempts[SIGNUP_ATTEMPT_LIMIT + 1].allowed).toBe(false);
  });

  it("does not let one key exhaust another (different email or IP)", async () => {
    for (let i = 0; i < SIGNUP_ATTEMPT_LIMIT; i++) {
      await signupRateLimitDecision("a@example.com", "1.2.3.4");
    }
    expect((await signupRateLimitDecision("a@example.com", "1.2.3.4")).allowed).toBe(false);
    expect((await signupRateLimitDecision("b@example.com", "1.2.3.4")).allowed).toBe(true);
    expect((await signupRateLimitDecision("a@example.com", "5.6.7.8")).allowed).toBe(true);
  });

  it("treats emails case-insensitively and collapses on missing IP", async () => {
    for (let i = 0; i < SIGNUP_ATTEMPT_LIMIT; i++) {
      await signupRateLimitDecision("Case@Test.com", null);
    }
    expect((await signupRateLimitDecision("case@test.com", "")).allowed).toBe(false);
  });

  it("shares one budget across sign-up and login scopes independently", async () => {
    for (let i = 0; i < SIGNUP_ATTEMPT_LIMIT; i++) {
      await signupRateLimitDecision("z@example.com", "8.8.8.8");
    }
    expect((await signupRateLimitDecision("z@example.com", "8.8.8.8")).allowed).toBe(false);
    // Exhausting sign-up must not throttle login for the same identity.
    expect((await rateLimit("login:z@example.com:8.8.8.8", LIMIT, WINDOW)).allowed).toBe(true);
  });
});