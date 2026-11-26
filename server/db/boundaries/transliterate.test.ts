import { describe, expect, it } from "vitest";
import { fold, slugify, transliterate } from "./transliterate";

describe("transliterate", () => {
  it.each([
    ["عبدون", "Abdoun"],
    ["خلدا", "Khalda"],
    ["الصويفية", "Al-Sweifieh"],
    ["الجبيهة", "Al-Jubeiha"],
    ["تلاع العلي", "Tla' Al-Ali"],
    ["جبل عمان", "Jabal Amman"],
    ["أم أذينة", "Umm Adheina"],
    ["عبدون الجنوبي", "Abdoun Al-Janoubi"],
    ["ماركا الشمالية", "Marka Al-Shamaliya"],
  ])("%s → %s", (ar, en) => {
    expect(transliterate(ar)).toBe(en);
  });

  it("produces only Latin output for any Arabic input", () => {
    for (const name of ["حي نزال", "الرابية", "شفا بدران", "طبربور", "المدينة الرياضية", "ضاحية الرشيد"]) {
      expect(transliterate(name)).toMatch(/^[A-Za-z' -]+$/);
    }
  });

  it("ignores diacritics and tatweel", () => {
    expect(transliterate("عَبْدُون")).toBe(transliterate("عبدون"));
    expect(transliterate("عبـدون")).toBe(transliterate("عبدون"));
  });
});

describe("fold", () => {
  it("unifies alef forms, taa marbuta and alef maqsura", () => {
    expect(fold("أإآٱ")).toBe("اااا");
    expect(fold("مدينة")).toBe("مدينه");
    expect(fold("مصطفى")).toBe("مصطفي");
  });
});

describe("slugify", () => {
  it.each([
    ["Tla' Al-Ali", "tla-al-ali"],
    ["Abdoun", "abdoun"],
    ["Umm  Uthaina (East)", "umm-uthaina-east"],
    ["Jabal Al-Weibdeh", "jabal-al-weibdeh"],
  ])("%s → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("returns an empty string for names with no Latin letters", () => {
    expect(slugify("عبدون")).toBe("");
  });
});
