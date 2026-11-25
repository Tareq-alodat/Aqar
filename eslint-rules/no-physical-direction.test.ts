import css from "@eslint/css";
import { RuleTester } from "eslint";
import { tailwind4 } from "tailwind-csstree";
import { describe, expect, it } from "vitest";
import rule, { checkToken } from "./no-physical-direction";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("checkToken: logical replacements", () => {
  it.each([
    ["pl-4", "ps-4"],
    ["pr-2", "pe-2"],
    ["ml-auto", "ms-auto"],
    ["-mr-1", "-me-1"],
    ["left-0", "start-0"],
    ["right-[3px]", "end-[3px]"],
    ["text-left", "text-start"],
    ["text-right", "text-end"],
    ["md:hover:pl-4", "md:hover:ps-4"],
    ["!mr-2", "!me-2"],
    ["mr-2!", "me-2!"],
    ["border-l", "border-s"],
    ["border-r-2", "border-e-2"],
    ["rounded-tl-lg", "rounded-ss-lg"],
    ["float-right", "float-end"],
    ["[margin-left:3px]", "[margin-inline-start:3px]"],
    ["[padding-right:1rem]", "[padding-inline-end:1rem]"],
    ["[border-left-width:2px]", "[border-inline-start-width:2px]"],
    ["[left:0]", "[inset-inline-start:0]"],
    ["md:[right:1rem]", "md:[inset-inline-end:1rem]"],
    ["[border-top-right-radius:4px]", "[border-start-end-radius:4px]"],
    ["[text-align:right]", "[text-align:end]"],
    ["[float:left]", "[float:inline-start]"],
  ])("%s → %s", (token, expected) => {
    expect(checkToken(token)).toEqual({ kind: "logical", replacement: expected });
  });
});

describe("checkToken: mirrored ltr/rtl pairs", () => {
  it.each([
    ["translate-x-4", "ltr:translate-x-4", "rtl:-translate-x-4"],
    ["-translate-x-1/2", "ltr:-translate-x-1/2", "rtl:translate-x-1/2"],
    ["translate-x-full", "ltr:translate-x-full", "rtl:-translate-x-full"],
    ["group-hover:translate-x-[10px]", "group-hover:ltr:translate-x-[10px]", "group-hover:rtl:-translate-x-[10px]"],
    ["bg-linear-to-r", "ltr:bg-linear-to-r", "rtl:bg-linear-to-l"],
    ["bg-linear-to-l", "ltr:bg-linear-to-l", "rtl:bg-linear-to-r"],
    ["bg-gradient-to-r", "ltr:bg-gradient-to-r", "rtl:bg-gradient-to-l"],
    ["bg-linear-to-tr", "ltr:bg-linear-to-tr", "rtl:bg-linear-to-tl"],
    ["bg-gradient-to-bl", "ltr:bg-gradient-to-bl", "rtl:bg-gradient-to-br"],
    ["bg-linear-to-r/oklch", "ltr:bg-linear-to-r/oklch", "rtl:bg-linear-to-l/oklch"],
    ["bg-linear-45", "ltr:bg-linear-45", "rtl:-bg-linear-45"],
    ["-bg-linear-120", "ltr:-bg-linear-120", "rtl:bg-linear-120"],
    ["md:bg-linear-90/srgb", "md:ltr:bg-linear-90/srgb", "md:rtl:-bg-linear-90/srgb"],
    ["bg-linear-[25deg,red_5%,blue]", "ltr:bg-linear-[25deg,red_5%,blue]", "rtl:bg-linear-[-25deg,red_5%,blue]"],
    ["bg-linear-[-0.25turn,red,blue]", "ltr:bg-linear-[-0.25turn,red,blue]", "rtl:bg-linear-[0.25turn,red,blue]"],
    ["bg-linear-[to_right,red,blue]", "ltr:bg-linear-[to_right,red,blue]", "rtl:bg-linear-[to_left,red,blue]"],
    ["origin-left", "ltr:origin-left", "rtl:origin-right"],
    ["origin-top-right", "ltr:origin-top-right", "rtl:origin-top-left"],
    ["origin-bottom-left", "ltr:origin-bottom-left", "rtl:origin-bottom-right"],
    ["origin-[left_top]", "ltr:origin-[left_top]", "rtl:origin-[right_top]"],
    ["[transform-origin:left_center]", "ltr:[transform-origin:left_center]", "rtl:[transform-origin:right_center]"],
    ["[background-position:right_10%]", "ltr:[background-position:right_10%]", "rtl:[background-position:left_10%]"],
  ])("%s → %s %s", (token, ltr, rtl) => {
    expect(checkToken(token)).toEqual({ kind: "mirror", ltr, rtl });
  });
});

describe("checkToken: allowed", () => {
  it.each([
    "ps-4", "pe-2", "ms-auto", "start-0", "end-0", "text-start", "px-4", "mx-auto", "border-b", "rounded-lg",
    "rtl:pl-4", "ltr:left-0", "md:rtl:mr-2", "leftover", "inset-x-0", "[&:hover]:ps-2",
    "translate-x-0", "translate-y-4", "-translate-y-1/2", "ltr:translate-x-4", "rtl:-translate-x-4",
    "bg-linear-to-t", "bg-linear-to-b", "bg-gradient-to-b", "origin-center", "origin-top", "origin-bottom",
    "ltr:origin-top-left", "rtl:bg-linear-to-l",
    "bg-linear-0", "bg-linear-180", "-bg-linear-180", "bg-linear-to-b/oklch", "bg-linear-[180deg,red,blue]",
    "bg-linear-[0.5turn,red]", "bg-linear-[red,blue]", "bg-linear-(--my-gradient)", "ltr:bg-linear-45",
    "[margin-inline-start:3px]", "[--left-offset:4px]", "[text-align:center]", "[mask-type:luminance]",
  ])("%s is allowed", (token) => {
    expect(checkToken(token)).toBeNull();
  });
});

ruleTester.run("no-physical-direction", rule, {
  valid: [
    `<div className="ps-4 pe-2 ms-auto text-start" />`,
    `<div className={\`px-4 \${active ? "ms-2" : "me-2"}\`} />`,
    `<div className="rtl:rotate-180 ltr:left-0" />`,
    `<div className="ltr:translate-x-4 rtl:-translate-x-4 ltr:bg-linear-to-r rtl:bg-linear-to-l" />`,
    `const label = "pl-4 is not a class here";`,
    `<div title="left-0" />`,
  ],
  invalid: [
    {
      code: `<div className="flex pl-4" />`,
      errors: [{ messageId: "physical", data: { token: "pl-4", replacement: "ps-4" } }],
    },
    {
      code: `<div className={\`p-2 \${open ? "mr-2" : "text-right"}\`} />`,
      errors: [{ messageId: "physical" }, { messageId: "physical" }],
    },
    {
      code: `<div class="left-0 right-0" />`,
      errors: [{ messageId: "physical" }, { messageId: "physical" }],
    },
    {
      code: `const c = cn("p-2", isOpen && "-ml-1");`,
      errors: [{ messageId: "physical", data: { token: "-ml-1", replacement: "-ms-1" } }],
    },
    {
      // A helper inside className is reported once, not twice.
      code: `<div className={clsx("pr-3")} />`,
      errors: [{ messageId: "physical" }],
    },
    {
      code: `<div className="transition translate-x-4" />`,
      errors: [{ messageId: "mirror", data: { token: "translate-x-4", ltr: "ltr:translate-x-4", rtl: "rtl:-translate-x-4" } }],
    },
    {
      code: `<div className="bg-linear-to-r from-primary origin-top-left [margin-left:2px]" />`,
      errors: [{ messageId: "mirror" }, { messageId: "mirror" }, { messageId: "physical" }],
    },
  ],
});

const cssRuleTester = new RuleTester({
  plugins: { css },
  language: "css/css",
  languageOptions: { customSyntax: tailwind4, tolerant: true },
});

cssRuleTester.run("no-physical-direction (CSS @apply)", rule, {
  valid: [
    `.a { @apply ps-4 pe-2 text-start ltr:translate-x-4 rtl:-translate-x-4; }`,
    `.a { margin-left: 4px; }`, // plain properties are css/prefer-logical-properties' job
    `@theme { --color-primary: #d4a843; }`,
    `@custom-variant dark (&:where(.dark, .dark *));`,
  ],
  invalid: [
    {
      code: `.a { @apply flex md:pl-4 text-right; }`,
      errors: [
        { messageId: "physical", data: { token: "md:pl-4", replacement: "md:ps-4" } },
        { messageId: "physical", data: { token: "text-right", replacement: "text-end" } },
      ],
    },
    {
      code: `.a { @apply !mr-2 [margin-left:3px]; }`,
      errors: [{ messageId: "physical" }, { messageId: "physical" }],
    },
    {
      code: `.a:hover { @apply -translate-x-1/2 bg-linear-45; }`,
      errors: [
        { messageId: "mirror", data: { token: "-translate-x-1/2", ltr: "ltr:-translate-x-1/2", rtl: "rtl:translate-x-1/2" } },
        { messageId: "mirror", data: { token: "bg-linear-45", ltr: "ltr:bg-linear-45", rtl: "rtl:-bg-linear-45" } },
      ],
    },
  ],
});
