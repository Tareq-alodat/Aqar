import type { Rule } from "eslint";
import type * as ESTree from "estree";

/**
 * Blocks physical (left/right) Tailwind utilities in class strings so layout
 * mirrors correctly between RTL (ar) and LTR (en). See CLAUDE.md rule 7 and
 * SPEC §2 (Styling).
 *
 * Checked: string literals and template-literal text inside `className` /
 * `class` JSX attributes, and inside calls to class helpers (cn, clsx, cva,
 * twMerge, classNames). Utilities under an `rtl:` or `ltr:` variant are allowed,
 * because they are explicitly direction-aware.
 *
 * Two kinds of finding:
 * - logical: a start/end equivalent exists (`pl-4` → `ps-4`,
 *   `[margin-left:3px]` → `[margin-inline-start:3px]`).
 * - mirror: Tailwind has no logical form (`translate-x-*`, `bg-linear-to-r`,
 *   `origin-top-left`, arbitrary values such as `[background-position:left]`),
 *   so the fix is an explicit pair: `ltr:translate-x-4 rtl:-translate-x-4`.
 */

const CLASS_HELPERS = new Set(["cn", "clsx", "cva", "twMerge", "classNames"]);

function isClassHelperCall(node: ESTree.Node): node is ESTree.CallExpression {
  return node.type === "CallExpression" && node.callee.type === "Identifier" && CLASS_HELPERS.has(node.callee.name);
}

/** Physical utility prefix → logical replacement. */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["pl", "ps"],
  ["pr", "pe"],
  ["ml", "ms"],
  ["mr", "me"],
  ["left", "start"],
  ["right", "end"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["rounded-tl", "rounded-ss"],
  ["rounded-tr", "rounded-se"],
  ["rounded-bl", "rounded-es"],
  ["rounded-br", "rounded-ee"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
  ["scroll-ml", "scroll-ms"],
  ["scroll-mr", "scroll-me"],
  ["scroll-pl", "scroll-ps"],
  ["scroll-pr", "scroll-pe"],
];

/** Physical utilities that only exist as exact names. */
const EXACT: Readonly<Record<string, string>> = {
  "text-left": "text-start",
  "text-right": "text-end",
  "float-left": "float-start",
  "float-right": "float-end",
  "clear-left": "clear-start",
  "clear-right": "clear-end",
};

/** Prefixes that are also complete utilities on their own (e.g. `border-l`). */
const BARE_OK = new Set(["border-l", "border-r", "rounded-l", "rounded-r", "rounded-tl", "rounded-tr", "rounded-bl", "rounded-br"]);

/** `left`/`right` as a word (hyphens and underscores count as boundaries). */
const LR_WORD = /(?<![a-z])(left|right)(?![a-z])/g;
const hasLR = (s: string) => new RegExp(LR_WORD.source).test(s);
const swapLR = (s: string) => s.replace(LR_WORD, (m) => (m === "left" ? "right" : "left"));

export type Finding =
  | { kind: "logical"; replacement: string }
  | { kind: "mirror"; ltr: string; rtl: string };

interface ParsedToken {
  variants: string[];
  important: "" | "front" | "end";
  negative: boolean;
  base: string;
}

/** Splits `md:hover:-ml-2!` into variants, important flag, sign and base, ignoring `:` inside `[...]`. */
function parseToken(token: string): ParsedToken {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of token) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (ch === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  let base = current;
  let important: ParsedToken["important"] = "";
  if (base.startsWith("!")) {
    important = "front";
    base = base.slice(1);
  } else if (base.endsWith("!")) {
    important = "end";
    base = base.slice(0, -1);
  }
  const negative = base.startsWith("-");
  if (negative) base = base.slice(1);
  return { variants: parts, important, negative, base };
}

function build(p: ParsedToken, base: string, negative: boolean, extraVariant?: string): string {
  const variants = extraVariant ? [...p.variants, extraVariant] : p.variants;
  return (
    variants.map((v) => `${v}:`).join("") +
    (p.important === "front" ? "!" : "") +
    (negative ? "-" : "") +
    base +
    (p.important === "end" ? "!" : "")
  );
}

function logical(p: ParsedToken, base: string, negative = p.negative): Finding {
  return { kind: "logical", replacement: build(p, base, negative) };
}

function mirror(p: ParsedToken, rtlBase: string, rtlNegative = p.negative): Finding {
  return { kind: "mirror", ltr: build(p, p.base, p.negative, "ltr"), rtl: build(p, rtlBase, rtlNegative, "rtl") };
}

const BORDER_RADIUS_PROPS: Readonly<Record<string, string>> = {
  "border-top-left-radius": "border-start-start-radius",
  "border-top-right-radius": "border-start-end-radius",
  "border-bottom-left-radius": "border-end-start-radius",
  "border-bottom-right-radius": "border-end-end-radius",
};
const LOGICAL_VALUE_PROPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "text-align": { left: "start", right: "end" },
  float: { left: "inline-start", right: "inline-end" },
  clear: { left: "inline-start", right: "inline-end" },
};

/** Arbitrary property, e.g. `[margin-left:3px]` or `[text-align:right]`. */
function checkArbitraryProperty(p: ParsedToken, prop: string, value: string): Finding | null {
  if (prop.startsWith("--")) return null; // custom property names are just identifiers
  if (!hasLR(prop) && !hasLR(value)) return null;

  let newProp = prop;
  if (prop === "left") newProp = "inset-inline-start";
  else if (prop === "right") newProp = "inset-inline-end";
  else if (BORDER_RADIUS_PROPS[prop]) newProp = BORDER_RADIUS_PROPS[prop];
  else if (/^(margin|padding|border|scroll-margin|scroll-padding)-(left|right)(-|$)/.test(prop)) {
    newProp = prop.replace(/-(left|right)/, (_, side: string) => (side === "left" ? "-inline-start" : "-inline-end"));
  }

  let newValue = value;
  const valueMap = LOGICAL_VALUE_PROPS[prop];
  if (valueMap && valueMap[value]) newValue = valueMap[value];

  if (!hasLR(newProp) && !hasLR(newValue)) return logical(p, `[${newProp}:${newValue}]`);
  return mirror(p, swapLR(p.base));
}

/** Returns a finding if `token` is a physical (left/right) utility, else null. */
export function checkToken(token: string): Finding | null {
  const p = parseToken(token);
  if (p.variants.includes("rtl") || p.variants.includes("ltr")) return null;
  const { base, negative } = p;

  const exact = EXACT[base];
  if (exact) return logical(p, exact);

  for (const [physical, replacement] of PREFIXES) {
    if (base === physical && BARE_OK.has(physical)) return logical(p, replacement);
    if (base.startsWith(`${physical}-`)) return logical(p, replacement + base.slice(physical.length));
  }

  // translate-x moves along the physical x-axis; 0 is direction-neutral.
  if (base.startsWith("translate-x-") && base !== "translate-x-0") return mirror(p, base, !negative);

  const gradient = /^bg-(linear|gradient)-to-(t|b)?(l|r)$/.exec(base);
  if (gradient) {
    const [, kind, vertical = "", side] = gradient;
    return mirror(p, `bg-${kind}-to-${vertical}${side === "l" ? "r" : "l"}`);
  }

  if (base.startsWith("origin-") && hasLR(base)) return mirror(p, swapLR(base));

  const arbitrary = /^\[([a-z-]+):(.+)\]$/.exec(base);
  if (arbitrary) return checkArbitraryProperty(p, arbitrary[1]!, arbitrary[2]!);

  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow left/right Tailwind utilities; use logical (start/end) utilities or explicit rtl:/ltr: pairs.",
    },
    schema: [],
    messages: {
      physical: "'{{token}}' is a physical (left/right) utility. Use '{{replacement}}' (logical) or an rtl:/ltr: variant.",
      mirror: "'{{token}}' does not mirror in RTL. Use the pair '{{ltr}} {{rtl}}'.",
    },
  },
  create(context) {
    function checkText(node: ESTree.Node, text: string) {
      for (const token of text.split(/\s+/)) {
        if (!token) continue;
        const finding = checkToken(token);
        if (!finding) continue;
        if (finding.kind === "logical") {
          context.report({ node, messageId: "physical", data: { token, replacement: finding.replacement } });
        } else {
          context.report({ node, messageId: "mirror", data: { token, ltr: finding.ltr, rtl: finding.rtl } });
        }
      }
    }

    /** Checks every string literal / template chunk under `root`. */
    function checkStrings(root: ESTree.Node) {
      const stack: unknown[] = [root];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        const n = node as ESTree.Node & Record<string, unknown>;
        // Class-helper calls are checked by the CallExpression visitor; skip to avoid double reports.
        if (n !== root && isClassHelperCall(n)) continue;
        if (n.type === "Literal" && typeof n.value === "string") {
          checkText(n, n.value);
          continue;
        }
        if (n.type === "TemplateElement") {
          checkText(n, n.value.cooked ?? n.value.raw);
          continue;
        }
        for (const [key, value] of Object.entries(n)) {
          if (key === "parent" || key === "loc" || key === "range") continue;
          if (Array.isArray(value)) stack.push(...value);
          else if (value && typeof value === "object" && "type" in value) stack.push(value);
        }
      }
    }

    return {
      JSXAttribute(node: ESTree.Node) {
        const attr = node as unknown as { name: { type: string; name: unknown }; value: ESTree.Node | null };
        if (attr.name.type !== "JSXIdentifier") return;
        if (attr.name.name !== "className" && attr.name.name !== "class") return;
        if (attr.value) checkStrings(attr.value);
      },
      CallExpression(node) {
        if (isClassHelperCall(node)) {
          for (const arg of node.arguments) checkStrings(arg);
        }
      },
    };
  },
};

export default rule;
