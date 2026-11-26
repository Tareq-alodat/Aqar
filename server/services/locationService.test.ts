import { describe, expect, it } from "vitest";
import { APPROXIMATE_MAX_M, APPROXIMATE_MIN_M, computeDisplayPoint, destination, distanceMeters } from "./locationService";

const abdoun = { lng: 35.8792, lat: 31.9451 };

describe("computeDisplayPoint", () => {
  it("returns the same point for exact precision", () => {
    expect(computeDisplayPoint(abdoun, "exact")).toEqual(abdoun);
  });

  it("moves approximate points 150–300 m", () => {
    for (let i = 0; i < 500; i++) {
      const moved = computeDisplayPoint(abdoun, "approximate");
      const d = distanceMeters(abdoun, moved);
      expect(d).toBeGreaterThanOrEqual(APPROXIMATE_MIN_M - 0.5);
      expect(d).toBeLessThanOrEqual(APPROXIMATE_MAX_M + 0.5);
    }
  });

  it("uses the bounds of the random range", () => {
    expect(distanceMeters(abdoun, computeDisplayPoint(abdoun, "approximate", () => 0))).toBeCloseTo(150, 0);
    expect(distanceMeters(abdoun, computeDisplayPoint(abdoun, "approximate", () => 0.999999))).toBeCloseTo(300, 0);
  });

  it("spreads directions (not always the same bearing)", () => {
    const bearings = new Set(
      Array.from({ length: 50 }, () => {
        const p = computeDisplayPoint(abdoun, "approximate");
        return `${Math.sign(p.lng - abdoun.lng)}${Math.sign(p.lat - abdoun.lat)}`;
      }),
    );
    expect(bearings.size).toBeGreaterThan(1);
  });
});

describe("destination", () => {
  it("goes north for bearing 0", () => {
    const p = destination(abdoun, 0, 1000);
    expect(p.lng).toBeCloseTo(abdoun.lng, 6);
    expect(p.lat).toBeGreaterThan(abdoun.lat);
    expect(distanceMeters(abdoun, p)).toBeCloseTo(1000, 0);
  });

  it("goes east for bearing π/2", () => {
    const p = destination(abdoun, Math.PI / 2, 1000);
    expect(p.lng).toBeGreaterThan(abdoun.lng);
    expect(distanceMeters(abdoun, p)).toBeCloseTo(1000, 0);
  });
});
