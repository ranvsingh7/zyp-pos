/**
 * Shared sliding-window rate limiter for authentication and other sensitive
 * entry points (attempts per key per window).
 *
 * The store of record is the `ratelimits` MongoDB collection (see
 * `src/models/RateLimit.ts`), reached through the application's existing
 * connection helper. That makes the budget shared: every Vercel lambda / Node
 * process reads and writes the same bucket, so brute-force protection no longer
 * resets whenever traffic lands on a different instance or a cold start spins up
 * a fresh process. No new service, client or connection mechanism was added.
 *
 * Semantics are deliberately unchanged from the previous in-memory
 * implementation:
 *   - sliding window: an attempt "expires" exactly `windowMs` after it was made;
 *   - `limit` attempts allowed per key per window;
 *   - once blocked, `retryAfterSeconds` counts down to the oldest live attempt;
 *   - keys stay composite (`login:<email>:<ip>`), so one tenant's traffic can
 *     never exhaust another's budget.
 *
 * Correctness under concurrency comes from performing the prune, the
 * limit check and the increment in ONE atomic document update, rather than a
 * read-then-write. Two simultaneous requests therefore cannot both pass the
 * check. The only remaining first-contact race (two concurrent upserts of a
 * brand-new key) is resolved by the unique index on `key` plus a bounded retry
 * on duplicate-key error.
 */

import { connectDB } from "@/lib/db";
import { RateLimitModel } from "@/models/RateLimit";

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until a new attempt is permitted, when blocked. */
  retryAfterSeconds: number;
}

/**
 * Sign-up throttling. Public account creation is a spam / DoS surface, so the
 * server action rate-limits by email + client IP using the same shared
 * sliding-window store as login (5 attempts per 15 minutes per key).
 */
export const SIGNUP_ATTEMPT_LIMIT = 5;
export const SIGNUP_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * How many times to retry when a concurrent first-contact upsert loses the
 * unique-index race. One retry is virtually always enough (the winner has
 * inserted the document); the extra attempts only add resilience under heavy
 * cold-start fan-out.
 */
const UPSERT_RACE_RETRIES = 3;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

export async function signupRateLimitDecision(
  email: string,
  ip?: string | null
): Promise<RateLimitDecision> {
  const key = `signup:${email.toLowerCase()}:${ip?.trim() || "unknown"}`;
  return rateLimit(key, SIGNUP_ATTEMPT_LIMIT, SIGNUP_ATTEMPT_WINDOW_MS);
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitDecision> {
  await connectDB();

  const now = Date.now();
  const cutoff = now - windowMs;

  // One atomic update that prunes the window, evaluates the limit and records
  // the attempt. Executed server-side as a single document write, so
  // concurrent callers for this key are serialised by MongoDB.
  const update: PipelineStage[] = [
    // 1. Drop attempts that have slid out of the window.
    {
      $set: {
        hits: {
          $filter: {
            input: { $ifNull: ["$hits", []] },
            as: "h",
            cond: { $gt: ["$$h", cutoff] },
          },
        },
      },
    },
    // 2. Decide against the pruned window. `limit` is request-derived, so it is
    //    passed in as a literal value rather than referencing a document field.
    {
      $set: {
        blocked: { $gte: [{ $size: "$hits" }, limit] },
      },
    },
    // 3. Record the attempt only when allowed. `hits` stays capped at `limit`,
    //    so a document can never grow without bound.
    {
      $set: {
        hits: {
          $cond: [
            "$blocked",
            "$hits",
            { $concatArrays: ["$hits", [now]] },
          ],
        },
      },
    },
    // 4. TTL anchor. Extending on every touch (allowed or blocked) keeps the
    //    document alive at least as long as any recorded hit.
    //    A JS Date is used deliberately: aggregation-pipeline updates bypass
    //    Mongoose casting, so an arithmetic expression such as $add would store
    //    a plain number and the TTL monitor would never reclaim the document.
    {
      $set: {
        updatedAt: now,
        expiresAt: new Date(now + windowMs),
      },
    },
  ];

  let doc: {
    hits?: number[];
    blocked?: boolean;
  } | null = null;

  for (let attempt = 0; attempt < UPSERT_RACE_RETRIES; attempt++) {
    try {
      doc = await RateLimitModel.findOneAndUpdate({ key }, update, {
        upsert: true,
        returnDocument: "after",
        updatePipeline: true,
      }).lean();
      break;
    } catch (error) {
      // A parallel instance created this bucket first. The document now exists,
      // so retrying turns the race into a normal (still atomic) update.
      if (!isDuplicateKeyError(error)) throw error;
      if (attempt === UPSERT_RACE_RETRIES - 1) {
        // Fail closed rather than silently disabling throttling. MongoDB is
        // reachable (we just wrote through it), so this indicates an unexpected
        // index/permission problem worth surfacing instead of ignoring.
        throw error;
      }
    }
  }

  if (!doc) {
    throw new Error("Failed to record rate-limit attempt.");
  }

  if (!doc.blocked) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // `hits` is ordered oldest-first, so entry 0 is the attempt that will free a
  // slot first — matching the previous in-memory implementation exactly.
  const oldest = doc.hits?.[0];
  if (typeof oldest !== "number") {
    return { allowed: false, retryAfterSeconds: 1 };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
  return { allowed: false, retryAfterSeconds };
}

/**
 * Clears all buckets. Used by tests and admin tooling.
 *
 * Async because the store is shared: this deletes the persisted buckets, which
 * is also how tests prove the limiter survives a process restart (a restarted
 * process loses all in-memory state but not this).
 */
export async function resetRateLimitStore(): Promise<void> {
  await connectDB();
  await RateLimitModel.deleteMany({});
}

type PipelineStage = Record<string, unknown>;