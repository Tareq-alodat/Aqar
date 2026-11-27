import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./no-physical-direction";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("no-physical-direction (style objects, map controls)", rule, {
  valid: [
    `<div style={{ marginInlineStart: 8, insetInlineEnd: 0, textAlign: "start", height: "50%" }} />`,
    `<div style={styles} />`,
    `<div style={{ top: 0, bottom: 0, transform: "translateY(10px)" }} />`,
    `map.addControl(new NavigationControl(), controlPosition("top-end", dir));`,
    `map.addControl(new NavigationControl(), position);`,
    `new Popup({ anchor: "bottom", offset: 12 });`,
    `new Marker({ anchor: anchorFor(dir) });`,
    // Map layer label placement is geographic, not reading direction.
    `const layout = { "text-anchor": "left" };`,
    // Only JSX style objects are checked.
    `const o = { marginLeft: 4 };`,
  ],
  invalid: [
    {
      code: `<div style={{ marginLeft: 8, right: 0, "paddingRight": 4, borderTopLeftRadius: 2 }} />`,
      errors: [
        { messageId: "styleProperty", data: { prop: "marginLeft", replacement: "marginInlineStart" } },
        { messageId: "styleProperty", data: { prop: "right", replacement: "insetInlineEnd" } },
        { messageId: "styleProperty", data: { prop: "paddingRight", replacement: "paddingInlineEnd" } },
        { messageId: "styleProperty", data: { prop: "borderTopLeftRadius", replacement: "borderStartStartRadius" } },
      ],
    },
    {
      code: `<p style={{ textAlign: "right", float: "left" }} />`,
      errors: [
        { messageId: "styleValue", data: { prop: "textAlign", value: "right", replacement: "end" } },
        { messageId: "styleValue", data: { prop: "float", value: "left", replacement: "inline-start" } },
      ],
    },
    {
      code: `map.addControl(new NavigationControl(), "top-left");`,
      errors: [{ messageId: "mapCorner", data: { value: "top-left", logical: "top-start" } }],
    },
    {
      code: `this.map.addControl(attribution, "bottom-right");`,
      errors: [{ messageId: "mapCorner", data: { value: "bottom-right", logical: "bottom-end" } }],
    },
    {
      code: `new maplibregl.Popup({ anchor: "left" }); new Marker({ anchor: "bottom-right" });`,
      errors: [
        { messageId: "anchor", data: { cls: "Popup", value: "left" } },
        { messageId: "anchor", data: { cls: "Marker", value: "bottom-right" } },
      ],
    },
  ],
});
