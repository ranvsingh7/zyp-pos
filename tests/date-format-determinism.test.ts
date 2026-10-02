/**
 * Date formatting must be identical on the server and in the browser.
 *
 * A hydration error happens when the two runtimes disagree, and the cause is
 * almost always one of two things the default `toLocale*` behaviour depends on:
 * the runtime's default locale, and the runtime's local timezone. Neither is
 * guaranteed to match between a Node server and a user's browser, so these
 * tests assert the *output* is stable when both are deliberately changed —
 * which is the only way to catch a regression that a single-CI-timezone run
 * would sail straight past.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DISPLAY_TIMEZONE,
  formatDate,
  formatDateInput,
  formatDateTime,
  formatTime,
} from "@/lib/format/date";

/** A fixed instant, expressed three ways, that all mean the same moment. */
const INSTANT_ISO = "2026-09-29T08:00:00.000Z"; // 13:30 in Asia/Kolkata
const INSTANT_ALT_TZ = "2026-09-29T20:15:00.000Z"; // 01:45 the next day in New York

function formatInFreshRuntime(script: string): string {
  // A child process lets us change TZ/locale for the whole runtime, which is
  // the only faithful reproduction of "the server disagrees with the browser".
  return execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "America/New_York",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    },
  }).trim();
}

const printFormat = `
  const d = new Date("${INSTANT_ISO}");
  console.log([
    d.toLocaleString(),
    d.toLocaleDateString(),
    d.toLocaleTimeString(),
  ].join("|"));
`;

describe("deterministic date formatting", () => {
  it("the naive formatters really do disagree across runtimes", () => {
    // Guards the premise of this file: if `toLocale*` were somehow stable, the
    // tests below would pass for the wrong reason.
    const serverish = execFileSync(process.execPath, ["-e", printFormat], {
      encoding: "utf8",
      env: { ...process.env, TZ: "UTC", LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8" },
    });
    const browserish = formatInFreshRuntime(printFormat);
    expect(serverish).not.toBe(browserish);
  });

  it("produces the same string under a different timezone and locale", () => {
    const inThisRuntime = [INSTANT_ISO, INSTANT_ALT_TZ]
      .map((iso) => `${formatDateTime(iso)}|${formatDate(iso)}|${formatTime(iso)}`)
      .join("~");
    const inOther = formatInFreshRuntime(`
      const m = await import("./src/lib/format/date.ts");
      console.log(
        ["${INSTANT_ISO}", "${INSTANT_ALT_TZ}"]
          .map((iso) => [m.formatDateTime(iso), m.formatDate(iso), m.formatTime(iso)].join("|"))
          .join("~")
      );
    `);
    expect(inOther).toBe(inThisRuntime);
  });

  it("renders a known instant in the configured display timezone", () => {
    // 08:00 UTC is 13:30 in Asia/Kolkata (UTC+5:30). Pinning this means a
    // future edit that quietly drops the timezone will fail loudly here rather
    // than as a hydration error in production.
    expect(formatDateTime(INSTANT_ISO)).toMatch(/1:30\s*pm/i);
    expect(formatDate(INSTANT_ISO)).toMatch(/2026/);
    expect(formatDateInput(INSTANT_ISO)).toBe("2026-09-29");
  });

  it("uses one display timezone across the product", () => {
    expect(DISPLAY_TIMEZONE).toBe("Asia/Kolkata");
  });

  it("handles null, empty and invalid input without throwing", () => {
    for (const bad of [null, undefined, "", "not-a-date", NaN]) {
      expect(formatDateTime(bad)).toBe("—");
      expect(formatDate(bad)).toBe("—");
      expect(formatTime(bad)).toBe("—");
      expect(formatDateInput(bad)).toBe("");
    }
  });

  it("accepts Date objects and epoch milliseconds as well as ISO strings", () => {
    const d = new Date(INSTANT_ISO);
    expect(formatDateTime(d)).toBe(formatDateTime(INSTANT_ISO));
    expect(formatDateTime(d.getTime())).toBe(formatDateTime(INSTANT_ISO));
  });
});

/** Every .ts/.tsx under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("no locale-dependent formatting reaches the browser", () => {
  /**
   * The determinism tests above prove the shared formatters are safe. This one
   * closes the other half of the loop: a client component that calls
   * `toLocaleString()` directly is a hydration bug waiting to happen, and the
   * reported one came from exactly that. Lint cannot catch it (the call is
   * perfectly valid JavaScript) and it only shows up in a browser whose
   * locale or timezone differs from the server's, so it needs a check.
   */
  const clientModules = sourceFiles("src")
    .filter((f) => readFileSync(f, "utf8").includes('"use client"'))
    .map((f) => ({ file: f, source: readFileSync(f, "utf8") }));

  it("finds the client components to check", () => {
    expect(clientModules.length).toBeGreaterThan(10);
  });

  it.each(clientModules)("$file uses no bare toLocale* call", ({ source }) => {
    const offenders = [
      ...source.matchAll(/\.toLocale(?:String|DateString|TimeString)\s*\(\s*\)/g),
    ].map((m) => m[0]);
    expect(
      offenders,
      "A bare toLocale* in a client component formats by the runtime's default " +
        "locale, which differs between the server and the browser. Use " +
        "formatDate/formatDateTime from @/lib/format/date instead."
    ).toEqual([]);
  });

  it.each(clientModules)("$file pins a timeZone wherever it formats a date", ({ source }) => {
    // An explicit locale is not enough: the result still depends on the
    // runtime's local timezone unless timeZone is pinned too.
    const calls = [
      ...source.matchAll(/\.toLocale(?:String|DateString|TimeString)\s*\(([\s\S]{0,400}?)\)/g),
    ];
    const unpinned = calls
      .filter(([, opts]) => !/timeZone\s*:/.test(opts))
      .map((m) => m[0].replace(/\s+/g, " ").slice(0, 80));
    expect(
      unpinned,
      "Pass an explicit timeZone, or use @/lib/format/date which pins one."
    ).toEqual([]);
  });
});
