import sharp, { type Metadata } from "sharp";
import { MAX_UPLOAD_BYTES, PHOTO_MAX_EDGE, THUMB_MAX_EDGE, UPLOAD_FORMATS } from "../../app/shared/constants";
import { Semaphore } from "./concurrency";

/**
 * Listing photo pipeline (SPEC §1, §4.4, §13): the format is detected from the
 * file's content (magic bytes, via sharp), not from its name or declared type;
 * only JPEG, PNG and WebP are accepted; the image is rotated per EXIF and
 * re-encoded to WebP (≤ 2000 px) plus a 400 px thumbnail. Re-encoding drops
 * all metadata, including EXIF GPS.
 */

export class ImageError extends Error {
  constructor(readonly code: "too_large" | "unsupported" | "invalid") {
    super(code);
  }
}

/** Decompression-bomb guard: refuse images above 50 megapixels before decoding them. */
export const MAX_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;
const THUMB_QUALITY = 75;

export interface ProcessedImage {
  full: { data: Buffer; width: number; height: number };
  thumb: { data: Buffer; width: number; height: number };
}

/** At most 2 images are decoded at once (memory); others wait. */
const limiter = new Semaphore(2);

export function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MAX_UPLOAD_BYTES) return Promise.reject(new ImageError("too_large"));
  return limiter.run(() => transform(input));
}

async function transform(input: Buffer): Promise<ProcessedImage> {
  // animated: false → only the first frame of an animated WebP/PNG is read, so it becomes a still photo.
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });
  let meta: Metadata;
  try {
    meta = await open().metadata();
  } catch {
    throw new ImageError("invalid");
  }
  if (!meta.format || !(UPLOAD_FORMATS as readonly string[]).includes(meta.format)) throw new ImageError("unsupported");
  if (!meta.width || !meta.height || meta.width * meta.height > MAX_INPUT_PIXELS) throw new ImageError("too_large");

  try {
    // rotate() applies EXIF orientation; no withMetadata(), so nothing (EXIF, GPS, ICC, XMP) is kept.
    const full = await open()
      .rotate()
      .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data)
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      full: { data: full.data, width: full.info.width, height: full.info.height },
      thumb: { data: thumb.data, width: thumb.info.width, height: thumb.info.height },
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError("invalid");
  }
}
