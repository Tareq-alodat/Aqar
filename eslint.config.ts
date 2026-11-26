import css from "@eslint/css";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { tailwind4 } from "tailwind-csstree";
import tseslint from "typescript-eslint";
import noPhysicalDirection from "./eslint-rules/no-physical-direction";

const aqar = { rules: { "no-physical-direction": noPhysicalDirection } };

/**
 * css/prefer-logical-properties also flags block-axis and size properties and
 * viewport units (width, top, margin-top, vh…). Those don't change between RTL
 * and LTR, so only left/right ones are enforced (CLAUDE.md rule 7).
 */
const CSS_ALLOWED_PHYSICAL_PROPERTIES = [
  "top", "bottom", "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin-top", "margin-bottom", "padding-top", "padding-bottom",
  "scroll-margin-top", "scroll-margin-bottom", "scroll-padding-top", "scroll-padding-bottom",
  "border-top", "border-top-color", "border-top-style", "border-top-width",
  "border-bottom", "border-bottom-color", "border-bottom-style", "border-bottom-width",
  "contain-intrinsic-width", "contain-intrinsic-height",
  "overflow-x", "overflow-y", "overscroll-behavior-x", "overscroll-behavior-y",
];
const CSS_ALLOWED_PHYSICAL_UNITS = ["vh", "vw", "dvh", "dvw", "lvh", "lvw", "svh", "svw", "cqh", "cqw"];

export default defineConfig(
  globalIgnores(["build/", ".react-router/", "node_modules/", "coverage/", "uploads/"]),
  {
    // JS/TS presets are scoped so they never run against CSS files.
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
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
    plugins: { aqar },
    rules: { "aqar/no-physical-direction": "error" },
  },
  {
    // RTL in CSS: physical utilities in `@apply`, and physical CSS properties
    // (margin-left, left, text-align: right, …) via css/prefer-logical-properties.
    // `tolerant` lets Tailwind's @apply syntax (`!mr-2`, `[margin-left:3px]`) parse.
    files: ["app/**/*.css"],
    plugins: { css, aqar },
    language: "css/css",
    languageOptions: { customSyntax: tailwind4, tolerant: true },
    rules: {
      "aqar/no-physical-direction": "error",
      "css/prefer-logical-properties": [
        "error",
        { allowProperties: CSS_ALLOWED_PHYSICAL_PROPERTIES, allowUnits: CSS_ALLOWED_PHYSICAL_UNITS },
      ],
    },
  },
);
