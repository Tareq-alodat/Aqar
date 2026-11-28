import { z } from "zod";
import { CATEGORIES, LISTING_TYPES, type Category, type ListingType } from "../constants";
import { ACTIVE_COUNTRIES, toCountryCode } from "../countries";
import type { BBox } from "../geo";
import { decodePolyline, encodePolyline, type LngLatPair } from "../polyline";

/**
 * Map search state (SPEC §5.2–5.4). One definition for the URL (`useMapUrlState`),
 * the page loader and `/api/v1/map/*` + `/api/v1/listings`:
 * `?lat=31.95&lng=35.91&z=12&type=sale&cat=apartment&minPrice=50000&beds=2,3&poly=<encoded>`.
 * Text search (§5.6, milestone 4b) adds `q`, `near=lng,lat&radius=` and `in=view`.
 * URLs are parsed leniently (bad values are dropped); the API is strict (400).
 */

export const AMENITIES = ["pool", "parking", "garden", "elevator", "furnished"] as const;
export type Amenity = (typeof AMENITIES)[number];

/** `relevance` applies to text searches only (and is their default). */
export const SORTS = ["newest", "price_asc", "price_desc", "views", "ppsqm_asc", "relevance"] as const;
export type Sort = (typeof SORTS)[number];
export const DEFAULT_SORT: Sort = "newest";

/** Bedroom choices; 5 means "5 or more". */
export const BED_OPTIONS = [1, 2, 3, 4, 5] as const;
export const BEDS_OR_MORE = 5;

export const PAGE_SIZE = 20;
export const POINTS_CAP = 3000;
export const POLYGON_MAX_POINTS = 100;
const MAX_PAGE = 500;

/** Free-text search (§5.6). */
export const Q_MAX_LENGTH = 100;
/** "Near me" radius choices in km; the location is rounded to 3 decimals (~100 m) in the URL and API. */
export const RADII_KM = [1, 2, 5, 10] as const;
export type RadiusKm = (typeof RADII_KM)[number];
export const DEFAULT_RADIUS_KM: RadiusKm = 2;
export const NEAR_DECIMALS = 3;

export interface LngLat {
  lng: number;
  lat: number;
}

export interface SearchFilters {
  type?: ListingType;
  cat?: Category;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  beds?: number[];
  baths?: number;
  amen?: Amenity[];
  maxAge?: number;
  /** Governorate or city id: listings anywhere inside it. */
  area?: number;
}

export interface MapView {
  lat: number;
  lng: number;
  z: number;
}

export interface MapSearchState {
  view?: MapView;
  filters: SearchFilters;
  sort: Sort;
  page: number;
  /** Draw-to-search polygon (closed ring); replaces bbox filtering. */
  poly?: LngLatPair[];
  /** Free text (trimmed, ≤ Q_MAX_LENGTH). Without an area it searches the whole country. */
  q?: string;
  /** "Near me": rounded location; searches within `radius` km. Never together with `poly`. */
  near?: LngLat;
  radius: RadiusKm;
  /** `in=view`: limit a text search to the map view ("Search this area"). */
  inView: boolean;
}

/**
 * Which area a search covers: a drawn polygon, a radius around a point, the
 * whole country (text search) or the map view.
 */
export type SearchScope = "polygon" | "near" | "country" | "view";

export function searchScope(state: Pick<MapSearchState, "poly" | "near" | "q" | "inView">): SearchScope {
  if (state.poly) return "polygon";
  if (state.near) return "near";
  if (state.q && !state.inView) return "country";
  return "view";
}

export const defaultSortFor = (state: Pick<MapSearchState, "q">): Sort => (state.q ? "relevance" : DEFAULT_SORT);

/** Collapses whitespace and drops control characters; empty → undefined. */
export function cleanQuery(raw: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return q === "" ? undefined : q;
}

const roundTo = (n: number, places: number) => Number(n.toFixed(places));
export const roundNear = (p: LngLat): LngLat => ({ lng: roundTo(p.lng, NEAR_DECIMALS), lat: roundTo(p.lat, NEAR_DECIMALS) });

const nearSchema = z
  .string()
  .max(40)
  .transform((s) => s.split(",").map((x) => (x.trim() === "" ? Number.NaN : Number(x))))
  .pipe(z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]))
  .transform(([lng, lat]) => roundNear({ lng, lat }));

const money = z.coerce.number().finite().min(0).max(1e11);
const sqm = z.coerce.number().finite().min(0).max(1e7);
const smallInt = (max: number) => z.coerce.number().int().min(0).max(max);
const csv = z
  .string()
  .max(200)
  .transform((s) => s.split(",").filter(Boolean));

/** Filter fields as URL strings → typed values. */
const FILTER_FIELDS = {
  type: z.enum(LISTING_TYPES),
  cat: z.enum(CATEGORIES),
  minPrice: money,
  maxPrice: money,
  minArea: sqm,
  maxArea: sqm,
  beds: csv
    .transform((xs) => xs.map((x) => (/^\d+$/.test(x) ? Number(x) : Number.NaN)))
    .pipe(z.array(z.number().int().min(0).max(BEDS_OR_MORE)).min(1).max(BED_OPTIONS.length + 1))
    .transform((xs) => [...new Set(xs)].sort((a, b) => a - b)),
  baths: smallInt(10).pipe(z.number().min(1)),
  amen: csv
    .pipe(z.array(z.enum(AMENITIES)).min(1).max(AMENITIES.length))
    .transform((xs) => [...new Set(xs)].sort()),
  maxAge: smallInt(200),
  area: z.coerce.number().int().positive().max(2_147_483_647),
} satisfies Record<keyof SearchFilters, z.ZodType>;

const FILTER_KEYS = Object.keys(FILTER_FIELDS) as Array<keyof SearchFilters>;

const viewSchema = z.object({
  lat: z.coerce.number().finite().min(-85).max(85),
  lng: z.coerce.number().finite().min(-180).max(180),
  z: z.coerce.number().finite().min(0).max(22),
});

type Params = URLSearchParams | Record<string, string | undefined>;
const getParam = (p: Params, key: string): string | undefined => {
  const v = p instanceof URLSearchParams ? p.get(key) : p[key];
  return v === null || v === undefined || v === "" ? undefined : v;
};

/** Ordered min/max: a reversed range is swapped rather than rejected. */
function orderRange(f: SearchFilters, min: "minPrice" | "minArea", max: "maxPrice" | "maxArea") {
  const lo = f[min];
  const hi = f[max];
  if (lo !== undefined && hi !== undefined && lo > hi) {
    f[min] = hi;
    f[max] = lo;
  }
}

export function decodePolygon(value: string): LngLatPair[] | null {
  const points = decodePolyline(value);
  if (!points || points.length < 3) return null;
  const [first, last] = [points[0]!, points[points.length - 1]!];
  const ring = first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
  if (ring.length > POLYGON_MAX_POINTS + 1) return null;
  if (ring.some(([lng, lat]) => Math.abs(lng) > 180 || Math.abs(lat) > 90)) return null;
  return ring;
}

export function encodePolygon(ring: readonly LngLatPair[]): string {
  // The ring is closed on decode; drop the repeated last point to keep URLs short.
  const open = ring.length > 3 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  return encodePolyline(open);
}

export interface ParseResult {
  state: MapSearchState;
  /** Parameters that were present but invalid (strict callers answer 400). */
  invalid: string[];
}

/** Map search state from URL/query parameters. Invalid values are dropped and reported in `invalid`. */
export function parseMapSearch(params: Params): ParseResult {
  const invalid: string[] = [];
  const filters: SearchFilters = {};
  for (const key of FILTER_KEYS) {
    const raw = getParam(params, key);
    if (raw === undefined) continue;
    const parsed = FILTER_FIELDS[key].safeParse(raw);
    if (parsed.success) (filters as Record<string, unknown>)[key] = parsed.data;
    else invalid.push(key);
  }
  orderRange(filters, "minPrice", "maxPrice");
  orderRange(filters, "minArea", "maxArea");

  let view: MapView | undefined;
  const rawView = { lat: getParam(params, "lat"), lng: getParam(params, "lng"), z: getParam(params, "z") };
  if (rawView.lat !== undefined || rawView.lng !== undefined || rawView.z !== undefined) {
    const parsed = viewSchema.safeParse(rawView);
    if (parsed.success) view = parsed.data;
    else invalid.push("view");
  }

  let q: string | undefined;
  const rawQ = getParam(params, "q");
  if (rawQ !== undefined) {
    // Whitespace only means no query; longer than Q_MAX_LENGTH (after collapsing spaces) is invalid.
    const cleaned = rawQ.length <= Q_MAX_LENGTH * 4 ? cleanQuery(rawQ) : undefined;
    if (rawQ.length > Q_MAX_LENGTH * 4 || (cleaned !== undefined && cleaned.length > Q_MAX_LENGTH)) invalid.push("q");
    else q = cleaned;
  }

  let sort: Sort = defaultSortFor({ q });
  const rawSort = getParam(params, "sort");
  if (rawSort !== undefined) {
    const parsed = z.enum(SORTS).safeParse(rawSort);
    // Relevance needs a text query; without one the default order applies.
    if (parsed.success) sort = parsed.data === "relevance" && !q ? DEFAULT_SORT : parsed.data;
    else invalid.push("sort");
  }

  let page = 1;
  const rawPage = getParam(params, "page");
  if (rawPage !== undefined) {
    const parsed = z.coerce.number().int().min(1).max(MAX_PAGE).safeParse(rawPage);
    if (parsed.success) page = parsed.data;
    else invalid.push("page");
  }

  let poly: LngLatPair[] | undefined;
  const rawPoly = getParam(params, "poly");
  if (rawPoly !== undefined) {
    const ring = rawPoly.length <= 4000 ? decodePolygon(rawPoly) : null;
    if (ring) poly = ring;
    else invalid.push("poly");
  }

  let near: LngLat | undefined;
  const rawNear = getParam(params, "near");
  if (rawNear !== undefined) {
    const parsed = nearSchema.safeParse(rawNear);
    // A drawn area and "near me" are mutually exclusive: the polygon wins.
    if (parsed.success && !poly) near = parsed.data;
    else invalid.push("near");
  }

  let radius: RadiusKm = DEFAULT_RADIUS_KM;
  const rawRadius = getParam(params, "radius");
  if (rawRadius !== undefined) {
    const n = /^\d{1,2}$/.test(rawRadius) ? Number(rawRadius) : Number.NaN;
    if ((RADII_KM as readonly number[]).includes(n)) radius = n as RadiusKm;
    else invalid.push("radius");
  }

  let inView = false;
  const rawIn = getParam(params, "in");
  if (rawIn !== undefined) {
    if (rawIn === "view") inView = true;
    else invalid.push("in");
  }

  return { state: { view, filters, sort, page, poly, q, near, radius, inView }, invalid };
}

const round = (n: number, places: number) => Number(n.toFixed(places));

/** URL parameters for a search state, in a stable order (shareable links). */
export function toSearchParams(state: Partial<MapSearchState>): URLSearchParams {
  const out = new URLSearchParams();
  if (state.view) {
    out.set("lat", String(round(state.view.lat, 5)));
    out.set("lng", String(round(state.view.lng, 5)));
    out.set("z", String(round(state.view.z, 2)));
  }
  const f = state.filters ?? {};
  for (const key of FILTER_KEYS) {
    const v = f[key];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    out.set(key, Array.isArray(v) ? v.join(",") : String(v));
  }
  if (state.q) out.set("q", state.q);
  if (state.sort && state.sort !== defaultSortFor(state) && (state.sort !== "relevance" || state.q)) out.set("sort", state.sort);
  if (state.page && state.page > 1) out.set("page", String(state.page));
  if (state.poly) out.set("poly", encodePolygon(state.poly));
  if (state.near && !state.poly) {
    const p = roundNear(state.near);
    out.set("near", `${p.lng},${p.lat}`);
    if (state.radius && state.radius !== DEFAULT_RADIUS_KM) out.set("radius", String(state.radius));
  }
  if (state.inView && state.q && !state.poly && !state.near) out.set("in", "view");
  return out;
}

/** Number of active filters (for the mobile "Filters (3)" button). */
export function countFilters(f: SearchFilters): number {
  return FILTER_KEYS.filter((k) => f[k] !== undefined && !(Array.isArray(f[k]) && (f[k] as unknown[]).length === 0)).length;
}

export const ACTIVE_COUNTRY_CODES = ACTIVE_COUNTRIES.map(toCountryCode) as [string, ...string[]];
export const countryCodeSchema = z.enum(ACTIVE_COUNTRY_CODES);

/** `minLng,minLat,maxLng,maxLat` */
export const bboxSchema = z
  .string()
  .max(100)
  .transform((s) => s.split(",").map(Number))
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .refine(([minLng, minLat, maxLng, maxLat]) => minLng < maxLng && minLat < maxLat, "empty bbox")
  .transform((b) => b as BBox);

/** GeoJSON polygon body for POST /map/points (one ring, closed, ≤ POLYGON_MAX_POINTS corners). */
export const polygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z
      .array(z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(4).max(POLYGON_MAX_POINTS + 1))
      .length(1),
  })
  .refine(({ coordinates: [ring] }) => {
    const first = ring![0]!;
    const last = ring!.at(-1)!;
    return first[0] === last[0] && first[1] === last[1];
  }, "ring must be closed");
