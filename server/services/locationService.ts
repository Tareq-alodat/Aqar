import { randomInt } from "node:crypto";
import type { Knex } from "knex";

/**
 * Location privacy and pin → area lookup (SPEC §2.2, §4.3, CLAUDE.md rule 2).
 * `point` is the true pin (admin-only); `display_point` is what the public sees.
 */

export interface LngLat {
  lng: number;
  lat: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
export const APPROXIMATE_MIN_M = 150;
export const APPROXIMATE_MAX_M = 300;
/** SPEC §2.2 fallback: nearest area centroid within this distance. */
export const NEAREST_AREA_MAX_M = 5_000;

/** randomInt requires max - min < 2^48. */
const RANDOM_RANGE = 2 ** 48 - 1;

/** Cryptographically random number in [0, 1). */
export function secureRandom(): number {
  return randomInt(0, RANDOM_RANGE) / RANDOM_RANGE;
}

/**
 * The public point for a listing: the pin moved 150–300 m in a random
 * direction. Every listing is public as an approximate area (milestone 6
 * decision). Call once when the pin is saved and store the result — never
 * per request (averaging repeated offsets would reveal the true point).
 */
export function computeDisplayPoint(point: LngLat, random: () => number = secureRandom): LngLat {
  const bearing = random() * 2 * Math.PI;
  const distance = APPROXIMATE_MIN_M + random() * (APPROXIMATE_MAX_M - APPROXIMATE_MIN_M);
  return destination(point, bearing, distance);
}

/** Great-circle destination from `start` along `bearing` (radians) for `distanceM` metres. */
export function destination(start: LngLat, bearing: number, distanceM: number): LngLat {
  const δ = distanceM / EARTH_RADIUS_M;
  const φ1 = toRad(start.lat);
  const λ1 = toRad(start.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing));
  const λ2 = λ1 + Math.atan2(Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lng: ((toDeg(λ2) + 540) % 360) - 180, lat: toDeg(φ2) };
}

/** Haversine distance in metres. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lng - a.lng);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export interface AreaMatch {
  areaId: number;
  /** True when the pin was outside every boundary and the nearest area (≤ 5 km) was used. */
  needsLocationReview: boolean;
}

/**
 * Deepest active area whose boundary covers the point (depth = the level's
 * position in the country's address settings). Falls back to the nearest
 * area centroid within 5 km, flagged for review; null if nothing is that close.
 */
export async function findAdminAreaForPoint(db: Knex, countryCode: string, point: LngLat): Promise<AreaMatch | null> {
  const covering = await db.raw<{ rows: Array<{ id: number }> }>(
    `SELECT a.id
       FROM admin_areas a
       JOIN country_address_fields f ON f.country_code = a.country_code AND f.field_key = a.level
      WHERE a.country_code = ? AND a.is_active
        AND ST_Covers(a.boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography)
      ORDER BY f.position DESC, ST_Area(a.boundary) ASC
      LIMIT 1`,
    [countryCode, point.lng, point.lat],
  );
  const hit = covering.rows[0];
  if (hit) return { areaId: hit.id, needsLocationReview: false };

  const nearest = await db.raw<{ rows: Array<{ id: number }> }>(
    `SELECT a.id
       FROM admin_areas a
      WHERE a.country_code = ? AND a.is_active
        AND ST_DWithin(a.centroid, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
      ORDER BY ST_Distance(a.centroid, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography)
      LIMIT 1`,
    [countryCode, point.lng, point.lat, NEAREST_AREA_MAX_M, point.lng, point.lat],
  );
  const near = nearest.rows[0];
  return near ? { areaId: near.id, needsLocationReview: true } : null;
}

export interface AreaPathItem {
  id: number;
  level: string;
  name_ar: string;
  name_en: string;
  slug: string;
}

/** Full path from the top level down to `areaId` (e.g. governorate › city › area). */
export async function getAreaPath(db: Knex, areaId: number): Promise<AreaPathItem[]> {
  const result = await db.raw<{ rows: AreaPathItem[] }>(
    `WITH RECURSIVE path AS (
       SELECT id, parent_id, level, name_ar, name_en, slug, 0 AS depth FROM admin_areas WHERE id = ?
       UNION ALL
       SELECT a.id, a.parent_id, a.level, a.name_ar, a.name_en, a.slug, p.depth + 1
         FROM admin_areas a JOIN path p ON a.id = p.parent_id
     )
     SELECT id, level, name_ar, name_en, slug FROM path ORDER BY depth DESC`,
    [areaId],
  );
  return result.rows;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
