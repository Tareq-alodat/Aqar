import type { Knex } from "knex";
import type { BBox } from "../../app/shared/geo";

/**
 * Admin areas for the map (SPEC §2.2, §5.2): which levels exist and from
 * which zoom they show (`country_address_fields.map_min_zoom`), simplified
 * outlines per level, the jump-to tree and the address path at a point.
 */

export interface AreaLevel {
  level: string;
  position: number;
  minZoom: number;
}

export interface AreaSummary {
  id: number;
  parentId: number | null;
  level: string;
  nameAr: string;
  nameEn: string;
  bbox: BBox;
}

export interface OutlineCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: number;
    geometry: unknown;
    properties: {
      id: number;
      parent_id: number | null;
      level: string;
      name_ar: string;
      name_en: string;
      /** Label anchor (point on surface). */
      label: [number, number];
      bbox: BBox;
    };
  }>;
}

const BBOX_SQL = (col: string) =>
  `ST_XMin(${col}::geometry) AS min_lng, ST_YMin(${col}::geometry) AS min_lat, ST_XMax(${col}::geometry) AS max_lng, ST_YMax(${col}::geometry) AS max_lat`;

type BBoxRow = { min_lng: number; min_lat: number; max_lng: number; max_lat: number };
const toBBox = (r: BBoxRow): BBox => [r.min_lng, r.min_lat, r.max_lng, r.max_lat].map((v) => Number(Number(v).toFixed(5))) as BBox;

export async function getAreaLevels(db: Knex, countryCode: string): Promise<AreaLevel[]> {
  const rows = await db("country_address_fields as c")
    .join("address_fields as f", "f.key", "c.field_key")
    .where({ "c.country_code": countryCode, "f.kind": "admin_area", "c.is_active": true })
    .orderBy("c.position")
    .select("c.field_key", "c.position", "c.map_min_zoom");
  return rows.map((r) => ({ level: r.field_key, position: r.position, minZoom: r.map_min_zoom ?? 0 }));
}

/** Simplification tolerance in degrees: half a pixel two zoom levels after the level appears. */
export function toleranceFor(minZoom: number): number {
  return 360 / (512 * 2 ** (minZoom + 2)) / 2;
}

const OUTLINE_TTL_MS = 60 * 60 * 1000;
const outlineCache = new Map<string, { at: number; value: OutlineCollection }>();

/** Outlines of one level, simplified for display and cached (boundaries change only on re-import). */
export async function getOutlines(db: Knex, countryCode: string, level: string): Promise<OutlineCollection | null> {
  const key = `${countryCode}:${level}`;
  const hit = outlineCache.get(key);
  if (hit && Date.now() - hit.at < OUTLINE_TTL_MS) return hit.value;

  const levels = await getAreaLevels(db, countryCode);
  const lv = levels.find((l) => l.level === level);
  if (!lv) return null;

  const rows = await db.raw<{
    rows: Array<BBoxRow & { id: number; parent_id: number | null; name_ar: string; name_en: string; geom: string; lng: number; lat: number }>;
  }>(
    `SELECT id, parent_id, name_ar, name_en,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(boundary::geometry, ?), 5) AS geom,
            ST_X(centroid::geometry) AS lng, ST_Y(centroid::geometry) AS lat,
            ${BBOX_SQL("boundary")}
       FROM admin_areas
      WHERE country_code = ? AND level = ? AND is_active
      ORDER BY id`,
    [toleranceFor(lv.minZoom), countryCode, level],
  );

  const value: OutlineCollection = {
    type: "FeatureCollection",
    features: rows.rows.map((r) => ({
      type: "Feature",
      id: r.id,
      geometry: JSON.parse(r.geom),
      properties: {
        id: r.id,
        parent_id: r.parent_id,
        level,
        name_ar: r.name_ar,
        name_en: r.name_en,
        label: [Number(Number(r.lng).toFixed(5)), Number(Number(r.lat).toFixed(5))],
        bbox: toBBox(r),
      },
    })),
  };
  outlineCache.set(key, { at: Date.now(), value });
  return value;
}

/** For tests and after a boundary re-import. */
export function clearOutlineCache() {
  outlineCache.clear();
}

/** Areas of the first two levels (Jordan: governorates and cities) for the jump-to dropdowns. */
export async function getAreaTree(db: Knex, countryCode: string): Promise<{ levels: AreaLevel[]; areas: AreaSummary[] }> {
  const levels = await getAreaLevels(db, countryCode);
  const jumpLevels = levels.slice(0, 2).map((l) => l.level);
  if (jumpLevels.length === 0) return { levels, areas: [] };
  const rows = await db("admin_areas")
    .where({ country_code: countryCode, is_active: true })
    .whereIn("level", jumpLevels)
    .select("id", "parent_id", "level", "name_ar", "name_en", db.raw(BBOX_SQL("boundary")));
  return {
    levels,
    areas: rows.map((r) => ({ id: r.id, parentId: r.parent_id, level: r.level, nameAr: r.name_ar, nameEn: r.name_en, bbox: toBBox(r) })),
  };
}

/**
 * Address path for the map centre (SPEC §5.2 drill-down): the deepest area
 * containing the point among the levels visible at `zoom`, then its parents.
 */
export async function getPathAt(
  db: Knex,
  countryCode: string,
  point: { lng: number; lat: number },
  zoom: number,
): Promise<AreaSummary[]> {
  const levels = (await getAreaLevels(db, countryCode)).filter((l) => l.minZoom <= zoom).map((l) => l.level);
  if (levels.length === 0) return [];
  const result = await db.raw<{ rows: Array<BBoxRow & { id: number; parent_id: number | null; level: string; name_ar: string; name_en: string }> }>(
    `WITH RECURSIVE hit AS (
       SELECT a.id FROM admin_areas a
         JOIN country_address_fields f ON f.country_code = a.country_code AND f.field_key = a.level
        WHERE a.country_code = ? AND a.is_active AND a.level = ANY(?)
          AND ST_Covers(a.boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography)
        ORDER BY f.position DESC, ST_Area(a.boundary) ASC
        LIMIT 1
     ), path AS (
       SELECT a.id, a.parent_id, a.level, a.name_ar, a.name_en, a.boundary, 0 AS depth FROM admin_areas a JOIN hit ON hit.id = a.id
       UNION ALL
       SELECT a.id, a.parent_id, a.level, a.name_ar, a.name_en, a.boundary, p.depth + 1
         FROM admin_areas a JOIN path p ON a.id = p.parent_id
     )
     SELECT id, parent_id, level, name_ar, name_en, ${BBOX_SQL("boundary")} FROM path ORDER BY depth DESC`,
    [countryCode, levels, point.lng, point.lat],
  );
  return result.rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    level: r.level,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    bbox: toBBox(r),
  }));
}

export interface AreaSuggestion extends AreaSummary {
  /** Ancestors, nearest first (e.g. Abdoun → Amman city → Amman governorate), for "عبدون، عمان". */
  parents: Array<{ nameAr: string; nameEn: string }>;
}

export const SUGGEST_LIMIT = 8;

/**
 * Location autocomplete (SPEC §5.6): areas of every level whose normalized
 * Arabic or English name contains the query or is similar to it (pg_trgm),
 * best first: the name starting with the query, then a word of it, then
 * similarity, then higher levels and shorter names.
 */
export async function suggestAreas(db: Knex, countryCode: string, query: string): Promise<AreaSuggestion[]> {
  const hits = await db.raw<{ rows: Array<BBoxRow & { id: number; parent_id: number | null; level: string; name_ar: string; name_en: string }> }>(
    `SELECT a.id, a.parent_id, a.level, a.name_ar, a.name_en, ${BBOX_SQL("a.boundary")}
       FROM admin_areas a
       JOIN country_address_fields f ON f.country_code = a.country_code AND f.field_key = a.level
      CROSS JOIN (SELECT aqar_normalize_ar(?) AS nq) s
      WHERE a.country_code = ? AND a.is_active AND f.is_active
        AND (strpos(a.search_norm, s.nq) > 0 OR s.nq <% a.search_norm)
      ORDER BY strpos(a.search_norm, s.nq) = 1 DESC,
               strpos(' ' || a.search_norm, ' ' || s.nq) > 0 DESC,
               word_similarity(s.nq, a.search_norm) DESC,
               f.position, length(a.name_ar), a.name_ar, a.id
      LIMIT ?`,
    [query, countryCode, SUGGEST_LIMIT],
  );
  if (hits.rows.length === 0) return [];

  const ancestors = await db.raw<{ rows: Array<{ hit_id: number; name_ar: string; name_en: string; depth: number }> }>(
    `WITH RECURSIVE up AS (
       SELECT h.id AS hit_id, a.id, a.parent_id, a.name_ar, a.name_en, 1 AS depth
         FROM admin_areas h JOIN admin_areas a ON a.id = h.parent_id
        WHERE h.id = ANY(?)
       UNION ALL
       SELECT up.hit_id, a.id, a.parent_id, a.name_ar, a.name_en, up.depth + 1
         FROM up JOIN admin_areas a ON a.id = up.parent_id
        WHERE up.depth < 10
     )
     SELECT hit_id, name_ar, name_en, depth FROM up ORDER BY hit_id, depth`,
    [hits.rows.map((r) => r.id)],
  );
  const parentsOf = new Map<number, AreaSuggestion["parents"]>();
  for (const a of ancestors.rows) {
    const list = parentsOf.get(a.hit_id) ?? [];
    list.push({ nameAr: a.name_ar, nameEn: a.name_en });
    parentsOf.set(a.hit_id, list);
  }

  return hits.rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    level: r.level,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    bbox: toBBox(r),
    parents: parentsOf.get(r.id) ?? [],
  }));
}
