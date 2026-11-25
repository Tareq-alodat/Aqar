import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import noPhysicalDirection from "./eslint-rules/no-physical-direction";

export default defineConfig(
  globalIgnores(["build/", ".react-router/", "node_modules/", "coverage/", "uploads/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  { ...reactHooks.configs.flat.recommended, files: ["app/**/*.{ts,tsx}"] },
  {
    // RTL: CLAUDE.md rule 7 — logical utilities only (ps-/pe-/ms-/me-/start-/end-/text-start).
    files: ["app/**/*.{ts,tsx}"],
    plugins: { aqar: { rules: { "no-physical-direction": noPhysicalDirection } } },
    rules: { "aqar/no-physical-direction": "error" },
  },
);
