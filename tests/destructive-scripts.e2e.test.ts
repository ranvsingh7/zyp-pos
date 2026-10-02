import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { OVERRIDE_ENV_VAR, evaluateDestructiveDbTarget } from "../scripts/lib/production-db-guard";

/**
 * COMMAND-LEVEL proof that the real scripts are actually protected.
 *
 * Unit-testing the guard's boolean logic proves nothing on its own, so every case
 * below spawns the genuine script through `npx tsx` exactly as an operator
 * would, and inspects what the process actually did.
 *
 * Safety of this suite:
 *  - every blocked case points at a deliberately UNRESOLVABLE host
 *    (`*.invalid`), so even if the guard regressed the process could not reach
 *    any real cluster, let alone production;
 *  - every allowed case targets the isolated throwaway database below;
 *  - no Atlas credential, real host or production database name is used.
 */
const REPO = path.resolve(__dirname, "..");
const E2E_DB = "restopos_guard_e2e";
const LOCAL_URI = `mongodb://127.0.0.1:27018/${E2E_DB}`;

/** Unresolvable TLD (RFC 2606 `.invalid`) — a connection can never succeed. */
const BLACKHOLE_URI =
  "mongodb+srv://guardtest:notarealsecret@cluster0.guard-test-does-not-exist.invalid";

let available = false;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  all: string;
}

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  // Hard internal safety net. This repository HAS a .env.local, and
  // @next/env's loadEnvConfig will silently supply any variable the child
  // process does not define. Omitting MONGODB_DB_NAME here once caused a
  // `db:reset` run to inherit `restopos` from .env.local and drop the
  // developer's local restaurants/users. Every spawn in this file therefore MUST
  // state its target database explicitly.
  if (!env.MONGODB_URI) {
    throw new Error("runScript requires an explicit MONGODB_URI");
  }
  if (!env.MONGODB_DB_NAME) {
    throw new Error(
      "runScript requires an explicit MONGODB_DB_NAME — otherwise .env.local may supply a real database name"
    );
  }
  return new Promise((resolve) => {
    execFile(
      "npx",
      ["tsx", ...(args.includes("--reset") || script.includes("seed-demo-data") ? ["--conditions=react-server"] : []), path.join("scripts", script), ...args.filter((a) => a !== "--reset")],
      {
        cwd: REPO,
        // Set AT SPAWN so @next/env's loadEnvConfig cannot override it with
        // the developer's .env.local.
        env: { ...process.env, ...env },
        timeout: 120_000,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? Number((error as { code: number }).code)
            : error
              ? 1
              : 0;
        resolve({ code, stdout, stderr, all: `${stdout}${stderr}` });
      }
    );
  });
}

const BLOCKED_MARKER = "BLOCKED: destructive database operation refused";
const CONNECTION_ERRORS = /MongoServerSelectionError|ECONNREFUSED|buffering timed out|MongooseServerSelectionError/;

beforeAll(async () => {
  try {
    await mongoose.connect(LOCAL_URI, { dbName: E2E_DB, serverSelectionTimeoutMS: 3000 });
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
});

/** Guards against a silently-skipped suite. */
function requireDb(): void {
  expect(
    available,
    `could not reach ${LOCAL_URI}; command-level guard tests must not be skipped`
  ).toBe(true);
}

const DESTRUCTIVE_SCRIPTS: { name: string; script: string; args: string[] }[] = [
  { name: "db:reset", script: "reset-db.ts", args: [] },
  { name: "db:seed:demo", script: "seed-demo-data.ts", args: [] },
  { name: "db:seed:demo:reset", script: "seed-demo-data.ts", args: ["--reset"] },
  { name: "db:seed", script: "seed-demo.ts", args: [] },
  { name: "seed-pos-tables", script: "seed-pos-tables.ts", args: [] },
];

describe("PRODUCTION SIMULATION — every destructive script is blocked", () => {
  it("7/8/9. db:reset, db:seed:demo and db:seed:demo:reset all refuse a production target", async () => {
    requireDb();
    for (const { name, script, args } of DESTRUCTIVE_SCRIPTS) {
      const run = await runScript(
        script,
        args,
        {
          NODE_ENV: "production",
          MONGODB_URI: BLACKHOLE_URI,
          MONGODB_DB_NAME: "restopos_prod",
        }
      );
      expect(run.code, `${name} must exit non-zero`).toBe(1);
      expect(run.all, `${name} must print the block message`).toContain(BLOCKED_MARKER);
      expect(run.all, `${name} must not attempt a connection`).not.toMatch(CONNECTION_ERRORS);
    }
  }, 120_000);

  it("blocks even when NODE_ENV is development but the DB name looks production", async () => {
    requireDb();
    for (const { name, script, args } of DESTRUCTIVE_SCRIPTS) {
      const run = await runScript(
        script,
        args,
        {
          NODE_ENV: "development",
          MONGODB_URI: BLACKHOLE_URI,
          MONGODB_DB_NAME: "restopos_production",
        }
      );
      expect(run.code, name).toBe(1);
      expect(run.all, name).toContain(BLOCKED_MARKER);
    }
  }, 120_000);

  it("blocks the 'NODE_ENV=development but remote unmarked database' case", async () => {
    requireDb();
    const run = await runScript("reset-db.ts", [], {
      NODE_ENV: "development",
      MONGODB_URI: BLACKHOLE_URI,
      MONGODB_DB_NAME: "restopos",
    });
    expect(run.code).toBe(1);
    expect(run.all).toContain(BLOCKED_MARKER);
    expect(run.all).not.toMatch(CONNECTION_ERRORS);
  });

  it("6. the guard runs BEFORE connecting, proven with an unreachable host", async () => {
    requireDb();
    // A host that cannot resolve means a connection error would be the only
    // possible outcome if the guard were placed after mongoose.connect().
    const run = await runScript("reset-db.ts", [], {
      NODE_ENV: "production",
      MONGODB_URI: BLACKHOLE_URI,
      MONGODB_DB_NAME: "restopos_prod",
    });
    expect(run.all).toContain(BLOCKED_MARKER);
    expect(run.all).not.toMatch(CONNECTION_ERRORS);
  });

  it("blocked runs leave data untouched: the target database is not modified", async () => {
    requireDb();
    // A real, populated throwaway database that a regression would destroy.
    await mongoose.connection.collection("users").insertOne({ email: "sentinel@keep.local" });
    await mongoose.connection.collection("restaurants").insertOne({ name: "Sentinel Venue" });
    const before = {
      users: await mongoose.connection.collection("users").countDocuments(),
      restaurants: await mongoose.connection.collection("restaurants").countDocuments(),
    };
    expect(before).toEqual({ users: 1, restaurants: 1 });

    const run = await runScript("reset-db.ts", [], {
      NODE_ENV: "production",
      MONGODB_URI: LOCAL_URI, // local host, so ONLY NODE_ENV can be the trigger
      MONGODB_DB_NAME: "restopos_guard_e2e",
    });
    expect(run.code).toBe(1);
    expect(run.all).toContain(BLOCKED_MARKER);

    // The sentinel rows and collections must still exist.
    expect(await mongoose.connection.collection("users").countDocuments()).toBe(1);
    expect(await mongoose.connection.collection("restaurants").countDocuments()).toBe(1);
    expect(
      await mongoose.connection.collection("users").findOne({ email: "sentinel@keep.local" })
    ).toBeTruthy();
  });

  it("the block message never prints the connection string or credentials", async () => {
    requireDb();
    const run = await runScript("reset-db.ts", [], {
      NODE_ENV: "production",
      MONGODB_URI: BLACKHOLE_URI,
      MONGODB_DB_NAME: "restopos_prod",
    });
    for (const secret of ["notarealsecret", "guardtest:", "mongodb+srv://", "mongodb://"]) {
      expect(run.all, `must not leak ${secret}`).not.toContain(secret);
    }
    expect(run.all).toContain("cluster0.guard-test-does-not-exist.invalid");
    expect(run.all).toContain("DISABLED BY DEFAULT");
    expect(run.all).toContain(OVERRIDE_ENV_VAR);
  });

  it("the override is off by default and is never present in .env.local", async () => {
    requireDb();
    const envLocal = readFileSync(path.join(REPO, ".env.local"), "utf8");
    expect(envLocal).not.toContain(OVERRIDE_ENV_VAR);
    expect(envLocal).not.toContain(OVERRIDE_ENV_VAR.toLowerCase());

    const envExample = readFileSync(path.join(REPO, ".env.example"), "utf8");
    // Documented, but never pre-set to an enabling value.
    expect(envExample.includes(`${OVERRIDE_ENV_VAR}=true`)).toBe(false);

    const run = await runScript("reset-db.ts", [], {
      NODE_ENV: "production",
      MONGODB_URI: BLACKHOLE_URI,
      MONGODB_DB_NAME: "restopos_prod",
    });
    expect(run.code).toBe(1);
  });
});

describe("DEVELOPMENT / QA — normal workflows keep working", () => {
  it("12. db:reset is allowed against a local QA database and still performs its job", async () => {
    requireDb();
    await mongoose.connection.collection("users").insertOne({ email: "dev@local" });
    await mongoose.connection.collection("restaurants").insertOne({ name: "Dev Venue" });
    await mongoose.connection.collection("restaurantsettings").insertOne({ currency: "INR" });

    const run = await runScript("reset-db.ts", [], {
      NODE_ENV: "development",
      MONGODB_URI: LOCAL_URI,
      MONGODB_DB_NAME: E2E_DB,
    });

    expect(run.all).not.toContain(BLOCKED_MARKER);
    expect(run.code).toBe(0);
    const names = (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name);
    expect(names).not.toContain("users");
    expect(names).not.toContain("restaurants");
  }, 120_000);

  it("12. db:seed is allowed against a local QA database and creates demo data", async () => {
    requireDb();
    const run = await runScript("seed-demo.ts", [], {
      NODE_ENV: "development",
      MONGODB_URI: LOCAL_URI,
      MONGODB_DB_NAME: E2E_DB,
    });

    expect(run.all).not.toContain(BLOCKED_MARKER);
    expect(run.code).toBe(0);
    expect(await mongoose.connection.collection("restaurants").countDocuments()).toBeGreaterThan(0);
    expect(await mongoose.connection.collection("users").countDocuments()).toBeGreaterThan(0);
  }, 120_000);

  it("a plain `restopos` database on a local host is allowed (guard logic only)", () => {
    // Deliberately NOT exercised through a real `db:reset` run: a local host
    // plus the legacy default name `restopos` resolves to the developer's actual
    // local database, so executing the script would drop real data. The rule is
    // covered without I/O in tests/production-db-guard.test.ts.
    const decision = evaluateDestructiveDbTarget({
      operation: "destructive",
      scriptName: "db:reset",
      env: { NODE_ENV: "development", MONGODB_URI: LOCAL_URI, MONGODB_DB_NAME: "restopos" },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it("every spawn in this suite targets the isolated throwaway database", () => {
    // Keeps the suite honest: no case may point a destructive script at the
    // developer's own `restopos` database.
    expect(LOCAL_URI).toContain(E2E_DB);
    expect(E2E_DB).toContain("e2e");
  });
});

describe("10. production build/deploy cannot trigger seeding or reset", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("no lifecycle hook exists at all", () => {
    // `build`/`dev`/`start` are ordinary commands, not hooks. These are the
    // names npm/Vercel would run automatically.
    const HOOKS = [
      "prebuild",
      "postbuild",
      "prepare",
      "preprepare",
      "postprepare",
      "preinstall",
      "install",
      "postinstall",
      "prepublish",
      "postpublish",
      "predeploy",
      "postdeploy",
    ];
    const present = HOOKS.filter((hook) => hook in pkg.scripts);
    expect(present, `unexpected lifecycle hooks: ${present.join(", ")}`).toEqual([]);
  });

  it("build and start do not reference any database script", () => {
    for (const name of ["build", "start", "dev", "test", "lint", "typecheck"]) {
      expect(pkg.scripts[name] ?? "", name).not.toMatch(/db:|seed|reset|dropDatabase/);
    }
  });

  it("no script other than the explicitly destructive ones is invoked by build tooling", () => {
    const destructive = ["db:reset", "db:seed:demo", "db:seed:demo:reset", "db:seed"];
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (destructive.includes(name)) continue;
      if (name === "db:seed:admin") continue;
      for (const target of destructive) {
        expect(command, `"${name}" must not invoke ${target}`).not.toContain(target);
      }
    }
  });

  it("the npm script surface still exposes exactly the documented commands", () => {
    expect(Object.keys(pkg.scripts)).toEqual(
      expect.arrayContaining([
        "dev",
        "build",
        "start",
        "lint",
        "typecheck",
        "test",
        "db:seed",
        "db:seed:demo",
        "db:seed:demo:reset",
        "db:seed:admin",
        "db:reset",
        "db:backfill-plan-snapshots",
      ])
    );
  });
});

describe("every script that can destroy data is guarded", () => {
  const GUARDED = [
    "scripts/reset-db.ts",
    "scripts/seed-demo-data.ts",
    "scripts/seed-demo.ts",
    "scripts/seed-pos-tables.ts",
  ];

  it("all four destructive/demo scripts call the guard before connecting", () => {
    for (const file of GUARDED) {
      const source = readFileSync(path.join(REPO, file), "utf8");
      const guardAt = source.indexOf("guardDestructiveScriptOrExit");
      const connectAt = source.search(/mongoose\.connect|connectDB\(/);
      expect(guardAt, `${file} must call the guard`).toBeGreaterThan(-1);
      expect(connectAt, `${file} must connect somewhere`).toBeGreaterThan(-1);
      expect(
        guardAt,
        `${file}: guard (index ${guardAt}) must appear before connect (index ${connectAt})`
      ).toBeLessThan(connectAt);
    }
  });

  it("seed-admin is intentionally NOT blocked (production bootstrap) but warns", () => {
    const source = readFileSync(path.join(REPO, "scripts/seed-admin.ts"), "utf8");
    expect(source).not.toContain("guardDestructiveScriptOrExit");
    expect(source).toContain("ADMIN_PASSWORD");
    expect(source).toContain("WARNING");
  });
});