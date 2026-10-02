/**
 * Production safety guard for destructive / demo-seeding database tooling.
 *
 * Scripts such as `db:reset`, `db:seed:demo` and `db:seed:demo:reset` permanently
 * delete or overwrite business data. They are convenient in development and
 * dangerous anywhere else: a single mistyped `MONGODB_URI`, or a stale
 * `.env.local` copied onto a production machine, is enough to wipe a live
 * database. A real incident in this project did exactly that to a local
 * database, which is why the protection is explicit rather than a comment.
 *
 * The guard is deliberately **fail-closed** and uses several independent signals,
 * because a single weak check is trivially bypassed by accident:
 *
 *   1. NODE_ENV === "production"                  -> always blocked
 *   2. Database name looks like production        -> always blocked
 *   3. Remote host AND database name is not marked
 *      as dev/test/QA                             -> blocked (this is the
 *      "NODE_ENV=development but pointing at the production cluster" case,
 *      which check #1 alone would miss entirely)
 *
 * Signal #3 is what makes this robust. Pointing `db:reset` at an Atlas cluster
 * with NODE_ENV=development is exactly the mistake that must not be possible,
 * and no amount of NODE_ENV checking catches it.
 *
 * Rules are enforced *before* any MongoDB connection is opened, so a blocked run
 * cannot touch data even in principle.
 *
 * Secrets are never printed: only the database name and a host with credentials
 * stripped. The connection string itself is never emitted.
 */

/** What the caller intends to do. Both are refused against production. */
export type DestructiveOperation = "destructive" | "seed";

export const DEFAULT_DB_NAME = "restopos";

/** Names that identify an obviously non-production target. */
const NON_PRODUCTION_DB_NAME_RE =
  /(test|qa|e2e|dev|local|sandbox|demo|tmp|temp|mock|fixture|scratch|ci)/i;

/**
 * Tokens that mark a production database. Matched as whole segments
 * (`restopos_prod`, `restopos-production`, `restopos_prd`) and also in
 * unseparated tail form (`restoposprod`). The segment boundary keeps innocent
 * names such as `reproduce_qa` out of this set.
 */
const PRODUCTION_DB_NAME_TOKENS = ["prod", "production", "prd", "live"];

/** Unseparated forms such as `restoposprod` / `restoposproduction`. */
const PRODUCTION_DB_NAME_SUFFIX_RE = /(prod|prd|production|live)[a-z0-9]*$/i;

/**
 * Hosts that are unambiguously a developer's own machine or container.
 * Anything else is treated as a remote/shared cluster.
 */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "mongo",
  "mongodb",
  "host.docker.internal",
]);

export const OVERRIDE_ENV_VAR = "ALLOW_DESTRUCTIVE_PRODUCTION_DB";

export class ProductionDbGuardError extends Error {
  readonly report: string;
  constructor(report: string) {
    super("Blocked: destructive database operation refused.");
    this.name = "ProductionDbGuardError";
    this.report = report;
  }
}

export interface GuardEnv {
  NODE_ENV?: string | undefined;
  MONGODB_URI?: string | undefined;
  MONGODB_DB_NAME?: string | undefined;
  [key: string]: string | undefined;
}

export interface GuardOptions {
  operation: DestructiveOperation;
  /** Human-readable script/command name for the error message. */
  scriptName: string;
  env?: GuardEnv;
}

export interface GuardDecision {
  allowed: boolean;
  /** Signals that fired, e.g. ["NODE_ENV=production", "database name looks production-like"]. */
  reasons: string[];
  dbName: string;
  /** Credentials-free host, or null when it could not be determined. */
  host: string | null;
  productionLike: boolean;
  /** True when the explicit override permitted a production target. */
  overridden: boolean;
}

// ---------------------------------------------------------------------------
// Signal helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Extracts the host from a MongoDB URI and strips any credentials.
 * Never returns the username, password or query string.
 */
export function safeMongoHost(uri: string | undefined | null): string | null {
  if (!uri) return null;
  // Strip credentials defensively before anything else touches the value.
  let hostPort = uri.trim();
  const schemeEnd = hostPort.indexOf("://");
  if (schemeEnd !== -1) hostPort = hostPort.slice(schemeEnd + 3);
  const at = hostPort.lastIndexOf("@");
  if (at !== -1) hostPort = hostPort.slice(at + 1);
  const slash = hostPort.indexOf("/");
  if (slash !== -1) hostPort = hostPort.slice(0, slash);
  const query = hostPort.search(/[?]/);
  if (query !== -1) hostPort = hostPort.slice(0, query);
  hostPort = hostPort.trim();
  if (!hostPort) return null;
  // Collapse credentials that survived an unusual URI shape to "<redacted>".
  if (hostPort.includes("@")) return "<redacted>";
  return hostPort;
}

/** Strips any `:port` suffix, keeping bracketed IPv6 literals intact. */
function bareHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.indexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

export function isLocalMongoHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const bare = bareHost(host);
  if (LOCAL_HOSTS.has(bare) || LOCAL_HOSTS.has(host.trim().toLowerCase())) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(bare)) return true;
  if (bare.endsWith(".localhost") || bare.endsWith(".local")) return true;
  return false;
}

export function isProductionLikeDbName(dbName: string): boolean {
  const name = dbName.toLowerCase();
  const segments = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (segments.some((segment) => PRODUCTION_DB_NAME_TOKENS.includes(segment))) {
    return true;
  }
  // `restoposproduction`, `prod2`, `restoposprod`
  if (PRODUCTION_DB_NAME_SUFFIX_RE.test(name)) return true;
  return name.includes("production");
}

export function isNonProductionDbName(dbName: string): boolean {
  return NON_PRODUCTION_DB_NAME_RE.test(dbName);
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * Pure decision function — no I/O, no side effects. Safe to unit test directly.
 */
export function evaluateDestructiveDbTarget(
  options: GuardOptions
): GuardDecision {
  const env = options.env ?? process.env;
  const dbName = (env.MONGODB_DB_NAME ?? "").trim() || DEFAULT_DB_NAME;
  const host = safeMongoHost(env.MONGODB_URI);
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();

  const productionLikeName = isProductionLikeDbName(dbName);
  const reasons: string[] = [];

  // Signal 1 — declared production runtime.
  if (nodeEnv === "production") {
    reasons.push("NODE_ENV=production");
  }

  // Signal 2 — the database is named like production.
  if (productionLikeName) {
    reasons.push(`database name "${dbName}" looks production-like`);
  }

  // Signal 3 — remote cluster + a database name that is not marked dev/test/QA.
  // Catches "NODE_ENV=development but pointed at the production cluster".
  const localHost = isLocalMongoHost(host);
  if (!localHost && !isNonProductionDbName(dbName)) {
    reasons.push(
      `database "${dbName}" is not marked as a dev/test/QA database but the host "${host ?? "unknown"}" is not local`
    );
  }

  const productionLike = reasons.length > 0;

  if (!productionLike) {
    return { allowed: true, reasons: [], dbName, host, productionLike, overridden: false };
  }

  // Deliberate, explicit emergency override. Never enabled by default and never
  // set in .env.local or the Vercel environment. It only ever applies when a
  // production target has actually been detected, so it cannot be used to make
  // a non-prod run "more allowed".
  //
  // The match is deliberately strict and case-sensitive: a flag that authorises
  // destroying production data should have to be typed exactly, not merely
  // resemble the right value.
  const override = env[OVERRIDE_ENV_VAR] === "true";
  if (override) {
    return { allowed: true, reasons, dbName, host, productionLike, overridden: true };
  }

  return { allowed: false, reasons, dbName, host, productionLike, overridden: false };
}

function describeOperation(operation: DestructiveOperation): string {
  return operation === "destructive"
    ? "destructive reset"
    : "demo seed";
}

export function buildGuardReport(decision: GuardDecision, options: GuardOptions): string {
  const { scriptName, operation } = options;
  const verb = describeOperation(operation);

  const lines = [
    "",
    "================================================================",
    "  BLOCKED: destructive database operation refused",
    "================================================================",
    "",
    `  Script      : ${scriptName}`,
    `  Operation   : ${verb}`,
    `  Database    : ${decision.dbName}`,
    `  Host        : ${decision.host ?? "unknown (MONGODB_URI not set)"}`,
    "",
    "  This target looks like PRODUCTION. Reasons:",
    ...decision.reasons.map((reason) => `    - ${reason}`),
    "",
    "  Production destructive operations are DISABLED BY DEFAULT.",
    "",
    "  To run this script, do one of the following:",
    "",
    "    1. Point MONGODB_URI / MONGODB_DB_NAME at a local or test database.",
    "       A database name containing test / qa / e2e / dev / local / sandbox /",
    "       demo is accepted against a remote host automatically.",
    "",
    "    2. For an intentional production maintenance operation only, re-run with",
    `       ${OVERRIDE_ENV_VAR}=true`,
    "       This is intentionally not set in .env.local or in the Vercel",
    "       environment, must be typed explicitly, and only applies when a",
    "       production target is detected.",
    "",
    "  No connection was opened and no data was read or modified.",
    "================================================================",
    "",
  ];
  return lines.join("\n");
}

/**
 * Evaluates the guard and throws `ProductionDbGuardError` when the target is not
 * safe. Call this BEFORE `mongoose.connect()` / any destructive operation.
 *
 * Throwing (rather than `process.exit`) keeps the guard unit-testable and lets
 * scripts fail loudly through their existing top-level error handler.
 */
export function assertDestructiveDbTargetAllowed(options: GuardOptions): GuardDecision {
  const decision = evaluateDestructiveDbTarget(options);

  if (decision.overridden) {
    console.warn(
      [
        "",
        "================================================================",
        "  WARNING: PRODUCTION OVERRIDE IN EFFECT",
        "================================================================",
        `  Script    : ${options.scriptName}`,
        `  Database  : ${decision.dbName}`,
        `  ${OVERRIDE_ENV_VAR} was set to "true".`,
        "  This performs a PERMANENT, IRREVERSIBLE change to what appears to be",
        "  production data. Verify the target database before continuing.",
        "================================================================",
        "",
      ].join("\n")
    );
  }

  if (!decision.allowed) {
    throw new ProductionDbGuardError(buildGuardReport(decision, options));
  }

  return decision;
}

/**
 * Convenience wrapper for scripts: evaluates, and on block prints the report to
 * stderr and exits non-zero. Call before connecting.
 */
export function guardDestructiveScriptOrExit(options: GuardOptions): GuardDecision {
  try {
    return assertDestructiveDbTargetAllowed(options);
  } catch (error) {
    if (error instanceof ProductionDbGuardError) {
      console.error(error.report);
      process.exit(1);
    }
    throw error;
  }
}