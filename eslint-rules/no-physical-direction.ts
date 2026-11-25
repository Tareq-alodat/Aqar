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
 */

const CLASS_HELPERS = new Set(["cn", "clsx", "cva", "twMerge", "classNames"]);

function isClassHelperCall(node: ESTree.Node): node is ESTree.CallExpression {
  return node.type === "CallExpression" && node.callee.type === "Identifier" && CLASS_HELPERS.has(node.callee.name);
}

/** Physical utility prefix → logical replacement shown in the message. */
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

/** Splits `md:hover:-ml-2` into variants and utility, ignoring `:` inside `[...]`. */
function splitVariants(token: string): { variants: string[]; utility: string } {
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
  return { variants: parts, utility: current };
}

/** Returns the logical replacement if `token` is a physical utility, else null. */
export function physicalReplacement(token: string): string | null {
  const { variants, utility } = splitVariants(token);
  if (variants.includes("rtl") || variants.includes("ltr")) return null;

  let base = utility;
  if (base.startsWith("!")) base = base.slice(1);
  if (base.endsWith("!")) base = base.slice(0, -1);
  const negative = base.startsWith("-");
  if (negative) base = base.slice(1);

  const exact = EXACT[base];
  if (exact) return exact;

  for (const [physical, logical] of PREFIXES) {
    if (base === physical && BARE_OK.has(physical)) return logical;
    if (base.startsWith(`${physical}-`)) {
      return `${negative ? "-" : ""}${logical}${base.slice(physical.length)}`;
    }
  }
  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow left/right Tailwind utilities; use logical (start/end) utilities for RTL support.",
    },
    schema: [],
    messages: {
      physical: "'{{token}}' is a physical (left/right) utility. Use '{{replacement}}' (logical) or an rtl:/ltr: variant.",
    },
  },
  create(context) {
    function checkText(node: ESTree.Node, text: string) {
      for (const token of text.split(/\s+/)) {
        if (!token) continue;
        const replacement = physicalReplacement(token);
        if (replacement) {
          context.report({ node, messageId: "physical", data: { token, replacement } });
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
