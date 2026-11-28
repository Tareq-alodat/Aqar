import { defineConfig } from "vitest/config";

// Integration tests against a real PostGIS database (DATABASE_URL_TEST).
// `npm test` excludes these; run them with `npm run test:db`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["**/*.db.test.ts"],
    exclude: ["node_modules", "build", ".claude/**"],
    environment: "node",
    globalSetup: ["./server/db/test/globalSetup.ts"],
    // One database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
