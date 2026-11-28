import { describe, expect, it } from "vitest";
import { CONTACT_MASK, detectContacts, hasContactDetails, maskContacts, stripContactsForIndex } from "./contactDetails";
import { CLEAN_TEXTS, CONTACT_FIXTURES } from "./contactDetails.fixtures";
import { normalizeSearchText, normalizeWithMap } from "./normalizeText";

describe("normalizeSearchText", () => {
  it("removes marks and unifies letters and digits", () => {
    expect(normalizeSearchText("شَقَّة")).toBe("شقه");
    expect(normalizeSearchText("أإآ ى ة")).toBe("ااا ي ه");
    expect(normalizeSearchText("عـــبدون")).toBe("عبدون");
    expect(normalizeSearchText("ٱلرَّحمٰن")).toBe("ٱلرحمن");
    expect(normalizeSearchText("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789 0123456789");
    expect(normalizeSearchText("ABDOUN Villa")).toBe("abdoun villa");
  });

  it("maps normalized positions back to the original", () => {
    const { text, map } = normalizeWithMap("شَقَّة A");
    expect(text).toBe("شقه a");
    expect(map).toEqual([0, 2, 5, 6, 7, 8]);
  });
});

describe("detectContacts", () => {
  it.each(CONTACT_FIXTURES)("finds $kind in “$text”", ({ text, kind, detail }) => {
    const found = detectContacts(text);
    expect(found.map((f) => [f.kind, f.text])).toContainEqual([kind, detail]);
  });

  it.each(CLEAN_TEXTS)("leaves “%s” alone", (text) => {
    expect(detectContacts(text)).toEqual([]);
    expect(hasContactDetails(text)).toBe(false);
  });

  it("finds several details in order, without overlaps", () => {
    const text = "اتصل 0791234567 أو ahmad@mail.com أو واتس @aqar";
    const kinds = detectContacts(text).map((f) => f.kind);
    expect(kinds).toEqual(["phone", "email", "messenger"]);
  });

  it("handles adjacent mentions and text with diacritics", () => {
    expect(detectContacts("fb fb").map((f) => f.text)).toEqual(["fb", "fb"]);
    expect(detectContacts("راسلنا وَاتْسَاب").map((f) => f.text)).toEqual(["وَاتْسَاب"]);
  });
});

describe("maskContacts", () => {
  it("replaces each detail and keeps the rest", () => {
    expect(maskContacts("شقة للبيع، للتواصل 0791234567 أو واتساب")).toBe(`شقة للبيع، للتواصل ${CONTACT_MASK} أو ${CONTACT_MASK}`);
    expect(maskContacts("Email me: a@b.com.")).toBe(`Email me: ${CONTACT_MASK}.`);
    expect(maskContacts(null)).toBeNull();
    const clean = "Villa in Dabouq";
    expect(maskContacts(clean)).toBe(clean);
  });

  it("masks every fixture so nothing detectable is left", () => {
    for (const { text } of CONTACT_FIXTURES) {
      const masked = maskContacts(text);
      expect(masked).toContain(CONTACT_MASK);
      expect(detectContacts(masked)).toEqual([]);
    }
  });
});

describe("stripContactsForIndex", () => {
  it("drops details from the normalized text", () => {
    expect(stripContactsForIndex("شقة في عبدون 0791234567").trim()).toBe("شقه في عبدون");
    expect(stripContactsForIndex("Villa — WhatsApp +962 79 123 4567").trim()).toBe("villa —");
  });
});
