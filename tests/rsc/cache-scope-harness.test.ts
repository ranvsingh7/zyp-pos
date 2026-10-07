/**
 * Guard for the cache-scope harness itself.
 *
 * If `withRequestScope()` ever stops producing a real request scope, every
 * entitlement de-duplication test in this directory would still pass — because
 * nothing would be cached, so nothing could ever be called twice. That is a
 * false green, so the harness's ability to observe the bug is asserted here
 * first, against React's own `cache()` semantics.
 */

import { describe, it, expect } from "vitest";
import { withRequestScope, hasServerCacheImplementation } from "./request-scope";
import { cache } from "react";

describe("React server cache-scope harness", () => {
  it("is running the react-server build of React (cache is implemented, not a no-op)", () => {
    expect(hasServerCacheImplementation()).toBe(true);
  });

  it("collapses repeated calls that share primitive arguments", async () => {
    let invocations = 0;
    const fn = cache(async (id: string, role: string | null | undefined) => {
      invocations += 1;
      return `${id}/${role}`;
    });

    const results = await withRequestScope(async () => [
      await fn("resto-1", "OWNER"),
      await fn("resto-1", "OWNER"),
      await fn("resto-1", "OWNER"),
    ]);

    expect(invocations).toBe(1);
    expect(new Set(results).size).toBe(1);
  });

  it("does NOT collapse calls that pass a fresh object literal", async () => {
    let invocations = 0;
    const fn = cache(async (id: string, opts: { role?: string | null } = {}) => {
      invocations += 1;
      // `opts` is deliberately unused: the point is that its *identity* is the
      // cache key, not its contents.
      return `${id}:${opts.role ?? "none"}`;
    });

    await withRequestScope(async () => {
      await fn("resto-1", { role: "OWNER" });
      await fn("resto-1", { role: "OWNER" });
      await fn("resto-1", { role: "OWNER" });
    });

    // This is the bug the audit found. Asserted so the harness is proven able to
    // detect it; the application code must not behave this way.
    expect(invocations).toBe(3);
  });

  it("separates distinct restaurants and distinct roles", async () => {
    const seen: string[] = [];
    const fn = cache(async (id: string, role: string | null | undefined) => {
      seen.push(`${id}/${role}`);
      return seen.length;
    });

    await withRequestScope(async () => {
      await fn("resto-1", "OWNER");
      await fn("resto-1", "OWNER");
      await fn("resto-1", "CASHIER");
      await fn("resto-2", "OWNER");
    });

    expect(seen).toEqual(["resto-1/OWNER", "resto-1/CASHIER", "resto-2/OWNER"]);
  });

  it("gives each request scope its own cache (no cross-request reuse)", async () => {
    let invocations = 0;
    const fn = cache(async (id: string) => {
      invocations += 1;
      return id;
    });

    await withRequestScope(() => fn("resto-1"));
    await withRequestScope(() => fn("resto-1"));
    await withRequestScope(() => fn("resto-1"));

    expect(invocations).toBe(3);
  });
});