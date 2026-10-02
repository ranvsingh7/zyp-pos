import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * Shared rate-limit buckets.
 *
 * The source of truth for throttling (login / sign-up) lives here, in MongoDB,
 * so every application instance — every Vercel lambda, every Node process —
 * reads and writes the same counter. The previous in-memory `Map` gave every
 * instance its own budget, which meant an attacker could simply spread login
 * attempts across instances (or force cold starts) to defeat brute-force
 * protection entirely.
 *
 * Each document is ONE logical bucket (`key`), updated with a single atomic
 * aggregation-pipeline `findOneAndUpdate`. MongoDB serialises concurrent updates
 * to the same document, so N simultaneous requests cannot all observe the
 * pre-increment state — the "check then insert" race is impossible here by
 * construction.
 *
 * Stored per document:
 *  - `key`      e.g. `login:<lowercased-email>:<ip>` — composite, so one
 *               tenant/identity can never exhaust another's budget.
 *  - `hits`     sliding-window attempt timestamps. Pruned to the live window on
 *               every write, so it never exceeds `limit` entries.
 *  - `blocked`  the decision computed by that write, returned to the caller.
 *  - `expiresAt` newest-attempt + window; a TTL index removes the document once
 *               the bucket can no longer affect any decision.
 *
 * Deliberately NOT stored: passwords, password hashes, tokens or any credential.
 * The key holds only an email and an IP, exactly the identity the limiter needs.
 */
const rateLimitSchema = new Schema(
  {
    /** Composite logical bucket identity. Never contains a secret. */
    key: {
      type: String,
      required: true,
    },
    /**
     * Sliding-window attempt timestamps (epoch ms), oldest first. Bounded by the
     * configured limit; expired entries are pruned by every write.
     */
    hits: {
      type: [Number],
      default: [],
    },
    /** Outcome of the most recent write to this bucket. */
    blocked: {
      type: Boolean,
      default: false,
    },
    /** Document-level TTL anchor; the bucket is meaningless once this passes. */
    expiresAt: {
      type: Date,
      required: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "ratelimits",
    minimize: false,
    versionKey: false,
  }
);

/**
 * One document per bucket. This unique index is what makes the shared counter
 * correct: it guarantees a bucket cannot be duplicated by two instances racing
 * on first contact, and it backs the `upsert` path.
 */
rateLimitSchema.index({ key: 1 }, { unique: true });

/**
 * Self-cleaning. Mongo's TTL monitor reclaims documents ~60s after `expiresAt`,
 * so the collection stays bounded without a sweeper job. Correctness never
 * depends on the TTL monitor running: expiry is evaluated inside the atomic
 * update (`hits` outside the window are pruned regardless of TTL).
 */
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RateLimit = InferSchemaType<typeof rateLimitSchema>;

export const RateLimitModel =
  (models.RateLimit as Model<RateLimit>) ||
  model<RateLimit>("RateLimit", rateLimitSchema);