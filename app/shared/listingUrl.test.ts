import { describe, expect, it } from "vitest";
import { formatPhone, telHref, whatsappChatHref, whatsappShareHref } from "./contactLinks";
import { circleRing } from "./geo";
import { listingPath, parseListingParam } from "./listingUrl";

describe("listingPath / parseListingParam", () => {
  it("builds /:lang/property/{id}-{slug}", () => {
    expect(listingPath("ar", 42, "apartment-sale-abdoun")).toBe("/ar/property/42-apartment-sale-abdoun");
    expect(listingPath("en", 7, null)).toBe("/en/property/7");
  });

  it("parses id and optional slug", () => {
    expect(parseListingParam("42-apartment-sale-abdoun")).toEqual({ id: 42, slug: "apartment-sale-abdoun" });
    expect(parseListingParam("42")).toEqual({ id: 42, slug: null });
  });

  it("rejects anything else", () => {
    for (const bad of [undefined, "", "0", "-1", "abc", "042-x", "42-UPPER", "42-ab_c", "42 x", "99999999999", "2147483648"]) {
      expect(parseListingParam(bad)).toBeNull();
    }
    expect(parseListingParam("2147483647")).toEqual({ id: 2147483647, slug: null });
  });
});

describe("contact links", () => {
  it("tel and WhatsApp links use the digits of the E.164 number", () => {
    expect(telHref("+96265000001")).toBe("tel:+96265000001");
    expect(whatsappChatHref("+96265000001", "مرحبا a&b")).toBe(`https://wa.me/96265000001?text=${encodeURIComponent("مرحبا a&b")}`);
    expect(whatsappShareHref("x y")).toBe("https://wa.me/?text=x%20y");
  });

  it("formats Jordanian numbers for display and leaves others as they are", () => {
    expect(formatPhone("+96265000001")).toBe("+962 6 500 0001");
    expect(formatPhone("+962791234567")).toBe("+962 79 123 4567");
    expect(formatPhone("+96550001234")).toBe("+96550001234");
  });
});

describe("circleRing", () => {
  it("is a closed ring whose points are radiusM from the centre", () => {
    const ring = circleRing(35.9, 31.95, 300, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    const toRad = (d: number) => (d * Math.PI) / 180;
    for (const [lng, lat] of ring) {
      const dφ = toRad(lat - 31.95);
      const dλ = toRad(lng - 35.9);
      const h = Math.sin(dφ / 2) ** 2 + Math.cos(toRad(31.95)) * Math.cos(toRad(lat)) * Math.sin(dλ / 2) ** 2;
      expect(2 * 6_371_008.8 * Math.asin(Math.sqrt(h))).toBeCloseTo(300, -0.5);
    }
  });
});
