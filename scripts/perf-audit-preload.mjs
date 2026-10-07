/**
 * ============================================================================
 * TEMPORARY PERFORMANCE PROFILING PRELOAD — NOT PART OF THE APPLICATION
 * ============================================================================
 * Patches the MongoDB driver prototypes *before* the Next.js server boots, so
 * every real HTTP request's database round-trips are logged with wall-clock
 * duration. Non-functional: it only observes, never alters a query, result,
 * index or document.
 *
 * Usage (local/QA only, never production):
 *   NODE_OPTIONS="--import ./scripts/perf-audit-preload.mjs" npm start
 *
 * Output (stderr), one line per command:
 *   [perf-db] +<ms-since-boot>ms op=<collection.verb> wall=<ms>ns
 * and, when the command is a cursor-based find/aggregate, the cursor is
 * re-wrapped so consumption time is measured too.
 *
 * Remove : delete this file. Nothing imports it.
 * ============================================================================
 */
const enabled = process.env.PERF_AUDIT === "1";
if (enabled) {
  const mongoose = (await import("mongoose")).default;
  const mongo = mongoose.mongo;
  const t0 = performance.now();
  const rel = () => `+${(performance.now() - t0).toFixed(0)}ms`;

  const log = (verb, ns, ms) => {
    process.stderr.write(
      `[perf-db] ${rel()} ${verb.padEnd(16)} ${ns.padEnd(34)} ${ms.toFixed(1)}ms\n`
    );
  };

  const wrap = (proto, method, verb, isCursor) => {
    const original = proto[method];
    if (typeof original !== "function" || original.__perfPatched) return;
    const patched = function (...args) {
      const ns = this.collectionName ?? this.s?.dbName ?? "admin";
      const start = performance.now();
      const finish = () => log(verb, ns, performance.now() - start);
      let out;
      try {
        out = original.apply(this, args);
      } catch (error) {
        finish();
        throw error;
      }
      if (isCursor && out && typeof out.toArray === "function") {
        // cursor: the server only starts work when the consumer drains it
        const toArray = out.toArray.bind(out);
        out.toArray = (...a) => {
          const s2 = performance.now();
          const p = toArray(...a);
          return p.then(
            (v) => {
              log(verb + ":drain", ns, performance.now() - s2);
              log(verb, ns, performance.now() - start);
              return v;
            },
            (e) => {
              log(verb + ":drain", ns, performance.now() - s2);
              log(verb, ns, performance.now() - start);
              throw e;
            }
          );
        };
        return out;
      }
      if (out && typeof out.then === "function") {
        return out.then(
          (v) => {
            finish();
            return v;
          },
          (e) => {
            finish();
            throw e;
          }
        );
      }
      finish();
      return out;
    };
    patched.__perfPatched = true;
    proto[method] = patched;
  };

  const cursorMethods = ["find", "aggregate"];
  for (const m of cursorMethods) wrap(mongo.Collection.prototype, m, m, true);
  for (const m of [
    "findOne",
    "countDocuments",
    "estimatedDocumentCount",
    "distinct",
    "insertOne",
    "insertMany",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "findOneAndUpdate",
    "bulkWrite",
    "createIndex",
    "createIndexes",
    "dropIndex",
    "listIndexes",
    "indexes",
  ]) {
    wrap(mongo.Collection.prototype, m, m, false);
  }
  wrap(mongo.Db.prototype, "command", "command", false);

  process.stderr.write(
    `[perf-db] driver instrumentation ACTIVE (${rel()})\n`
  );
}