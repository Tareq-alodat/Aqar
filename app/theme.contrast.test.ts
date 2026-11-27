import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG AA guard for the theme tokens in app.css (SPEC §14): every text/
 * background pair the UI uses must reach 4.5:1, and form-control borders
 * (drawn in `muted`) 3:1 against the surfaces they sit on. Fails when a
 * palette change breaks contrast.
 */

const css = readFileSync(path.join(import.meta.dirname, "app.css"), "utf8");

/** `--aqar-*` (per theme) and `--color-*` literal values (shared) from app.css. */
function tokens(theme: "light" | "dark"): Record<string, string> {
  const block = (selector: RegExp) => css.match(selector)?.[1] ?? "";
  const scoped = theme === "light" ? block(/:root,\s*\.light\s*\{([^}]*)\}/) : block(/\n\.dark\s*\{([^}]*)\}/);
  const shared = block(/@theme\s*\{([^}]*)\}/);
  const out: Record<string, string> = {};
  for (const [, name, value] of shared.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[name!] = value!;
  for (const [, name, value] of scoped.matchAll(/--aqar-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[name!] = value!;
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const BACKGROUNDS = ["background", "surface", "card"];
const TEXT_ON_BACKGROUNDS = ["foreground", "muted", "primary-text", "error-text"];
const ON_PRIMARY = ["primary", "primary-hover", "sale", "rent", "exchange", "success", "error"];

describe.each(["light", "dark"] as const)("%s theme tokens", (theme) => {
  const t = tokens(theme);

  it("has every token the components use", () => {
    for (const name of [...BACKGROUNDS, ...TEXT_ON_BACKGROUNDS, ...ON_PRIMARY, "border", "on-primary", "accent", "on-accent", "warning", "secondary", "on-secondary"]) {
      expect(t[name], name).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it.each(TEXT_ON_BACKGROUNDS)("%s text reaches 4.5:1 on background, surface and card", (fg) => {
    for (const bg of BACKGROUNDS) expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("white labels reach 4.5:1 on primary, listing-type and status colours", () => {
    for (const bg of ON_PRIMARY) expect(contrast(t["on-primary"]!, t[bg]!), `on-primary on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("dark text reaches 4.5:1 on accent and warning; on-secondary on secondary", () => {
    expect(contrast(t["on-accent"]!, t.accent!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["on-accent"]!, t.warning!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["on-secondary"]!, t.secondary!)).toBeGreaterThanOrEqual(4.5);
  });

  it("secondary works as text on page backgrounds", () => {
    for (const bg of BACKGROUNDS) expect(contrast(t.secondary!, t[bg]!), `secondary on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("form-control borders (muted) and focus rings (primary-text) reach 3:1", () => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(t.muted!, t[bg]!)).toBeGreaterThanOrEqual(3);
      expect(contrast(t["primary-text"]!, t[bg]!)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("contrast()", () => {
  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
