/**
 * Test harness that installs a **React Server cache scope** equivalent to the
 * one the Next.js App Router creates for each incoming request.
 *
 * Why this exists
 * ---------------
 * `React.cache()` only memoises while a cache dispatcher is installed. The
 * implementation shipped in `react.react-server.js` is:
 *
 *     exports.cache = function (fn) {
 *       return function () {
 *         var dispatcher = ReactSharedInternals.A;
 *         if (!dispatcher) return fn.apply(null, arguments);   // <- no-op
 *         var fnMap = dispatcher.getCacheForType(createCacheRoot);
 *         ...
 *
 * So outside a render, every call re-executes and *no* memoisation bug is
 * observable. Running these tests against the ordinary `react` (client) build
 * would therefore pass even with the entitlement de-duplication bug completely
 * present, which is exactly the kind of test that proves nothing.
 *
 * `tests/vitest.rsc.config.ts` aliases `react` to the react-server build, and
 * `withRequestScope()` below installs a dispatcher so the real
 * `cache()`-wrapped functions in the app behave the way they do in production.
 *
 * Cache-key semantics exercised here are React's own, not a reimplementation:
 *   - primitive arguments are compared in a `Map`      -> stable across calls
 *   - object/function arguments are compared in a `WeakMap` by identity
 *     -> a fresh `{ role }` literal is always a miss
 */

import * as React from "react";

interface CacheNode {
  /** Cache entries for primitive arguments. */
  p: Map<unknown, unknown>;
  /** Cache entries for object/function arguments, keyed by identity. */
  o: WeakMap<object, unknown>;
}

function createCacheNode(): CacheNode {
  return { p: new Map(), o: new WeakMap() };
}

/** Identity of the root factory is what React uses to separate request scopes. */
function cacheRoot(): void {
  /* marker only — its identity keys a single request's cache */
}

interface ReactInternals {
  A: unknown;
}

const internals = (
  React as unknown as Record<string, ReactInternals | undefined>
)["__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE"];

function requireInternals(): ReactInternals {
  if (!internals) {
    throw new Error(
      "React server internals not found. Run this suite with " +
        "`vitest run --config tests/vitest.rsc.config.ts`, which aliases `react` " +
        "to react.react-server.js."
    );
  }
  return internals;
}

/**
 * Runs `fn` inside a single fresh request scope. Every call made within shares
 * one cache, exactly as the App Router shares one cache per incoming request.
 * Nested scopes are not expected here and are not supported.
 */
export async function withRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  const shared = requireInternals();
  const previous = shared.A;
  const roots = new Map<unknown, Map<unknown, unknown>>();

  shared.A = {
    getCacheForType(resourceType: unknown) {
      if (resourceType === cacheRoot) {
        let root = roots.get(cacheRoot);
        if (!root) {
          root = new Map<unknown, unknown>();
          roots.set(cacheRoot, root);
        }
        return root;
      }
      let typeMap = roots.get(resourceType);
      if (!typeMap) {
        typeMap = new Map<unknown, unknown>();
        roots.set(resourceType, typeMap);
      }
      return typeMap;
    },
  };

  try {
    return await fn();
  } finally {
    shared.A = previous;
  }
}

/** True when the RSC build of React (the one with a working `cache`) is loaded. */
export function hasServerCacheImplementation(): boolean {
  const source = String(React.cache);
  return source.includes("getCacheForType");
}

export { createCacheNode };