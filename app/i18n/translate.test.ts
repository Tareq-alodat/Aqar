import { describe, expect, it } from "vitest";
import { dictionaries, getT } from "./index";
import { PLURAL_CATEGORIES, translate, type Dictionary } from "./translate";

describe("t() — Arabic plurals via Intl.PluralRules", () => {
  const t = getT("ar");

  it.each([
    [0, "لا توجد عقارات في هذه المنطقة"], // zero
    [1, "عقار واحد في هذه المنطقة"], // one
    [2, "عقاران في هذه المنطقة"], // two
    [3, "3 عقارات في هذه المنطقة"], // few (3–10)
    [10, "10 عقارات في هذه المنطقة"], // few
    [11, "11 عقارًا في هذه المنطقة"], // many (11–99)
    [99, "99 عقارًا في هذه المنطقة"], // many
    [100, "100 عقار في هذه المنطقة"], // other
    [103, "103 عقارات في هذه المنطقة"], // few (n % 100 in 3–10)
  ])("count = %i", (count, expected) => {
    expect(t("map.resultsCount", { count })).toBe(expected);
  });

  it("uses Western digits", () => {
    expect(t("map.resultsCount", { count: 5 })).toMatch(/^5 /);
  });
});

describe("t() — English plurals", () => {
  const t = getT("en");

  it.each([
    [0, "0 properties in this area"],
    [1, "1 property in this area"],
    [2, "2 properties in this area"],
    [1000, "1,000 properties in this area"],
  ])("count = %i", (count, expected) => {
    expect(t("map.resultsCount", { count })).toBe(expected);
  });
});

describe("translate()", () => {
  const dict: Dictionary = {
    greet: "Hello {name}",
    items: { one: "{count} item", other: "{count} items" },
    onlyOther: { other: "{count} things" },
  };

  it("interpolates params and leaves unknown placeholders intact", () => {
    expect(translate(dict, "en", "greet", { name: "Sara" })).toBe("Hello Sara");
    expect(translate(dict, "en", "greet")).toBe("Hello {name}");
  });

  it("falls back to `other` when the locale's category is missing", () => {
    // Arabic selects "two" for 2, which this entry does not define.
    expect(translate(dict, "ar", "onlyOther", { count: 2 })).toBe("2 things");
  });

  it("returns the key when it is missing or not a string", () => {
    expect(translate(dict, "en", "nope.missing")).toBe("nope.missing");
    expect(translate(dict, "en", "items")).toBe("items"); // plural without count
  });
});

/** Flatten to key paths; plural groups collapse to their base key. */
function keyPaths(dict: Dictionary, prefix = ""): string[] {
  return Object.entries(dict).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [path];
    const isPlural = Object.keys(value).every((k) =>
      (PLURAL_CATEGORIES as readonly string[]).includes(k),
    );
    if (isPlural) {
      expect(value.other, `${path} must define "other"`).toBeTypeOf("string");
      return [path];
    }
    return keyPaths(value, path);
  });
}

describe("dictionaries", () => {
  it("ar.json and en.json define the same keys", () => {
    expect(keyPaths(dictionaries.ar).sort()).toEqual(keyPaths(dictionaries.en).sort());
  });
});
