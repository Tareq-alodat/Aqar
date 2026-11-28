import type { ExpressionSpecification } from "maplibre-gl";
import type { ListingType } from "~/shared/constants";

/**
 * Price pin images (SPEC §5.2): a rounded pill per listing type, stretched by
 * MapLibre around the price text (`icon-text-fit: both`). Colours come from
 * the theme tokens (CSS variables from app.css), not hard-coded values.
 */

export const PIN_PREFIX = "aqar-pin-";

/** Theme token per listing type (SPEC §14, design v2): sale burgundy, rent blue, exchange amber. */
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

/**
 * Callout geometry (logical px; drawn at devicePixelRatio for sharp edges):
 * a pill with a pointer tail below its centre. MapLibre stretches the pill
 * around the price text (`icon-text-fit: both`) but never the tail or the
 * rounded ends, so the tail stays centred and keeps its size.
 */
// Wide enough for a stretch zone on each side of the tail: PW ≥ PH + 2 × (TAIL_HALF + 1) + 2 × (zone ≥ 6 px).
const PW = 54; // pill width before stretching (also the narrowest pin)
const PH = 26; // pill height
const TAIL = 6; // tail height below the pill
const TAIL_HALF = 6; // half of the tail's base width
const PAD = 4; // room for the featured ring and the shadow
const W = PW + 2 * PAD;
const H = PAD + PH + TAIL + PAD;
const CX = W / 2;
/** From the bottom of the text box (content) to the tip of the tail: the symbol is lifted by this much (px). */
export const PIN_TIP_OFFSET_PX = TAIL + 4;

export interface PinImage {
  data: ImageData;
  options: { pixelRatio: number; stretchX: Array<[number, number]>; stretchY: Array<[number, number]>; content: [number, number, number, number] };
}

/** Pill + tail path, grown (negative inset) or shrunk (positive inset) by `inset` px. */
function callout(ctx: CanvasRenderingContext2D, inset: number) {
  const x = PAD + inset;
  const y = PAD + inset;
  const w = PW - 2 * inset;
  const h = PH - 2 * inset;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  const base = PAD + PH - inset - 0.5;
  ctx.moveTo(CX - TAIL_HALF + inset * 0.6, base);
  ctx.lineTo(CX, PAD + PH + TAIL - inset * 1.6);
  ctx.lineTo(CX + TAIL_HALF - inset * 0.6, base);
  ctx.closePath();
}

/** Stretch zones either side of the tail (logical px); both must have positive width, or MapLibre drops the image. */
export const PIN_STRETCH_X: Array<[number, number]> = [
  [PAD + PH / 2, CX - TAIL_HALF - 1],
  [CX + TAIL_HALF + 1, W - PAD - PH / 2],
];

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

  // Featured listings: an amber ring around the white outline.
  if (variant === "featured") {
    callout(ctx, -2);
    ctx.fillStyle = token("--color-accent");
    ctx.fill();
  }
  // White outline (2 px) with a soft shadow; stronger for the hovered/selected pin.
  ctx.save();
  ctx.shadowColor = variant === "active" ? "rgba(16, 24, 40, 0.38)" : "rgba(16, 24, 40, 0.25)";
  ctx.shadowBlur = variant === "active" ? 5 : 3;
  ctx.shadowOffsetY = 1;
  callout(ctx, 0);
  ctx.fillStyle = token("--color-pin-outline");
  ctx.fill();
  ctx.restore();
  // The coloured callout inside the outline.
  callout(ctx, 2);
  ctx.fillStyle = token(TYPE_TOKENS[type]);
  ctx.fill();

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = (v: number) => v * pr;
  return {
    data,
    options: {
      pixelRatio: pr,
      // Two equal stretch zones either side of the tail keep it centred.
      stretchX: PIN_STRETCH_X.map(([a, b]) => [px(a), px(b)] as [number, number]),
      stretchY: [[px(PAD + PH / 2 - 1), px(PAD + PH / 2 + 1)]],
      content: [px(PAD + 8), px(PAD + 4), px(W - PAD - 8), px(PAD + PH - 4)],
    },
  };
}

/** Label colour per listing type: white on sale and rent, dark ink on the amber exchange pin. */
export function pinTextColor(): ExpressionSpecification {
  return ["match", ["get", "listing_type"], "exchange", token("--color-on-accent"), token("--color-on-primary")];
}

export function themeColor(
  name:
    | "--color-primary"
    | "--color-primary-hover"
    | "--color-primary-text"
    | "--color-foreground"
    | "--color-background"
    | "--color-surface"
    | "--color-muted"
    | "--color-on-primary"
    | "--color-accent"
    | "--color-sale"
    | "--color-map-water"
    | "--color-map-green",
): string {
  return token(name);
}
