import { describe, expect, it } from "vitest";
import { ACTIVE_COUNTRIES, toCountryCode } from "./countries";
import { dirFor, localeFromPathname, switchLocalePath } from "./locales";
import { mapParamsSchema } from "./schemas/routeParams";

describe("mapParamsSchema (/:lang/:country/map)", () => {
  it.each([
    ["ar", "jo"],
    ["en", "jo"],
  ])("accepts lang=%s country=%s", (lang, country) => {
    expect(mapParamsSchema.safeParse({ lang, country }).success).toBe(true);
  });

  it.each([
    ["fr", "jo"], // unknown locale
    ["ar", "sa"], // country exists but is not active yet
    ["ar", "JO"], // URL segments are lowercase
    ["ar", "xx"],
    ["ar", undefined],
  ])("rejects lang=%s country=%s", (lang, country) => {
    expect(mapParamsSchema.safeParse({ lang, country }).success).toBe(false);
  });

  it("only Jordan is active in phase 1", () => {
    expect(ACTIVE_COUNTRIES).toEqual(["jo"]);
    expect(toCountryCode("jo")).toBe("JO");
  });
});

describe("locale helpers", () => {
  it("maps locale to text direction", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });

  it("reads the locale from the path, defaulting to Arabic", () => {
    expect(localeFromPathname("/en/jo/map")).toBe("en");
    expect(localeFromPathname("/ar/jo/map")).toBe("ar");
    expect(localeFromPathname("/")).toBe("ar");
    expect(localeFromPathname("/fr/jo/map")).toBe("ar");
  });

  it("swaps the locale segment and keeps the rest of the path", () => {
    expect(switchLocalePath("/ar/jo/map", "en")).toBe("/en/jo/map");
    expect(switchLocalePath("/en/jo/map", "ar")).toBe("/ar/jo/map");
    expect(switchLocalePath("/", "en")).toBe("/en");
    expect(switchLocalePath("/unknown", "en")).toBe("/en/unknown");
  });
});
