import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router plugin is not loaded in tests.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "build"],
    environment: "node",
  },
});
