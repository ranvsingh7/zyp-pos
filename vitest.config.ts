import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    globals: true,
    env: {
      MONGODB_URI: "mongodb://127.0.0.1:27017/restopos_test",
      MONGODB_DB_NAME: "restopos_test",
      AUTH_SECRET: "test-secret-key-for-vitest-0123456789abcdef",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "ZYP POS",
      // Temporary dev/demo switch, pinned off so the suite always exercises the
      // real plan-based entitlements. Tests that need full access opt in with
      // vi.stubEnv("FULL_ACCESS_MODE", "true") rather than relying on whatever
      // the developer's shell or .env.local happens to contain.
      FULL_ACCESS_MODE: "false",
    },
  },
});