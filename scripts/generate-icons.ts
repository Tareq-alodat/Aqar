/**
 * Generates the site icons from public/brand/aqar-favicon.svg (SPEC §14):
 *   public/favicon.ico          16, 32, 48 px (PNG images inside an ICO container)
 *   public/apple-touch-icon.png 180 px, opaque (iOS ignores transparency)
 *   public/icon-192.png, icon-512.png
 *   public/site.webmanifest     names and brand colours
 *
 * Run with `npm run icons` after changing the brand SVG; the outputs are committed.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BRAND, BRAND_ICONS } from "../app/shared/brand";

const PUBLIC = path.resolve(import.meta.dirname, "..", "public");
const SOURCE = path.join(PUBLIC, "brand", "aqar-favicon.svg");

/** Renders the SVG at `size` px. `background` flattens transparent corners (apple-touch-icon). */
async function png(svg: Buffer, size: number, background?: string): Promise<Buffer> {
  // Render at a high density so small sizes are downscaled from a sharp raster.
  let img = sharp(svg, { density: Math.max(72, Math.ceil((72 * size) / 120) * 4) }).resize(size, size);
  if (background) img = img.flatten({ background });
  return img.png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container with PNG-encoded images (supported by all current browsers and Windows Vista+). */
export function buildIco(images: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  const svg = await readFile(SOURCE);
  const icoSizes = [16, 32, 48];
  const ico = buildIco(await Promise.all(icoSizes.map(async (size) => ({ size, data: await png(svg, size) }))));
  await writeFile(path.join(PUBLIC, "favicon.ico"), ico);
  await writeFile(path.join(PUBLIC, "apple-touch-icon.png"), await png(svg, 180, BRAND.themeColor.light));
  await writeFile(path.join(PUBLIC, "icon-192.png"), await png(svg, 192));
  await writeFile(path.join(PUBLIC, "icon-512.png"), await png(svg, 512));

  const manifest = {
    name: BRAND.name,
    short_name: BRAND.shortName,
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND.themeColor.light,
    theme_color: BRAND.primary,
    icons: [
      { src: BRAND_ICONS.svg, sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  await writeFile(path.join(PUBLIC, "site.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("Icons written to public/: favicon.ico (16/32/48), apple-touch-icon.png, icon-192.png, icon-512.png, site.webmanifest");
}

// Only when run as a script (the tests import buildIco).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
