import type { ListingType } from "~/shared/constants";

/**
 * Price pin images (SPEC §5.2): a rounded pill per listing type, stretched by
 * MapLibre around the price text (`icon-text-fit: both`). Colours come from
 * the theme tokens (CSS variables from app.css), not hard-coded values.
 */

export const PIN_PREFIX = "aqar-pin-";

/** Theme token per listing type (SPEC §14): sale burgundy, rent slate blue, exchange taupe; white labels. */
const TYPE_TOKENS: Record<ListingType, string> = {
  sale: "--color-sale",
  rent: "--color-rent",
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
const H = 26;
const W = 34;
const R = H / 2;
/** Space kept around the pill for the outline and the featured/active ring. */
const PAD = 2;

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
  // Featured: a ring in the accent colour; active (hovered/selected): a ring in the text colour.
  const ring = variant === "featured" ? token("--color-accent") : variant === "active" ? token("--color-foreground") : null;

  // Outer ring first (full size), then the outline, then the coloured pill inside.
  if (ring) {
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.fillStyle = ring;
    ctx.fill();
  }
  // Light outline: keeps the pill readable on the dark basemap and between overlapping pins.
  ctx.beginPath();
  ctx.roundRect(PAD - 0.5, PAD - 0.5, W - 2 * PAD + 1, H - 2 * PAD + 1, R - PAD + 0.5);
  ctx.fillStyle = token("--color-pin-outline");
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(PAD + 1, PAD + 1, W - 2 * PAD - 2, H - 2 * PAD - 2, R - PAD - 1);
  ctx.fillStyle = fill;
  ctx.fill();

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Stretch only the straight middle; keep the rounded ends; text sits inside `content`.
  const sx: [number, number] = [R * pr, (W - R) * pr];
  const sy: [number, number] = [(H / 2 - 1) * pr, (H / 2 + 1) * pr];
  return {
    data,
    options: { pixelRatio: pr, stretchX: [sx], stretchY: [sy], content: [8 * pr, 5 * pr, (W - 8) * pr, (H - 5) * pr] },
  };
}

/** Text colour on pins: white on the sale/rent/exchange colours in both themes (≥ 6:1). */
export function pinTextColor(): string {
  return token("--color-on-primary");
}

export function themeColor(
  name:
    | "--color-primary"
    | "--color-primary-text"
    | "--color-foreground"
    | "--color-background"
    | "--color-surface"
    | "--color-muted"
    | "--color-on-primary"
    | "--color-accent"
    | "--color-sale",
): string {
  return token(name);
}
