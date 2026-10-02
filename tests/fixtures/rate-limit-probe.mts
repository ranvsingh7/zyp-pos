/**
 * Rate-limit probe — runs as its OWN OS process.
 *
 * This exists to prove the property that in-process tests cannot: that separate
 * application instances share one budget. Each spawned process has its own
 * module registry, its own mongoose client and its own memory. The ONLY thing it
 * shares with its siblings is the MongoDB database.
 *
 * Usage: tsx --conditions=react-server rate-limit-probe.mts <key> <limit> <windowMs> <seq|par:N>
 * Prints one JSON line: {"allowed":n,"total":n,"results":[...]}
 */
import { rateLimit } from "@/lib/rate-limit";

const [key, limitRaw, windowRaw, modeRaw = "seq:1"] = process.argv.slice(2);
const limit = Number(limitRaw);
const windowMs = Number(windowRaw);
const [mode, countRaw = "1"] = modeRaw.split(":");
const count = Number(countRaw);

if (!key || !Number.isFinite(limit) || !Number.isFinite(windowMs) || !Number.isFinite(count)) {
  throw new Error(`Bad probe arguments: ${JSON.stringify(process.argv.slice(2))}`);
}

async function main() {
  const record = async () => await rateLimit(key, limit, windowMs);

  let results: Awaited<ReturnType<typeof rateLimit>>[] = [];

  if (mode === "par") {
    // Fire them simultaneously to race across process boundaries.
    results = await Promise.all(Array.from({ length: count }, record));
  } else if (mode === "seq") {
    for (let i = 0; i < count; i++) results.push(await record());
  } else {
    throw new Error(`Unknown mode: ${modeRaw}`);
  }

  if (results.length !== count) {
    throw new Error(`Probe produced ${results.length} results, expected ${count}`);
  }

  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      allowed: results.filter((r) => r.allowed).length,
      total: results.length,
      results: results.map((r) => ({ allowed: r.allowed, retryAfterSeconds: r.retryAfterSeconds })),
    }) + "\n"
  );
  // Close explicitly so mongoose releases the socket and the parent is not
  // left waiting on a live handle.
  process.exit(0);
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n"
  );
  process.exit(1);
});