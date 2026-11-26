import { describe, expect, it } from "vitest";
import { buildAddressSchema, publicAddress, type CountryAddressField } from "./address";

const field = (f: Partial<CountryAddressField> & Pick<CountryAddressField, "field_key" | "kind" | "visibility">): CountryAddressField => ({
  label_ar: "",
  label_en: "",
  pattern: null,
  position: 0,
  is_required: false,
  ...f,
});

const jordan: CountryAddressField[] = [
  field({ field_key: "governorate", kind: "admin_area", visibility: "public" }),
  field({ field_key: "street", kind: "text", visibility: "exact_only" }),
  field({ field_key: "building_number", kind: "text", visibility: "exact_only", pattern: "^[0-9A-Za-z\\- ]{1,10}$" }),
  field({ field_key: "apartment_number", kind: "text", visibility: "admin_only" }),
  field({ field_key: "jo_land_parcel", kind: "identifier", visibility: "admin_only" }),
];

describe("buildAddressSchema", () => {
  const schema = buildAddressSchema(jordan);

  it("accepts typed fields and converts digits", () => {
    expect(schema.parse({ street: " شارع زهران ", building_number: "١٢" })).toEqual({ street: "شارع زهران", building_number: "12" });
  });

  it("accepts an empty address when nothing is required", () => {
    expect(schema.parse({})).toEqual({});
  });

  it("rejects area levels, identifiers and unknown keys", () => {
    expect(schema.safeParse({ governorate: "Amman" }).success).toBe(false);
    expect(schema.safeParse({ jo_land_parcel: "1/2/3/4" }).success).toBe(false);
    expect(schema.safeParse({ floor: "3" }).success).toBe(false);
  });

  it("applies the field pattern", () => {
    expect(schema.safeParse({ building_number: "12; DROP" }).success).toBe(false);
  });

  it("enforces required fields", () => {
    const required = buildAddressSchema([field({ field_key: "street", kind: "text", visibility: "public", is_required: true })]);
    expect(required.safeParse({}).success).toBe(false);
    expect(required.safeParse({ street: "  " }).success).toBe(false);
  });
});

describe("publicAddress", () => {
  const address = { street: "شارع زهران", building_number: "12", apartment_number: "7" };

  it("shows exact_only fields for exact listings, never admin_only", () => {
    expect(publicAddress(jordan, address, "exact")).toEqual({ street: "شارع زهران", building_number: "12" });
  });

  it("hides exact_only fields for approximate listings", () => {
    expect(publicAddress(jordan, address, "approximate")).toEqual({});
  });

  it("ignores keys that are not in the settings", () => {
    expect(publicAddress(jordan, { ...address, secret: "x" }, "exact")).not.toHaveProperty("secret");
  });
});
