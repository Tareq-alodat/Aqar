import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { bboxAround, bboxContains, pointInRing, type BBox } from "~/shared/geo";
import { formatPrice, shortNumber, shortPrice } from "~/utils/format";
import { controlPosition, nameExpression, transformStyle } from "./mapStyle";
import { PIN_STRETCH_X, PIN_TIP_OFFSET_PX } from "./pins";
import { canReuse, countInView, padBBox, type PointsCacheEntry } from "./pointsCache";
import type { PointFeature } from "./types";

const t = (key: string) => ({ "map.perMonth": "/mo", "map.perYear": "/yr", "listing.types.exchange": "Exchange" })[key] ?? key;

describe("price labels", () => {
  it.each([
    [850, "850"],
    [85_000, "85K"],
    [125_500, "126K"],
    [1_250_000, "1.25M"],
    [12_500_000, "12.5M"],
    [2_000_000_000, "2B"],
  ])("%d → %s", (n, s) => expect(shortNumber(n)).toBe(s));

  it("adds the rent period and names exchanges", () => {
    expect(shortPrice(450, "monthly", t)).toBe("450/mo");
    expect(shortPrice(5400, "yearly", t)).toBe("5.4K/yr");
    expect(shortPrice(null, null, t)).toBe("Exchange");
  });

  it("formats full prices with the country's decimals and Western digits", () => {
    // Intl separates the currency with a no-break space.
    const plain = (s: string) => s.replace(/\s/g, " ");
    expect(plain(formatPrice(85000, "JOD", 3, "en"))).toBe("JOD 85,000");
    expect(plain(formatPrice(85000.5, "JOD", 3, "en"))).toBe("JOD 85,000.5");
    expect(formatPrice(85000, "JOD", 3, "ar")).toMatch(/85,000/);
    expect(formatPrice(85000, "JOD", 3, "ar")).not.toMatch(/[٠-٩]/);
  });
});

describe("geometry helpers", () => {
  it("computes a viewport around a centre", () => {
    const b = bboxAround(35.91, 31.95, 12, 800, 600);
    expect(b[0]).toBeLessThan(35.91);
    expect(b[2]).toBeGreaterThan(35.91);
    expect(b[2] - b[0]).toBeCloseTo((800 / (512 * 2 ** 12)) * 360, 6);
    expect(b[1]).toBeLessThan(31.95);
    expect(b[3]).toBeGreaterThan(31.95);
  });

  it("tests containment and point-in-ring", () => {
    expect(bboxContains([0, 0, 10, 10], [1, 1, 9, 9])).toBe(true);
    expect(bboxContains([0, 0, 10, 10], [1, 1, 11, 9])).toBe(false);
    const square: Array<[number, number]> = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    expect(pointInRing(1, 1, square)).toBe(true);
    expect(pointInRing(3, 1, square)).toBe(false);
  });
});

describe("points cache (no refetch when zooming in)", () => {
  const feature = (id: number, lng: number, lat: number): PointFeature => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { id, price: 1, currency: "JOD", listing_type: "sale", rent_period: null, category: "land", is_featured: false },
  });
  const view: BBox = [35.8, 31.9, 36.0, 32.0];
  const entry: PointsCacheEntry = { filtersKey: "type=sale|", bbox: padBBox(view), truncated: false, features: [feature(1, 35.9, 31.95), feature(2, 35.81, 32.04)] };

  it("pads the requested area by a quarter on each side", () => {
    const [a, b, c, d] = padBBox(view);
    expect(a).toBeCloseTo(35.75);
    expect(b).toBeCloseTo(31.875);
    expect(c).toBeCloseTo(36.05);
    expect(d).toBeCloseTo(32.025);
  });

  it("is reused for a view inside it with the same filters", () => {
    expect(canReuse(entry, "type=sale|", [35.85, 31.92, 35.95, 31.98])).toBe(true); // zoomed in
    expect(canReuse(entry, "type=sale|", view)).toBe(true);
  });

  it("is not reused when the view leaves it, filters change or it was truncated", () => {
    expect(canReuse(entry, "type=sale|", [35.6, 31.9, 36.0, 32.0])).toBe(false);
    expect(canReuse(entry, "type=rent|", view)).toBe(false);
    expect(canReuse({ ...entry, truncated: true }, "type=sale|", view)).toBe(false);
    expect(canReuse(null, "type=sale|", view)).toBe(false);
  });

  it("counts only the points in view", () => {
    expect(countInView(entry.features, view)).toBe(1);
  });
});

describe("basemap style", () => {
  const style = {
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
    layers: [
      { id: "bg", type: "background" },
      {
        id: "place",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        layout: { "text-field": ["case", ["has", "name:nonlatin"], ["concat", ["get", "name:latin"], "\n", ["get", "name:nonlatin"]], ["get", "name"]] },
      },
      { id: "shield", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", layout: { "text-field": ["to-string", ["get", "ref"]] } },
    ],
  } as unknown as StyleSpecification;

  it("shows one language in labels and leaves road numbers alone", () => {
    const ar = transformStyle("ar")(undefined, style);
    expect((ar.layers[1] as { layout: Record<string, unknown> }).layout["text-field"]).toEqual(nameExpression("ar"));
    expect((ar.layers[2] as { layout: Record<string, unknown> }).layout["text-field"]).toEqual(["to-string", ["get", "ref"]]);
    expect(JSON.stringify(nameExpression("ar"))).toContain("name:ar");
    expect(JSON.stringify(nameExpression("en"))).toContain("name:en");
  });

  it("carries our own sources and layers over to a new basemap (theme switch)", () => {
    const previous = {
      ...style,
      sources: { ...style.sources, "aqar-points": { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [...style.layers, { id: "aqar-pins", type: "symbol", source: "aqar-points" }],
    } as unknown as StyleSpecification;
    const next = transformStyle("en")(previous, style);
    expect(Object.keys(next.sources)).toContain("aqar-points");
    expect(next.layers.at(-1)?.id).toBe("aqar-pins");
  });

  it("tints water and green areas when a tint is given (design v2), and only then", () => {
    const basemap = {
      version: 8,
      sources: {},
      layers: [
        { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "rgb(194, 200, 202)", "fill-opacity": 1 } },
        { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": "hsl(195,17%,78%)" } },
        { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": "rgb(230, 233, 229)" } },
        { id: "landuse_park", type: "fill", source: "openmaptiles", "source-layer": "landuse", paint: { "fill-color": "rgb(32,32,32)" } },
        { id: "landuse_residential", type: "fill", source: "openmaptiles", "source-layer": "landuse", paint: { "fill-color": "rgb(234, 234, 230)" } },
      ],
    } as unknown as StyleSpecification;
    const paint = (st: StyleSpecification, id: string) => (st.layers.find((l) => l.id === id) as { paint: Record<string, unknown> }).paint;
    const tinted = transformStyle("en", { water: "#cfe3f0", green: "#dcebd6" })(undefined, basemap);
    expect(paint(tinted, "water")).toEqual({ "fill-color": "#cfe3f0", "fill-opacity": 1 });
    expect(paint(tinted, "waterway")["line-color"]).toBe("#cfe3f0");
    expect(paint(tinted, "park")["fill-color"]).toBe("#dcebd6");
    expect(paint(tinted, "landuse_park")["fill-color"]).toBe("#dcebd6");
    expect(paint(tinted, "landuse_residential")["fill-color"]).toBe("rgb(234, 234, 230)");
    expect(paint(transformStyle("en")(undefined, basemap), "water")["fill-color"]).toBe("rgb(194, 200, 202)");
  });

  it("pin stretch zones are valid and equal, so MapLibre keeps the image and the tail stays centred", () => {
    expect(PIN_STRETCH_X).toHaveLength(2);
    for (const [from, to] of PIN_STRETCH_X) expect(to - from).toBeGreaterThan(0);
    const [[a0, a1], [b0, b1]] = PIN_STRETCH_X as [[number, number], [number, number]];
    expect(a1 - a0).toBe(b1 - b0);
    expect(PIN_TIP_OFFSET_PX).toBeGreaterThan(0);
  });

  it("mirrors control corners in RTL", () => {
    expect(controlPosition("top-end", "ltr")).toBe("top-right");
    expect(controlPosition("top-end", "rtl")).toBe("top-left");
    expect(controlPosition("bottom-start", "rtl")).toBe("bottom-right");
  });
});
