import { describe, it, expect } from "vitest";
import {
  evaluateDestructiveDbTarget,
  assertDestructiveDbTargetAllowed,
  isProductionLikeDbName,
  isNonProductionDbName,
  isLocalMongoHost,
  safeMongoHost,
  buildGuardReport,
  ProductionDbGuardError,
  OVERRIDE_ENV_VAR,
  DEFAULT_DB_NAME,
  type GuardEnv,
} from "../scripts/lib/production-db-guard";

/**
 * The pure decision layer. The command-level proof that these rules are actually
 * wired into the real scripts lives in destructive-scripts.e2e.test.ts.
 */
const LOCAL = "mongodb://127.0.0.1:27018/restopos";
const ATLAS = "mongodb+srv://appuser:s3cr3tP4ssw0rd@cluster0.ab7cd.mongodb.net";

function env(overrides: GuardEnv): GuardEnv {
  return { MONGODB_URI: LOCAL, ...overrides };
}

function decide(overrides: GuardEnv, operation: "destructive" | "seed" = "destructive") {
  return evaluateDestructiveDbTarget({ operation, scriptName: "test", env: env(overrides) });
}

describe("signal helpers", () => {
  it("never leaks credentials when extracting a host", () => {
    expect(safeMongoHost(ATLAS)).toBe("cluster0.ab7cd.mongodb.net");
    expect(safeMongoHost("mongodb://127.0.0.1:27018/restopos")).toBe("127.0.0.1:27018");
    expect(safeMongoHost("mongodb://u:p@h.example.com:27017/db?retryWrites=true")).toBe(
      "h.example.com:27017"
    );
    expect(safeMongoHost(undefined)).toBeNull();
    const leaked = [ATLAS, "mongodb://u:p@h.example.com/db"].map(safeMongoHost).join(" ");
    expect(leaked).not.toMatch(/s3cr3t|appuser|:p@/);
  });

  it("recognises local hosts including docker service names", () => {
    for (const host of [
      "localhost:27017",
      "127.0.0.1:27018",
      "127.1.2.3",
      "::1",
      "mongo:27017",
      "host.docker.internal:27017",
    ]) {
      expect(isLocalMongoHost(host), host).toBe(true);
    }
    for (const host of ["cluster0.ab7cd.mongodb.net", "10.0.0.5:27017", ""]) {
      expect(isLocalMongoHost(host), host).toBe(false);
    }
  });

  it("classifies production-like database names", () => {
    for (const name of [
      "restopos_prod",
      "restopos-production",
      "restopos_production",
      "restopos_prd",
      "restoposlive",
      "restoposprod",
      "restoposproduction",
      "prod",
      "production",
    ]) {
      expect(isProductionLikeDbName(name), name).toBe(true);
    }
  });

  it("does not misclassify ordinary dev/test names as production", () => {
    for (const name of [
      "restopos",
      "restopos_qa",
      "restopos_qa_race",
      "restopos_test",
      "restopos_reports_e2e",
      "restopos_admin_e2e",
      "restopos_ratelimit_e2e",
      "restopos_demo",
      "restopos_local_dev",
      "priceless_albattani",
    ]) {
      expect(isProductionLikeDbName(name), name).toBe(false);
    }
  });

  it("treats a boundary match as production but not a substring inside a word", () => {
    expect(isProductionLikeDbName("reproduce_qa")).toBe(false);
    expect(isProductionLikeDbName("my_production_data")).toBe(true);
  });

  it("recognises every dev/QA marker this project actually uses", () => {
    for (const name of [
      "restopos_test",
      "restopos_qa",
      "restopos_qa_kot_cancel",
      "restopos_qa_race",
      "restopos_admin_e2e",
      "restopos_audit_e2e",
      "restopos_billing_e2e",
      "restopos_full_access_e2e",
      "restopos_servicekeys_persist_e2e",
      "restopos_demo",
      "restopos_local",
    ]) {
      expect(isNonProductionDbName(name), name).toBe(true);
    }
    expect(isNonProductionDbName("restopos")).toBe(false);
    expect(isNonProductionDbName("restopos_prod")).toBe(false);
  });
});

describe("PRODUCTION RULE — blocked", () => {
  it("1. NODE_ENV=production + production DB name -> BLOCK", () => {
    const d = decide({ NODE_ENV: "production", MONGODB_DB_NAME: "restopos_prod" });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain("NODE_ENV=production");
    expect(d.reasons.join(" ")).toContain("restopos_prod");
  });

  it("2. NODE_ENV=production + a NON-production DB name -> still BLOCK", () => {
    // A test-named database is still production if NODE_ENV says so.
    const d = decide({ NODE_ENV: "production", MONGODB_DB_NAME: "restopos_qa" });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain("NODE_ENV=production");
  });

  it("2b. NODE_ENV=production with NO db name set -> still BLOCK", () => {
    const d = decide({ NODE_ENV: "production", MONGODB_DB_NAME: undefined });
    expect(d.allowed).toBe(false);
    expect(d.dbName).toBe(DEFAULT_DB_NAME);
  });

  it("3. NODE_ENV=development + production-looking DB name -> BLOCK", () => {
    for (const name of ["restopos_prod", "restopos_production", "restopos_prd"]) {
      const d = decide({ NODE_ENV: "development", MONGODB_DB_NAME: name });
      expect(d.allowed, name).toBe(false);
      expect(d.reasons.join(" ")).toContain("production-like");
    }
  });

  it("3b. NODE_ENV unset + production-looking DB name -> BLOCK", () => {
    expect(decide({ MONGODB_DB_NAME: "restopos_prod" }).allowed).toBe(false);
  });

  it("the key scenario: NODE_ENV=development but pointing at a remote cluster with an unmarked DB", () => {
    const d = decide({
      NODE_ENV: "development",
      MONGODB_URI: ATLAS,
      MONGODB_DB_NAME: "restopos",
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(" ")).toContain("not marked as a dev/test/QA database");
  });

  it("blocks seed operations on exactly the same rules as destructive ones", () => {
    const prod = { NODE_ENV: "production", MONGODB_DB_NAME: "restopos_prod" };
    expect(decide(prod, "seed").allowed).toBe(false);
    expect(decide(prod, "destructive").allowed).toBe(false);
  });
});

describe("DEVELOPMENT / QA RULE — allowed", () => {
  it("4. NODE_ENV=development + normal local DB -> ALLOW", () => {
    const d = decide({ NODE_ENV: "development", MONGODB_DB_NAME: "restopos" });
    expect(d.allowed).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  it("4b. local host with the default db name and no NODE_ENV -> ALLOW", () => {
    expect(decide({ NODE_ENV: undefined }).allowed).toBe(true);
  });

  it("5. QA / test DB names -> ALLOW, on a local host and on a remote cluster", () => {
    const qaNames = [
      "restopos_qa",
      "restopos_test",
      "restopos_reports_e2e",
      "restopos_admin_e2e",
      "restopos_qa_kot_cancel",
      "restopos_demo",
      "restopos_scratch",
      "restopos_ci",
    ];
    for (const name of qaNames) {
      expect(decide({ NODE_ENV: "development", MONGODB_DB_NAME: name }).allowed, name).toBe(true);
      expect(
        decide({ NODE_ENV: "development", MONGODB_URI: ATLAS, MONGODB_DB_NAME: name }).allowed,
        `${name} on remote`
      ).toBe(true);
    }
  });

  it("6. development/test both allowed", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(decide({ NODE_ENV: nodeEnv, MONGODB_DB_NAME: "restopos" }).allowed, nodeEnv).toBe(
        true
      );
    }
  });
});

describe("explicit override", () => {
  const prodEnv: GuardEnv = {
    NODE_ENV: "production",
    MONGODB_URI: ATLAS,
    MONGODB_DB_NAME: "restopos_prod",
  };

  it("is disabled by default", () => {
    expect(decide(prodEnv).allowed).toBe(false);
    expect(decide({ ...prodEnv, [OVERRIDE_ENV_VAR]: undefined }).allowed).toBe(false);
  });

  it("requires the exact string 'true'", () => {
    for (const value of ["1", "yes", "TRUE ", "truex", "on", ""]) {
      const d = evaluateDestructiveDbTarget({
        operation: "destructive",
        scriptName: "t",
        env: { ...prodEnv, [OVERRIDE_ENV_VAR]: value },
      });
      expect(d.allowed, `override=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("permits a production target only when explicitly enabled", () => {
    const d = evaluateDestructiveDbTarget({
      operation: "destructive",
      scriptName: "t",
      env: { ...prodEnv, [OVERRIDE_ENV_VAR]: "true" },
    });
    expect(d.allowed).toBe(true);
    expect(d.overridden).toBe(true);
    expect(d.productionLike).toBe(true);
  });

  it("never turns a safe dev target into an 'override' path", () => {
    const d = decide({ NODE_ENV: "development", [OVERRIDE_ENV_VAR]: "true" });
    expect(d.allowed).toBe(true);
    expect(d.overridden).toBe(false);
  });
});

describe("error message", () => {
  const blocked = decide({
    NODE_ENV: "production",
    MONGODB_URI: ATLAS,
    MONGODB_DB_NAME: "restopos_prod",
  });

  it("11. is clear, actionable, and lists the reasons", () => {
    const report = buildGuardReport(blocked, { operation: "destructive", scriptName: "db:reset" });
    expect(report).toContain("BLOCKED");
    expect(report).toContain("db:reset");
    expect(report).toContain("restopos_prod");
    expect(report).toContain("NODE_ENV=production");
    expect(report).toContain("DISABLED BY DEFAULT");
    expect(report).toContain(OVERRIDE_ENV_VAR);
    expect(report).toContain("No connection was opened");
  });

  it("does not expose the connection string, username or password", () => {
    const report = buildGuardReport(blocked, { operation: "destructive", scriptName: "db:reset" });
    expect(report).not.toContain("s3cr3tP4ssw0rd");
    expect(report).not.toContain("appuser");
    expect(report).not.toContain("mongodb+srv://");
    expect(report).not.toContain("mongodb://");
  });

  it("throws a typed error that scripts can handle", () => {
    expect(() =>
      assertDestructiveDbTargetAllowed({
        operation: "destructive",
        scriptName: "db:reset",
        env: env({ NODE_ENV: "production" }),
      })
    ).toThrow(ProductionDbGuardError);
  });

  it("returns the decision for an allowed target", () => {
    const decision = assertDestructiveDbTargetAllowed({
      operation: "seed",
      scriptName: "db:seed",
      env: env({ NODE_ENV: "development" }),
    });
    expect(decision.allowed).toBe(true);
  });
});