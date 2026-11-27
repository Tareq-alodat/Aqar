import type { Knex } from "knex";
import type { Category, ListingType, RentPeriod } from "../../app/shared/constants";
import type { BBox } from "../../app/shared/geo";
import type { Locale } from "../../app/shared/locales";
import type { LngLatPair } from "../../app/shared/polyline";
import { BEDS_OR_MORE, PAGE_SIZE, POINTS_CAP, type SearchFilters, type Sort } from "../../app/shared/schemas/mapSearch";

/**
 * Map search (SPEC §5.4). Public: published listings only, `display_point`
 * only (never `point`), explicit output fields (no phone, address or
 * identifiers — CLAUDE.md rules 1–2).
 */

export type SearchArea = { kind: "bbox"; bbox: BBox } | { kind: "polygon"; ring: LngLatPair[] };

export interface PointProperties {
  id: number;
  price: number | null;
  currency: string;
  listing_type: ListingType;
  rent_period: RentPeriod | null;
  category: Category;
  is_featured: boolean;
}

export interface PointsResult {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: number;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: PointProperties;
  }>;
  truncated: boolean;
}

export interface ListingCard {
  id: number;
  title: string;
  price: number | null;
  currency: string;
  listingType: ListingType;
  rentPeriod: RentPeriod | null;
  category: Category;
  areaName: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  isFeatured: boolean;
  thumbnailUrl: string | null;
}

export interface ListingsResult {
  items: ListingCard[];
  total: number;
  page: number;
  pageSize: number;
}

export class InvalidPolygonError extends Error {
  constructor() {
    super("invalid polygon");
  }
}

const polygonJson = (ring: LngLatPair[]) => JSON.stringify({ type: "Polygon", coordinates: [ring] });

/** Self-intersecting or degenerate polygons are refused (400) rather than guessed at. */
export async function assertValidPolygon(db: Knex, ring: LngLatPair[]): Promise<void> {
  const r = await db.raw<{ rows: Array<{ ok: boolean }> }>(
    "SELECT ST_IsValid(g) AND ST_Area(g) > 0 AS ok FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(?), 4326) AS g) s",
    [polygonJson(ring)],
  );
  if (!r.rows[0]?.ok) throw new InvalidPolygonError();
}

function applySearch(q: Knex.QueryBuilder, countryCode: string, area: SearchArea, f: SearchFilters) {
  q.where("p.country_code", countryCode).where("p.status", "published");

  if (area.kind === "bbox") {
    const [minLng, minLat, maxLng, maxLat] = area.bbox;
    q.whereRaw("ST_Intersects(p.display_point, ST_MakeEnvelope(?, ?, ?, ?, 4326)::geography)", [minLng, minLat, maxLng, maxLat]);
  } else {
    q.whereRaw("ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)::geography, p.display_point)", [polygonJson(area.ring)]);
  }

  if (f.type) q.where("p.listing_type", f.type);
  if (f.cat) q.where("p.category", f.cat);
  if (f.minPrice !== undefined) q.where("p.price", ">=", f.minPrice);
  if (f.maxPrice !== undefined) q.where("p.price", "<=", f.maxPrice);
  if (f.minArea !== undefined) q.where("p.area_sqm", ">=", f.minArea);
  if (f.maxArea !== undefined) q.where("p.area_sqm", "<=", f.maxArea);
  if (f.beds?.length) {
    const exact = f.beds.filter((b) => b < BEDS_OR_MORE);
    const orMore = f.beds.includes(BEDS_OR_MORE);
    q.where((w) => {
      if (exact.length) w.orWhereIn("p.bedrooms", exact);
      if (orMore) w.orWhere("p.bedrooms", ">=", BEDS_OR_MORE);
    });
  }
  if (f.baths !== undefined) q.where("p.bathrooms", ">=", f.baths);
  for (const a of f.amen ?? []) {
    if (a === "furnished") q.whereIn("p.furnished", ["yes", "partial"]);
    else q.where(`p.${a}`, true);
  }
  if (f.maxAge !== undefined) q.where("p.age_years", "<=", f.maxAge);
  if (f.area !== undefined) {
    q.whereRaw(
      `p.admin_area_id IN (
         WITH RECURSIVE d AS (
           SELECT id FROM admin_areas WHERE id = ?
           UNION ALL SELECT a.id FROM admin_areas a JOIN d ON a.parent_id = d.id
         ) SELECT id FROM d)`,
      [f.area],
    );
  }
  return q;
}

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

/** Raw rows (numeric columns arrive as strings from pg). */
interface PointRow {
  id: number;
  price: string | null;
  currency: string;
  listing_type: ListingType;
  rent_period: RentPeriod | null;
  category: Category;
  is_featured: boolean;
  lng: number;
  lat: number;
}

interface CardRow {
  id: number;
  title_ar: string | null;
  title_en: string | null;
  price: string | null;
  currency: string;
  listing_type: ListingType;
  rent_period: RentPeriod | null;
  category: Category;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: string | null;
  is_featured: boolean;
  area_name_ar: string | null;
  area_name_en: string | null;
  thumbnail_url: string | null;
}

/** Pins for the map: GeoJSON of display points, at most POINTS_CAP (`truncated` when there are more). */
export async function searchPoints(db: Knex, countryCode: string, area: SearchArea, filters: SearchFilters): Promise<PointsResult> {
  const rows: PointRow[] = await applySearch(db("properties as p"), countryCode, area, filters)
    .select(
      "p.id",
      "p.price",
      "p.currency",
      "p.listing_type",
      "p.rent_period",
      "p.category",
      "p.is_featured",
      db.raw("ST_X(p.display_point::geometry) AS lng"),
      db.raw("ST_Y(p.display_point::geometry) AS lat"),
    )
    .orderBy([
      { column: "p.is_featured", order: "desc" },
      { column: "p.published_at", order: "desc" },
      { column: "p.id", order: "desc" },
    ])
    .limit(POINTS_CAP + 1);

  const truncated = rows.length > POINTS_CAP;
  return {
    type: "FeatureCollection",
    truncated,
    features: rows.slice(0, POINTS_CAP).map((r) => ({
      type: "Feature" as const,
      id: r.id as number,
      geometry: { type: "Point" as const, coordinates: [Number(Number(r.lng).toFixed(6)), Number(Number(r.lat).toFixed(6))] },
      properties: {
        id: r.id as number,
        price: num(r.price),
        currency: (r.currency as string).trim(),
        listing_type: r.listing_type as ListingType,
        rent_period: (r.rent_period as RentPeriod | null) ?? null,
        category: r.category as Category,
        is_featured: Boolean(r.is_featured),
      },
    })),
  };
}

const ORDER: Record<Sort, Array<{ column: string; order: "asc" | "desc"; nulls?: "first" | "last" } | string>> = {
  newest: [{ column: "p.published_at", order: "desc" }],
  price_asc: [{ column: "p.price", order: "asc", nulls: "last" }],
  price_desc: [{ column: "p.price", order: "desc", nulls: "last" }],
  views: [{ column: "p.view_count", order: "desc" }],
  ppsqm_asc: [{ column: "price_per_sqm", order: "asc", nulls: "last" }],
};

/** Result cards for the list (title and area name in `locale`, falling back to the other language). */
export async function searchListings(
  db: Knex,
  countryCode: string,
  area: SearchArea,
  filters: SearchFilters,
  sort: Sort,
  page: number,
  locale: Locale,
): Promise<ListingsResult> {
  const base = applySearch(db("properties as p"), countryCode, area, filters);
  const countRow = await base.clone().count({ n: "*" }).first();
  const total = Number(countRow?.n ?? 0);

  const rows: CardRow[] = await base
    .leftJoin("admin_areas as a", "a.id", "p.admin_area_id")
    .select(
      "p.id",
      "p.title_ar",
      "p.title_en",
      "p.price",
      "p.currency",
      "p.listing_type",
      "p.rent_period",
      "p.category",
      "p.bedrooms",
      "p.bathrooms",
      "p.area_sqm",
      "p.is_featured",
      "a.name_ar as area_name_ar",
      "a.name_en as area_name_en",
      db.raw("CASE WHEN p.area_sqm > 0 THEN p.price / p.area_sqm END AS price_per_sqm"),
      db.raw(
        "(SELECT i.thumbnail_url FROM property_images i WHERE i.property_id = p.id ORDER BY i.order_index LIMIT 1) AS thumbnail_url",
      ),
    )
    .orderBy([...ORDER[sort], { column: "p.id", order: "desc" }])
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const pick = (ar: string | null, en: string | null) => (locale === "ar" ? (ar ?? en) : (en ?? ar));
  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    items: rows.map((r) => ({
      id: r.id,
      title: pick(r.title_ar, r.title_en) ?? "",
      price: num(r.price),
      currency: (r.currency as string).trim(),
      listingType: r.listing_type,
      rentPeriod: r.rent_period ?? null,
      category: r.category,
      areaName: pick(r.area_name_ar, r.area_name_en),
      bedrooms: r.bedrooms ?? null,
      bathrooms: r.bathrooms ?? null,
      areaSqm: num(r.area_sqm),
      isFeatured: Boolean(r.is_featured),
      thumbnailUrl: r.thumbnail_url ?? null,
    })),
  };
}
