/** Small geometry helpers shared by the map page, loader and API (Web Mercator, 512 px tiles as in MapLibre). */

export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

const TILE = 512;
const MAX_LAT = 85.0511;

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

function project(lng: number, lat: number, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

function unproject(x: number, y: number, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lng, lat];
}

/** Bounds of a viewport of `width`×`height` px centred on lng/lat at `zoom` (used before the map exists, e.g. SSR). */
export function bboxAround(lng: number, lat: number, zoom: number, width: number, height: number): BBox {
  const [cx, cy] = project(lng, lat, zoom);
  const [minLng, maxLat] = unproject(cx - width / 2, cy - height / 2, zoom);
  const [maxLng, minLat] = unproject(cx + width / 2, cy + height / 2, zoom);
  return [Math.max(-180, minLng), clampLat(minLat), Math.min(180, maxLng), clampLat(maxLat)];
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export function pointInBBox(lng: number, lat: number, b: BBox): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Ray-casting point-in-polygon for a single ring of [lng, lat] (client-side filtering of cached points). */
export function pointInRing(lng: number, lat: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
