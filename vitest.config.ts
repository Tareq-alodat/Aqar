import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router plugin is not loaded in tests.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // *.db.test.ts need a database: `npm run test:db` (vitest.db.config.ts).
    // .claude/ holds Claude Code worktrees (other checkouts with their own node_modules).
    exclude: ["node_modules", "build", ".claude/**", "**/*.db.test.ts"],
    environment: "node",
  },
});
