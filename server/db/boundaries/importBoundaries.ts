import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Knex } from "knex";
import { z } from "zod";
import { fold, slugify, transliterate } from "./transliterate";

/**
 * Boundary import (SPEC §2.2): reads data/boundaries/{country}/manifest.json
 * and upserts admin_areas in one transaction. Safe to re-run: rows are matched
 * by (country, level, source_ref), so ids and slugs stay stable. Rows with
 * source = 'manual' (drawn by an admin) are never modified, and an English
 * name already marked reviewed is replaced only by a name curated in this
 * repo (manifest overrides, union groups, manual points) — never by an OSM
 * tag or a transliteration.
 */

const METRES_PER_DEGREE = 111_320;
/** UTM zone 36N — metric projection covering Jordan, used for nearest-point cells. */
const METRIC_SRID = 32636;

const level = z.string().regex(/^[a-z][a-z0-9_]*$/);
const file = z.string().regex(/^[\w.-]+\.geojson$/);
const nameOverride = z.object({ name_ar: z.string().min(1).optional(), name_en: z.string().min(1).optional() });

const manifestSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  layers: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("osm"),
        level,
        file,
        simplify_m: z.number().nonnegative(),
        name_overrides: z.record(z.string(), nameOverride).default({}),
      }),
      z.object({
        type: z.literal("union"),
        level,
        file,
        simplify_m: z.number().nonnegative(),
        groups: z.array(
          z.object({
            key: z.string().regex(/^[a-z0-9-]+$/),
            name_ar: z.string().min(1),
            name_en: z.string().min(1),
            osm_ids: z.array(z.number().int()).min(1),
          }),
        ),
      }),
      z.object({
        type: z.literal("cells"),
        level,
        points: z.array(file).min(1),
        polygons: file.optional(),
        clip_to: z.object({ level, source_ref: z.string() }),
        simplify_m: z.number().nonnegative(),
      }),
    ]),
  ),
});
export type BoundaryManifest = z.infer<typeof manifestSchema>;

const featureProps = z.object({
  osm_type: z.enum(["node", "way", "relation", "manual"]),
  osm_id: z.union([z.number().int(), z.string().regex(/^[a-z0-9-]+$/)]),
  name: z.string().nullable().optional(),
  name_ar: z.string().nullable().optional(),
  name_en: z.string().nullable().optional(),
  /** Manual points: whether name_en was checked by a person. */
  name_en_reviewed: z.boolean().optional(),
});
type FeatureProps = z.infer<typeof featureProps>;

const featureCollection = <G extends z.ZodType>(geometry: G) =>
  z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(z.object({ type: z.literal("Feature"), properties: featureProps, geometry })),
  });
const polygonGeometry = z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.array(z.unknown()) });
const pointGeometry = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});

interface Candidate {
  level: string;
  name_ar: string;
  name_en: string;
  name_en_reviewed: boolean;
  /** English name curated in this repo; it may replace a reviewed name. */
  name_en_curated: boolean;
  source: "osm" | "generated";
  source_ref: string;
  /** SQL producing a geometry(MultiPolygon,4326), with its bindings. */
  geom: { sql: string; bindings: Array<string | number> };
}

export interface ImportReport {
  country: string;
  inserted: number;
  updated: number;
  deactivated: number;
  skippedManual: number;
  byLevel: Record<string, number>;
  unreviewedNames: number;
  warnings: string[];
}

const sourceRef = (p: FeatureProps) => `${p.osm_type === "manual" ? "manual" : "osm"}:${p.osm_type === "manual" ? "" : `${p.osm_type}/`}${p.osm_id}`;

/** Valid, polygon-only, optionally simplified MultiPolygon. */
const clean = (inner: string, simplifyM: number) =>
  simplifyM > 0
    ? `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(ST_MakeValid(${inner}), ${simplifyM / METRES_PER_DEGREE})), 3))`
    : `ST_Multi(ST_CollectionExtract(ST_MakeValid(${inner}), 3))`;

function names(p: FeatureProps, override?: z.infer<typeof nameOverride>) {
  const name_ar = override?.name_ar ?? p.name_ar ?? p.name ?? null;
  if (!name_ar) throw new Error(`Feature ${sourceRef(p)} has no Arabic name`);
  const given = override?.name_en ?? p.name_en ?? null;
  const name_en_curated = override?.name_en !== undefined || (p.osm_type === "manual" && p.name_en != null);
  return given
    ? { name_ar, name_en: given, name_en_reviewed: p.name_en_reviewed ?? true, name_en_curated }
    : { name_ar, name_en: transliterate(name_ar), name_en_reviewed: false, name_en_curated: false };
}

async function loadJson(dir: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, name), "utf8"));
}

export async function importBoundaries(
  db: Knex,
  country: string,
  options: { dataDir?: string; log?: (msg: string) => void } = {},
): Promise<ImportReport> {
  const dir = path.resolve(options.dataDir ?? "data/boundaries", country);
  const log = options.log ?? (() => {});
  const manifest = manifestSchema.parse(await loadJson(dir, "manifest.json"));
  if (manifest.country !== country) throw new Error(`manifest.json is for ${manifest.country}, not ${country}`);

  return db.transaction(async (trx) => {
    const levels = await trx("country_address_fields as c")
      .join("address_fields as f", "f.key", "c.field_key")
      .where({ "c.country_code": country, "f.kind": "admin_area", "c.is_active": true })
      .select("c.field_key", "c.position");
    const position = new Map<string, number>(levels.map((l) => [l.field_key as string, l.position as number]));
    for (const layer of manifest.layers) {
      if (!position.has(layer.level)) throw new Error(`Level "${layer.level}" is not an active area level for ${country}`);
    }

    const report: ImportReport = {
      country,
      inserted: 0,
      updated: 0,
      deactivated: 0,
      skippedManual: 0,
      byLevel: {},
      unreviewedNames: 0,
      warnings: [],
    };
    const touched: number[] = [];

    for (const layer of manifest.layers) {
      log(`Layer ${layer.level} (${layer.type})`);
      let candidates: Candidate[];
      if (layer.type === "osm") {
        const fc = featureCollection(polygonGeometry).parse(await loadJson(dir, layer.file));
        candidates = fc.features.map((f) => ({
          level: layer.level,
          ...names(f.properties, layer.name_overrides[String(f.properties.osm_id)]),
          source: "osm",
          source_ref: sourceRef(f.properties),
          geom: { sql: clean("ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)", layer.simplify_m), bindings: [JSON.stringify(f.geometry)] },
        }));
      } else if (layer.type === "union") {
        const fc = featureCollection(polygonGeometry).parse(await loadJson(dir, layer.file));
        const byId = new Map(fc.features.map((f) => [f.properties.osm_id, f.geometry]));
        candidates = layer.groups.map((g) => {
          const parts = g.osm_ids.map((id) => {
            const geometry = byId.get(id);
            if (!geometry) throw new Error(`union "${g.key}": OSM id ${id} not found in ${layer.file}`);
            return JSON.stringify(geometry);
          });
          return {
            level: layer.level,
            name_ar: g.name_ar,
            name_en: g.name_en,
            name_en_reviewed: true,
            name_en_curated: true,
            source: "generated",
            source_ref: `union:${g.key}`,
            geom: {
              sql: clean(
                `(SELECT ST_Union(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(value::text), 4326))) FROM jsonb_array_elements(?::jsonb))`,
                layer.simplify_m,
              ),
              bindings: [JSON.stringify(parts.map((p) => JSON.parse(p)))],
            },
          };
        });
      } else {
        candidates = await cellCandidates(trx, country, dir, layer, report);
      }

      for (const c of candidates) {
        const id = await upsertArea(trx, country, c, position, report);
        if (id !== null) touched.push(id);
      }
      report.byLevel[layer.level] = candidates.length;
    }

    const deactivated = await trx("admin_areas")
      .where({ country_code: country, is_active: true })
      .whereIn("source", ["osm", "generated"])
      .modify((q) => {
        if (touched.length) q.whereNotIn("id", touched);
      })
      .update({ is_active: false });
    report.deactivated = deactivated;

    report.unreviewedNames = Number(
      (await trx("admin_areas").where({ country_code: country, is_active: true, name_en_reviewed: false }).count({ n: "*" }).first())?.n ?? 0,
    );
    report.warnings.push(...(await qualityChecks(trx, country)));
    return report;
  });
}

/** Nearest-point (Voronoi) cells around neighbourhood points, clipped to the parent area (SPEC §2.2). */
async function cellCandidates(
  trx: Knex.Transaction,
  country: string,
  dir: string,
  layer: Extract<BoundaryManifest["layers"][number], { type: "cells" }>,
  report: ImportReport,
): Promise<Candidate[]> {
  const clip = await trx("admin_areas")
    .where({ country_code: country, level: layer.clip_to.level, source_ref: layer.clip_to.source_ref })
    .first("id");
  if (!clip) throw new Error(`cells: clip area ${layer.clip_to.level} ${layer.clip_to.source_ref} not found`);

  interface Seed {
    key: string;
    props: FeatureProps;
    lng: number;
    lat: number;
  }
  const seeds: Seed[] = [];
  for (const name of layer.points) {
    const fc = featureCollection(pointGeometry).parse(await loadJson(dir, name));
    for (const f of fc.features) {
      const [lng, lat] = f.geometry.coordinates;
      seeds.push({ key: sourceRef(f.properties), props: f.properties, lng, lat });
    }
  }
  const fixed = layer.polygons ? featureCollection(polygonGeometry).parse(await loadJson(dir, layer.polygons)).features : [];
  // A drawn polygon also acts as a seed so its neighbours' cells stop at it. The seed is placed in
  // the part that lies inside the clip area (an outline may straddle the clip boundary).
  for (const f of fixed) {
    const pos = await trx.raw<{ rows: Array<{ lng: number | null; lat: number | null }> }>(
      `SELECT ST_X(p) AS lng, ST_Y(p) AS lat
         FROM (SELECT ST_PointOnSurface(ST_Intersection(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), boundary::geometry)) AS p
                 FROM admin_areas WHERE id = ?) s`,
      [JSON.stringify(f.geometry), clip.id],
    );
    const { lng, lat } = pos.rows[0] ?? {};
    if (lng == null || lat == null) {
      report.warnings.push(`cells: ${sourceRef(f.properties)} (${f.properties.name_ar ?? f.properties.name}) does not overlap the clip area — skipped`);
      continue;
    }
    seeds.push({ key: sourceRef(f.properties), props: f.properties, lng, lat });
  }

  // Keep only seeds inside the clip area; drop exact duplicate positions.
  const inside = await trx.raw<{ rows: Array<{ i: number }> }>(
    `SELECT (s.ordinality - 1)::int AS i
       FROM jsonb_array_elements(?::jsonb) WITH ORDINALITY s(value, ordinality), admin_areas a
      WHERE a.id = ? AND ST_Covers(a.boundary, ST_SetSRID(ST_MakePoint((s.value->>0)::float8, (s.value->>1)::float8), 4326)::geography)`,
    [JSON.stringify(seeds.map((s) => [s.lng, s.lat])), clip.id],
  );
  const keep = new Set(inside.rows.map((r) => r.i));
  const seen = new Set<string>();
  const used: Seed[] = [];
  seeds.forEach((s, i) => {
    const pos = `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`;
    if (!keep.has(i)) {
      report.warnings.push(`cells: ${s.key} (${s.props.name_ar ?? s.props.name}) is outside the clip area — skipped`);
    } else if (seen.has(pos)) {
      report.warnings.push(`cells: ${s.key} duplicates another point's position — skipped`);
    } else {
      seen.add(pos);
      used.push(s);
    }
  });

  // Points with the same (folded) Arabic name become one area: their cells are merged.
  const groups = new Map<string, Seed[]>();
  for (const s of used) {
    const n = fold(s.props.name_ar ?? s.props.name ?? s.key).replace(/\s+/g, " ").trim();
    groups.set(n, [...(groups.get(n) ?? []), s]);
  }

  const fixedByKey = new Map(fixed.map((f) => [sourceRef(f.properties), JSON.stringify(f.geometry)]));
  const fixedUnion = `(SELECT ST_Union(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(value::text), 4326))) FROM jsonb_array_elements(?::jsonb))`;
  const fixedAll = JSON.stringify(fixed.map((f) => f.geometry));
  const seedsJson = JSON.stringify(used.map((s) => ({ key: s.key, lng: s.lng, lat: s.lat })));

  // One SQL pass computes every seed's cell (in a metric projection), clipped to the parent area.
  const cells = await trx.raw<{ rows: Array<{ key: string; cell: string }> }>(
    `WITH seeds AS (
       SELECT value->>'key' AS key,
              ST_Transform(ST_SetSRID(ST_MakePoint((value->>'lng')::float8, (value->>'lat')::float8), 4326), ${METRIC_SRID}) AS g
         FROM jsonb_array_elements(?::jsonb)
     ),
     clip AS (SELECT ST_Transform(boundary::geometry, ${METRIC_SRID}) AS g FROM admin_areas WHERE id = ?),
     v AS (
       SELECT (ST_Dump(ST_VoronoiPolygons(ST_Collect(s.g), 0, ST_Expand(ST_Envelope((SELECT g FROM clip)), 2000)))).geom AS cell
         FROM seeds s
     )
     SELECT s.key, ST_AsGeoJSON(ST_Transform(ST_Intersection(v.cell, (SELECT g FROM clip)), 4326), 7) AS cell
       FROM v JOIN seeds s ON ST_Intersects(v.cell, s.g)`,
    [seedsJson, clip.id],
  );
  const cellByKey = new Map(cells.rows.map((r) => [r.key, r.cell]));

  const candidates: Candidate[] = [];
  for (const members of groups.values()) {
    const first = members.slice().sort((a, b) => a.key.localeCompare(b.key))[0]!;
    if (members.length > 1) {
      report.warnings.push(`cells: merged ${members.map((m) => m.key).join(", ")} (same name "${first.props.name_ar ?? first.props.name}")`);
    }
    const memberCells = members.map((m) => cellByKey.get(m.key)).filter((c): c is string => Boolean(c));
    const ownFixed = members.map((m) => fixedByKey.get(m.key)).filter((g): g is string => Boolean(g));
    const isFixed = ownFixed.length > 0;
    const cellsUnion = `(SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(value::text), 4326)) FROM jsonb_array_elements(?::jsonb))`;
    const clipGeom = `(SELECT boundary::geometry FROM admin_areas WHERE id = ?)`;

    // Drawn polygon: its own shape (clipped) plus its cell, so there are no gaps.
    // Generated cell: minus every drawn polygon, so there are no overlaps.
    const geomSql = isFixed
      ? `ST_Union(ST_Intersection(${fixedUnion}, ${clipGeom}), ${cellsUnion})`
      : fixed.length
        ? `ST_Difference(${cellsUnion}, ${fixedUnion})`
        : cellsUnion;
    const bindings = isFixed
      ? [JSON.stringify(ownFixed.map((g) => JSON.parse(g))), clip.id, JSON.stringify(memberCells.map((c) => JSON.parse(c)))]
      : fixed.length
        ? [JSON.stringify(memberCells.map((c) => JSON.parse(c))), fixedAll]
        : [JSON.stringify(memberCells.map((c) => JSON.parse(c)))];

    candidates.push({
      level: layer.level,
      ...names(first.props),
      source: isFixed ? "osm" : "generated",
      source_ref: isFixed ? first.key : `cell:${first.key}`,
      geom: { sql: clean(geomSql, layer.simplify_m), bindings },
    });
  }
  return candidates;
}

async function upsertArea(
  trx: Knex.Transaction,
  country: string,
  c: Candidate,
  position: Map<string, number>,
  report: ImportReport,
): Promise<number | null> {
  // Materialize the geometry once (as GeoJSON) so the rest of the statements stay simple.
  const g = await trx.raw<{ rows: Array<{ geojson: string | null; empty: boolean }> }>(
    `SELECT ST_AsGeoJSON(geom, 7) AS geojson, ST_IsEmpty(geom) AS empty FROM (SELECT ${c.geom.sql} AS geom) s`,
    c.geom.bindings,
  );
  const geojson = g.rows[0]?.geojson;
  if (!geojson || g.rows[0]?.empty) {
    report.warnings.push(`${c.level} ${c.source_ref} (${c.name_ar}): empty geometry — skipped`);
    return null;
  }

  const existing = await trx("admin_areas")
    .where({ country_code: country, level: c.level, source_ref: c.source_ref })
    .first("id", "source", "slug", "name_en_reviewed", "name_en");
  if (existing?.source === "manual") {
    report.skippedManual++;
    return existing.id as number;
  }

  // Parent: the deepest higher-level area containing this area's point-on-surface.
  const parentRow = await trx.raw<{ rows: Array<{ id: number }> }>(
    `SELECT a.id
       FROM admin_areas a
       JOIN country_address_fields f ON f.country_code = a.country_code AND f.field_key = a.level
      WHERE a.country_code = ? AND a.is_active AND f.position < ?
        AND ST_Covers(a.boundary, ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326))::geography)
      ORDER BY f.position DESC
      LIMIT 1`,
    [country, position.get(c.level)!, geojson],
  );
  const parentId = parentRow.rows[0]?.id ?? null;

  // Keep a reviewed English name (possibly edited by an admin) unless this repo curates a replacement.
  const keepName = Boolean(existing?.name_en_reviewed) && !c.name_en_curated;
  const values = {
    parent_id: parentId,
    name_ar: c.name_ar,
    name_en: keepName ? existing.name_en : c.name_en,
    name_en_reviewed: keepName ? true : c.name_en_reviewed,
    source: c.source,
    is_active: true,
    boundary: trx.raw("ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)::geography", [geojson]),
    centroid: trx.raw("ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326))::geography", [geojson]),
  };

  if (existing) {
    const slug = await uniqueSlug(trx, country, parentId, existing.slug as string, existing.id as number);
    await trx("admin_areas").where({ id: existing.id }).update({ ...values, slug });
    report.updated++;
    return existing.id as number;
  }
  const base = slugify(c.name_en) || slugify(c.source_ref) || "area";
  const slug = await uniqueSlug(trx, country, parentId, base);
  const [row] = await trx("admin_areas")
    .insert({ country_code: country, level: c.level, source_ref: c.source_ref, slug, ...values })
    .returning("id");
  report.inserted++;
  return row.id as number;
}

async function uniqueSlug(trx: Knex.Transaction, country: string, parentId: number | null, base: string, selfId?: number) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const clash = await trx("admin_areas")
      .where({ country_code: country, slug })
      .modify((q) => {
        if (parentId === null) q.whereNull("parent_id");
        else q.where("parent_id", parentId);
      })
      .modify((q) => {
        if (selfId !== undefined) q.whereNot("id", selfId);
      })
      .first("id");
    if (!clash) return slug;
  }
}

/** Reported, not fatal: invalid shapes, children sticking out of parents, overlapping siblings. */
async function qualityChecks(trx: Knex.Transaction, country: string): Promise<string[]> {
  const warnings: string[] = [];
  const invalid = await trx.raw<{ rows: Array<{ id: number; name_ar: string }> }>(
    "SELECT id, name_ar FROM admin_areas WHERE country_code = ? AND is_active AND NOT ST_IsValid(boundary::geometry)",
    [country],
  );
  for (const r of invalid.rows) warnings.push(`invalid geometry: #${r.id} ${r.name_ar}`);

  const outside = await trx.raw<{ rows: Array<{ id: number; name_ar: string; pct: number }> }>(
    `SELECT c.id, c.name_ar,
            round((100 * ST_Area(ST_Difference(c.boundary::geometry, p.boundary::geometry)::geography) / NULLIF(ST_Area(c.boundary), 0))::numeric, 1)::float8 AS pct
       FROM admin_areas c JOIN admin_areas p ON p.id = c.parent_id
      WHERE c.country_code = ? AND c.is_active`,
    [country],
  );
  for (const r of outside.rows) if (r.pct > 1) warnings.push(`#${r.id} ${r.name_ar}: ${r.pct}% outside its parent`);

  const overlaps = await trx.raw<{ rows: Array<{ a: string; b: string; m2: number }> }>(
    `SELECT x.name_ar AS a, y.name_ar AS b, ST_Area(ST_Intersection(x.boundary::geometry, y.boundary::geometry)::geography)::float8 AS m2
       FROM admin_areas x JOIN admin_areas y
         ON x.id < y.id AND x.level = y.level AND x.country_code = y.country_code AND x.boundary && y.boundary
      WHERE x.country_code = ? AND x.is_active AND y.is_active AND ST_Intersects(x.boundary, y.boundary)`,
    [country],
  );
  for (const r of overlaps.rows) if (r.m2 > 10_000) warnings.push(`overlap ${Math.round(r.m2 / 1000) / 10} ha: ${r.a} / ${r.b}`);

  return warnings;
}
