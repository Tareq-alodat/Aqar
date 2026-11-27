import type { ListingType } from "~/shared/constants";

/**
 * Price pin images (SPEC §5.2): a rounded pill per listing type, stretched by
 * MapLibre around the price text (`icon-text-fit: both`). Colours come from
 * the theme tokens (CSS variables from app.css), not hard-coded values.
 */

export const PIN_PREFIX = "aqar-pin-";

/** Theme token per listing type: sale gold, rent teal, exchange purple. */
const TYPE_TOKENS: Record<ListingType, string> = {
  sale: "--color-primary",
  rent: "--color-success",
  exchange: "--color-exchange",
};

export type PinVariant = "plain" | "featured" | "active";

export const pinImageId = (type: ListingType, variant: PinVariant) => `${PIN_PREFIX}${type}-${variant}`;

/** Image expression for the pins layer: type × featured. */
export const PIN_IMAGE_EXPRESSION = [
  "concat",
  PIN_PREFIX,
  ["get", "listing_type"],
  ["case", ["get", "is_featured"], "-featured", "-plain"],
] as const;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
}

/** Logical size of the unstretched pill (px); drawn at devicePixelRatio for sharp edges. */
const H = 24;
const W = 32;
const R = H / 2;

export interface PinImage {
  data: ImageData;
  options: { pixelRatio: number; stretchX: Array<[number, number]>; stretchY: Array<[number, number]>; content: [number, number, number, number] };
}

/** Draws one pin image, or null when `id` is not one of ours. */
export function makePinImage(id: string): PinImage | null {
  const m = /^aqar-pin-(sale|rent|exchange)-(plain|featured|active)$/.exec(id);
  if (!m) return null;
  const type = m[1] as ListingType;
  const variant = m[2] as PinVariant;
  const pr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const canvas = document.createElement("canvas");
  canvas.width = W * pr;
  canvas.height = H * pr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(pr, pr);

  const fill = token(TYPE_TOKENS[type]);
  const ring = variant === "featured" ? token("--color-foreground") : variant === "active" ? token("--color-on-accent") : null;

  ctx.beginPath();
  ctx.roundRect(1, 1, W - 2, H - 2, R - 1);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ring) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = ring;
    ctx.stroke();
  }

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Stretch only the straight middle; keep the rounded ends; text sits inside `content`.
  const sx: [number, number] = [R * pr, (W - R) * pr];
  const sy: [number, number] = [(H / 2 - 1) * pr, (H / 2 + 1) * pr];
  return {
    data,
    options: { pixelRatio: pr, stretchX: [sx], stretchY: [sy], content: [7 * pr, 4 * pr, (W - 7) * pr, (H - 4) * pr] },
  };
}

/** Text colour on pins (dark on gold/teal/purple in both themes). */
export function pinTextColor(): string {
  return token("--color-on-accent");
}

export function themeColor(
  name: "--color-primary" | "--color-foreground" | "--color-background" | "--color-surface" | "--color-muted" | "--color-on-accent",
): string {
  return token(name);
}
