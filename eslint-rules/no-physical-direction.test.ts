import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import rule, { physicalReplacement } from "./no-physical-direction";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("physicalReplacement", () => {
  it.each([
    ["pl-4", "ps-4"],
    ["pr-2", "pe-2"],
    ["ml-auto", "ms-auto"],
    ["-mr-1", "-me-1"],
    ["left-0", "start-0"],
    ["right-[3px]", "end-[3px]"],
    ["text-left", "text-start"],
    ["text-right", "text-end"],
    ["md:hover:pl-4", "ps-4"],
    ["!mr-2", "me-2"],
    ["border-l", "border-s"],
    ["border-r-2", "border-e-2"],
    ["rounded-tl-lg", "rounded-ss-lg"],
    ["float-right", "float-end"],
  ])("%s → %s", (token, expected) => {
    expect(physicalReplacement(token)).toBe(expected);
  });

  it.each(["ps-4", "pe-2", "ms-auto", "start-0", "end-0", "text-start", "px-4", "mx-auto", "border-b", "rounded-lg",
    "rtl:pl-4", "ltr:left-0", "md:rtl:mr-2", "leftover", "inset-x-0", "[&:hover]:ps-2"])(
    "%s is allowed",
    (token) => {
      expect(physicalReplacement(token)).toBeNull();
    },
  );
});

ruleTester.run("no-physical-direction", rule, {
  valid: [
    `<div className="ps-4 pe-2 ms-auto text-start" />`,
    `<div className={\`px-4 \${active ? "ms-2" : "me-2"}\`} />`,
    `<div className="rtl:rotate-180 ltr:left-0" />`,
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
  ],
});
