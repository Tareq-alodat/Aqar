import { describe, expect, it } from "vitest";
import { maskPhone } from "../phone";
import {
  detailsStepSchema,
  hasAtMostDecimals,
  locationStepSchema,
  missingForSubmit,
  saveStepSchema,
  submitSchema,
  typeStepSchema,
  type DraftView,
} from "./listingForm";

const draft = (over: Partial<DraftView> = {}): DraftView => ({
  id: 1,
  status: "draft",
  countryCode: "JO",
  category: "apartment",
  listingType: "sale",
  rentPeriod: null,
  location: { point: { lng: 35.88, lat: 31.95 }, displayPoint: { lng: 35.881, lat: 31.951 }, areaPath: [], needsReview: false },
  address: {},
  identifiers: {},
  details: {
    price: 100000,
    areaSqm: null,
    bedrooms: null,
    bathrooms: null,
    floors: null,
    floorNumber: null,
    ageYears: null,
    parking: false,
    garden: false,
    pool: false,
    elevator: false,
    furnished: null,
    amenities: [],
    titleAr: "شقة",
    titleEn: null,
    descriptionAr: null,
    descriptionEn: null,
  },
  offersVisibility: "amounts_only",
  images: [{ id: 1, url: "/u/a.webp", thumbnailUrl: "/u/a-thumb.webp", width: 10, height: 10 }],
  slug: null,
  updatedAt: "2026-11-28T00:00:00.000Z",
  ...over,
});
const none = { requiredAddress: [], requiredIdentifiers: [] };

describe("typeStepSchema", () => {
  it("requires a rent period for rentals only", () => {
    expect(typeStepSchema.safeParse({ category: "house", listingType: "rent", rentPeriod: "monthly" }).success).toBe(true);
    expect(typeStepSchema.safeParse({ category: "house", listingType: "rent", rentPeriod: null }).success).toBe(false);
    expect(typeStepSchema.safeParse({ category: "house", listingType: "sale", rentPeriod: "yearly" }).success).toBe(false);
    expect(typeStepSchema.safeParse({ category: "castle", listingType: "sale", rentPeriod: null }).success).toBe(false);
  });
});

describe("step schemas", () => {
  it("location: no exact/approximate choice (every listing is approximate)", () => {
    expect(locationStepSchema.safeParse({ point: { lng: 35.9, lat: 31.9 } }).success).toBe(true);
    expect(locationStepSchema.safeParse({ precision: "exact" }).success).toBe(false);
    expect(locationStepSchema.safeParse({ point: { lng: 200, lat: 0 } }).success).toBe(false);
  });

  it("details: refuses unknown fields and out-of-range values", () => {
    expect(detailsStepSchema.safeParse({ price: 1.5, bedrooms: 3, amenities: ["balcony"] }).success).toBe(true);
    expect(detailsStepSchema.safeParse({ bedrooms: -1 }).success).toBe(false);
    expect(detailsStepSchema.safeParse({ amenities: ["helipad"] }).success).toBe(false);
    expect(detailsStepSchema.safeParse({ ownerPhone: "0791234567" }).success).toBe(false);
  });

  it("save: one step per request", () => {
    expect(saveStepSchema.safeParse({ step: "review", data: { offersVisibility: "private" } }).success).toBe(true);
    expect(saveStepSchema.safeParse({ step: "photos", data: {} }).success).toBe(false);
  });

  it("submit: the terms must be accepted", () => {
    expect(submitSchema.safeParse({ acceptTerms: true, termsVersion: "2026-11-draft" }).success).toBe(true);
    expect(submitSchema.safeParse({ acceptTerms: false, termsVersion: "2026-11-draft" }).success).toBe(false);
    expect(submitSchema.safeParse({ termsVersion: "2026-11-draft" }).success).toBe(false);
  });
});

describe("missingForSubmit", () => {
  it("is empty for a complete draft", () => {
    expect(missingForSubmit(draft(), none)).toEqual([]);
  });

  it("lists the pin, price, title and photos", () => {
    const d = draft({
      location: { point: null, displayPoint: null, areaPath: [], needsReview: false },
      details: { ...draft().details, price: null, titleAr: " ", titleEn: null },
      images: [],
    });
    expect(missingForSubmit(d, none).map((m) => m.field)).toEqual(["point", "price", "title", "images"]);
  });

  it("photos are optional for land only", () => {
    expect(missingForSubmit(draft({ category: "land", images: [] }), none)).toEqual([]);
    for (const category of ["house", "apartment", "villa", "commercial"] as const) {
      expect(missingForSubmit(draft({ category, images: [] }), none)).toEqual([{ step: "photos", field: "images" }]);
    }
  });

  it("exchange listings need no price", () => {
    const d = draft({ listingType: "exchange", details: { ...draft().details, price: null } });
    expect(missingForSubmit(d, none)).toEqual([]);
  });

  it("checks the country's required address fields and identifiers", () => {
    const req = { requiredAddress: ["street"], requiredIdentifiers: ["jo_land_parcel"] };
    expect(missingForSubmit(draft(), req).map((m) => m.field)).toEqual(["address.street", "identifiers.jo_land_parcel"]);
    expect(missingForSubmit(draft({ address: { street: "x" }, identifiers: { jo_land_parcel: { parcel: "1" } } }), req)).toEqual([]);
  });
});

describe("hasAtMostDecimals", () => {
  it("follows the currency's decimal count", () => {
    expect(hasAtMostDecimals(1.125, 3)).toBe(true);
    expect(hasAtMostDecimals(1.1255, 3)).toBe(false);
    expect(hasAtMostDecimals(85000, 0)).toBe(true);
    // Floating-point noise (0.30000000000000004) is not a third decimal.
    expect(hasAtMostDecimals(0.1 + 0.2, 2)).toBe(true);
    expect(hasAtMostDecimals(0.3, 2)).toBe(true);
  });
});

describe("maskPhone", () => {
  it("keeps only the prefix and the last two digits", () => {
    expect(maskPhone("+962791234567", "+962")).toBe("+962 •••••••67");
    expect(maskPhone("+96265000001", "+962")).toBe("+962 ••••••01");
    const masked = maskPhone("+962791234567", "+962");
    expect(masked).not.toContain("79123");
    expect(maskPhone("+96550001234", "+962")).toBe("+ •••••••••34");
  });
});
