import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router plugin is not loaded in tests.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // *.db.test.ts need a database: `npm run test:db` (vitest.db.config.ts).
    exclude: ["node_modules", "build", "**/*.db.test.ts"],
    environment: "node",
  },
});
