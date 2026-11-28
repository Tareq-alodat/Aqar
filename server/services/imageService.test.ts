import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, MAX_INPUT_PIXELS, processImage } from "./imageService";

/** A solid image in a format, optionally with EXIF (orientation, GPS). */
async function fixture(
  format: "jpeg" | "png" | "webp" | "gif" | "tiff",
  width: number,
  height: number,
  meta?: { orientation: number; exif: Record<string, Record<string, string>> },
) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 120, g: 60, b: 70 } } });
  if (meta) img = img.withMetadata({ orientation: meta.orientation }).withExifMerge(meta.exif);
  return img.toFormat(format).toBuffer();
}

const code = async (input: Buffer) => {
  try {
    await processImage(input);
    return "ok";
  } catch (e) {
    return e instanceof ImageError ? e.code : "other";
  }
};

describe("processImage", () => {
  it("re-encodes JPEG, PNG and WebP to WebP (≤ 2000 px) with a 400 px thumbnail", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const out = await processImage(await fixture(format, 3000, 1500));
      expect(out.full).toMatchObject({ width: 2000, height: 1000 });
      expect(out.thumb).toMatchObject({ width: 400, height: 200 });
      expect((await sharp(out.full.data).metadata()).format).toBe("webp");
      expect((await sharp(out.thumb.data).metadata()).format).toBe("webp");
    }
  });

  it("does not enlarge small photos", async () => {
    const out = await processImage(await fixture("jpeg", 640, 480));
    expect(out.full).toMatchObject({ width: 640, height: 480 });
    expect(out.thumb).toMatchObject({ width: 400, height: 300 });
  });

  it("removes EXIF including GPS, after applying the orientation", async () => {
    const input = await fixture("jpeg", 800, 400, {
      orientation: 6,
      exif: {
        IFD0: { Make: "PhoneCo" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "31/1 57/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "35/1 53/1 0/1" },
      },
    });
    expect(input.includes(Buffer.from("PhoneCo"))).toBe(true);
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const out = await processImage(input);
    const after = await sharp(out.full.data).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    // Rotated by 90° per orientation 6: 800×400 becomes 400×800.
    expect(out.full).toMatchObject({ width: 400, height: 800 });
    expect(out.full.data.includes(Buffer.from("PhoneCo"))).toBe(false);
    expect((await sharp(out.thumb.data).metadata()).exif).toBeUndefined();
  });

  it("detects the format from the content, not the name: refuses GIF, TIFF, SVG and non-images", async () => {
    expect(await code(await fixture("gif", 50, 50))).toBe("unsupported");
    expect(await code(await fixture("tiff", 50, 50))).toBe("unsupported");
    expect(await code(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'))).toBe("unsupported");
    expect(await code(Buffer.from("this is not an image, even if it is called photo.jpg"))).toBe("invalid");
    expect(await code(Buffer.alloc(0))).toBe("invalid");
  });

  it("refuses files over 10 MB and images over the pixel limit (decompression bombs)", async () => {
    expect(await code(Buffer.alloc(10 * 1024 * 1024 + 1))).toBe("too_large");
    // 8000 × 8000 = 64 MP of one colour: a few kilobytes as PNG.
    const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#000" } }).png().toBuffer();
    expect(8000 * 8000).toBeGreaterThan(MAX_INPUT_PIXELS);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(["too_large", "invalid"]).toContain(await code(bomb));
  });
});
