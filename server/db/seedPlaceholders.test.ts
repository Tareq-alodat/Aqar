import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../app/shared/constants";
import { placeholderSvg } from "./seedPlaceholders";

describe("placeholderSvg (dev seed)", () => {
  it("renders a 1200 × 800 image for every category, varying with n", async () => {
    for (const category of CATEGORIES) {
      const a = placeholderSvg(category, 0, `${category} 0`);
      const b = placeholderSvg(category, 1, `${category} 1`);
      expect(a).not.toBe(b);
      expect(a).not.toMatch(/<script|href=|<image/i);
      const meta = await sharp(Buffer.from(a)).metadata();
      expect(meta).toMatchObject({ format: "svg", width: 1200, height: 800 });
    }
  });
});
