import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Isolated vitest project for tests that need a **real React Server cache scope**.
 *
 * `React.cache()` is a no-op outside a React render: the implementation in
 * `react.react-server.js` returns `fn(...args)` unchanged when no cache
 * dispatcher is installed. That means the ordinary test config — which resolves
 * `react` to the *client* build — cannot observe request-scoped memoisation at
 * all, and would silently pass even with the entitlement bug fully present.
 *
 * This project therefore aliases `react` to the `react-server` build (the exact
 * one Next.js loads for RSC) so a test can install a cache scope equivalent to
 * the one the App Router creates per request, and assert that identical
 * primitive-keyed calls collapse to a single execution.
 *
 * Kept separate from the main config on purpose: the existing component tests
 * import `react-dom/client` and must keep resolving the *client* React build.
 */
export default defineConfig({
  resolve: {
    alias: {
      // The RSC build of React: `cache()` is implemented here, not in the client build.
      react: path.resolve(__dirname, "../node_modules/react/react.react-server.js"),
      "@": path.resolve(__dirname, "../src"),
      "server-only": path.resolve(__dirname, "server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/rsc/**/*.test.{ts,tsx}"],
    globals: true,
    env: {
      MONGODB_URI: "mongodb://127.0.0.1:27018/restopos_rsc_test",
      MONGODB_DB_NAME: "restopos_rsc_test",
      AUTH_SECRET: "test-secret-key-for-vitest-0123456789abcdef",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "ZYP POS",
      // Pinned off so the suite always exercises real plan-based entitlements.
      FULL_ACCESS_MODE: "false",
    },
  },
});