import { describe, expect, it } from "vitest";
import { bboxAround, bboxContains, viewForBBox, type BBox } from "./geo";

describe("viewForBBox", () => {
  const zarqa: BBox = [35.95, 31.5, 39.3, 32.6];

  it("centres on the box and zooms so it fits inside the padded viewport", () => {
    const v = viewForBBox(zarqa, 860, 760);
    expect(v.lng).toBeCloseTo((35.95 + 39.3) / 2, 1);
    expect(v.lat).toBeGreaterThan(31.5);
    expect(v.lat).toBeLessThan(32.6);
    const shown = bboxAround(v.lng, v.lat, v.z, 860, 760);
    expect(bboxContains(shown, zarqa)).toBe(true);
    // Not much more than needed: one zoom level in would no longer fit.
    expect(bboxContains(bboxAround(v.lng, v.lat, v.z + 1, 860, 760), zarqa)).toBe(false);
  });

  it("caps the zoom for tiny boxes", () => {
    expect(viewForBBox([35.9, 31.95, 35.9001, 31.9501], 860, 760).z).toBe(15);
    expect(viewForBBox([35.9, 31.95, 35.9001, 31.9501], 860, 760, 48, 12).z).toBe(12);
  });
});
