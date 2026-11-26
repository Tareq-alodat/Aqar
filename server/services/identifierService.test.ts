import { describe, expect, it } from "vitest";
import { buildingKey, IdentifierError, normalizeIdentifier, type IdentifierScheme } from "./identifierService";

const parcel: IdentifierScheme = {
  key: "jo_land_parcel",
  pattern: null,
  strip_leading_zeros: true,
  group_parts: 4,
  parts: [
    { key: "directorate", label_ar: "", label_en: "", required: true, numeric: false },
    { key: "village", label_ar: "", label_en: "", required: true, numeric: false },
    { key: "basin", label_ar: "", label_en: "", required: true, numeric: false },
    { key: "parcel", label_ar: "", label_en: "", required: true, numeric: true },
    { key: "apartment", label_ar: "", label_en: "", required: false, numeric: true },
  ],
};

const paci: IdentifierScheme = { key: "kw_paci", pattern: "^[0-9]{6,12}$", strip_leading_zeros: false, parts: null, group_parts: null };
const saudi: IdentifierScheme = { key: "sa_national_address", pattern: "^[A-Z]{4}[0-9]{4}$", strip_leading_zeros: false, parts: null, group_parts: null };

const land = { directorate: "عمان الغربية", village: "وادي السير", basin: "3 أم أذينة", parcel: "0123" };

describe("jo_land_parcel", () => {
  it("joins parts with / and normalizes each part separately", () => {
    expect(normalizeIdentifier(parcel, land, "land")).toEqual({
      value: "عمان الغربية/وادي السير/3 أم أذينة/0123",
      value_normalized: "عمان الغربيه/وادي السير/3 ام اذينه/123",
    });
  });

  it("treats Arabic-Indic digits, spacing and letter variants as equal", () => {
    const a = normalizeIdentifier(parcel, land, "land");
    const b = normalizeIdentifier(
      parcel,
      { directorate: "  عمان   الغربيه ", village: "وادي السير", basin: "٣ ام اذينة", parcel: "١٢٣" },
      "land",
    );
    expect(b.value_normalized).toBe(a.value_normalized);
  });

  it("requires the apartment number for apartment listings", () => {
    expect(() => normalizeIdentifier(parcel, land, "apartment")).toThrow(IdentifierError);
    const apt = normalizeIdentifier(parcel, { ...land, apartment: "007" }, "apartment");
    expect(apt.value_normalized).toBe("عمان الغربيه/وادي السير/3 ام اذينه/123/7");
  });

  it("rejects an apartment number on non-apartment listings", () => {
    expect(() => normalizeIdentifier(parcel, { ...land, apartment: "7" }, "villa")).toThrow(
      expect.objectContaining({ code: "not_allowed", part: "apartment" }),
    );
  });

  it("rejects missing required parts", () => {
    expect(() => normalizeIdentifier(parcel, { ...land, basin: " " }, "land")).toThrow(
      expect.objectContaining({ code: "required", part: "basin" }),
    );
  });

  it("rejects non-numeric parcel numbers and the separator", () => {
    expect(() => normalizeIdentifier(parcel, { ...land, parcel: "12a" }, "land")).toThrow(
      expect.objectContaining({ code: "invalid", part: "parcel" }),
    );
    expect(() => normalizeIdentifier(parcel, { ...land, village: "a/b" }, "land")).toThrow(
      expect.objectContaining({ code: "invalid", part: "village" }),
    );
  });

  it("keeps a parcel number of zero", () => {
    expect(normalizeIdentifier(parcel, { ...land, parcel: "000" }, "land").value_normalized.endsWith("/0")).toBe(true);
  });

  it("rejects a plain string", () => {
    expect(() => normalizeIdentifier(parcel, "1/2/3/4", "land")).toThrow(IdentifierError);
  });
});

describe("buildingKey", () => {
  it("is the first four parts", () => {
    expect(buildingKey(parcel, "a/b/c/123/7")).toBe("a/b/c/123");
    expect(buildingKey(parcel, "a/b/c/123")).toBe("a/b/c/123");
  });

  it("is null for schemes without grouping", () => {
    expect(buildingKey(paci, "123456")).toBeNull();
  });
});

describe("single-part schemes", () => {
  it("kw_paci keeps leading zeros and strips spaces", () => {
    expect(normalizeIdentifier(paci, " 0012 3456 ")).toEqual({ value: "0012 3456", value_normalized: "00123456" });
  });

  it("kw_paci accepts Arabic-Indic digits", () => {
    expect(normalizeIdentifier(paci, "١٢٣٤٥٦٧٨").value_normalized).toBe("12345678");
  });

  it("sa_national_address uppercases", () => {
    expect(normalizeIdentifier(saudi, "rrrd 2929").value_normalized).toBe("RRRD2929");
  });

  it("rejects values that do not match the pattern", () => {
    expect(() => normalizeIdentifier(paci, "12")).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => normalizeIdentifier(saudi, "RRR2929")).toThrow(IdentifierError);
  });
});
