import { describe, expect, it } from "vitest";
import { decodePolyline, encodePolyline } from "../polyline";
import { bboxSchema, countFilters, decodePolygon, encodePolygon, parseMapSearch, polygonSchema, toSearchParams } from "./mapSearch";

const ring: Array<[number, number]> = [
  [35.85, 31.95],
  [35.9, 31.95],
  [35.9, 32.0],
  [35.85, 32.0],
  [35.85, 31.95],
];

describe("polyline", () => {
  it("round-trips at 5 decimals, including negatives", () => {
    const pts: Array<[number, number]> = [
      [35.91061, 31.95392],
      [-0.12345, -45.6789],
      [179.99999, 85],
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });

  it("returns null for malformed input", () => {
    expect(decodePolyline("not valid ✓")).toBeNull();
    expect(decodePolyline("_p~iF~ps|U_")).toBeNull(); // truncated
  });
});

describe("map search URL state", () => {
  it("parses the SPEC example and writes it back in a stable order", () => {
    const qs = "lat=31.95&lng=35.91&z=12&type=sale&cat=apartment&minPrice=50000&maxPrice=150000&beds=3,2";
    const { state, invalid } = parseMapSearch(new URLSearchParams(qs));
    expect(invalid).toEqual([]);
    expect(state).toMatchObject({
      view: { lat: 31.95, lng: 35.91, z: 12 },
      filters: { type: "sale", cat: "apartment", minPrice: 50000, maxPrice: 150000, beds: [2, 3] },
      sort: "newest",
      page: 1,
    });
    expect(toSearchParams(state).toString()).toBe(
      "lat=31.95&lng=35.91&z=12&type=sale&cat=apartment&minPrice=50000&maxPrice=150000&beds=2%2C3",
    );
  });

  it("drops invalid values and reports them", () => {
    const { state, invalid } = parseMapSearch({ type: "castle", beds: "two", z: "99", lat: "31", lng: "35", sort: "random", page: "0", amen: "pool,sauna" });
    expect(state.filters).toEqual({});
    expect(state.view).toBeUndefined();
    expect(invalid.sort()).toEqual(["amen", "beds", "page", "sort", "type", "view"]);
  });

  it("swaps reversed ranges and dedupes lists", () => {
    const { state } = parseMapSearch({ minPrice: "900", maxPrice: "100", amen: "pool,garden,pool", beds: "5,1,5" });
    expect(state.filters).toMatchObject({ minPrice: 100, maxPrice: 900, amen: ["garden", "pool"], beds: [1, 5] });
  });

  it("round-trips a drawn polygon and closes open rings", () => {
    const encoded = encodePolygon(ring);
    const { state } = parseMapSearch({ poly: encoded });
    expect(state.poly).toEqual(ring);
    expect(decodePolygon(encodePolyline(ring.slice(0, 4)))).toEqual(ring);
    expect(decodePolygon(encodePolyline(ring.slice(0, 2)))).toBeNull();
  });

  it("refuses polygons with too many corners", () => {
    const many = Array.from({ length: 150 }, (_, i): [number, number] => [35 + Math.cos(i) / 10, 32 + Math.sin(i) / 10]);
    expect(decodePolygon(encodePolyline(many))).toBeNull();
  });

  it("omits defaults and counts active filters", () => {
    expect(toSearchParams({ filters: {}, sort: "newest", page: 1 }).toString()).toBe("");
    expect(countFilters({ type: "rent", beds: [], amen: ["pool"] })).toBe(2);
  });
});

describe("API input", () => {
  it("validates bbox strings", () => {
    expect(bboxSchema.parse("35.1,31.2,36.3,32.4")).toEqual([35.1, 31.2, 36.3, 32.4]);
    for (const bad of ["35,31,34,32", "a,b,c,d", "35,31,36", "200,31,201,32"]) expect(bboxSchema.safeParse(bad).success).toBe(false);
  });

  it("validates polygon bodies (closed single ring)", () => {
    expect(polygonSchema.safeParse({ type: "Polygon", coordinates: [ring] }).success).toBe(true);
    expect(polygonSchema.safeParse({ type: "Polygon", coordinates: [ring.slice(0, 4)] }).success).toBe(false);
    expect(polygonSchema.safeParse({ type: "Polygon", coordinates: [ring, ring] }).success).toBe(false);
  });
});
