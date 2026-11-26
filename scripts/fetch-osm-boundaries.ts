/**
 * Development-only: downloads Jordan's boundary source data from
 * OpenStreetMap (free Overpass API) into data/boundaries/JO/. The output is
 * committed, so the import never needs the network. Re-run only to refresh
 * the data, then review the diff and update SOURCES.md.
 *
 *   npx tsx scripts/fetch-osm-boundaries.ts [--only=governorates,districts,points,polygons,suburbs]
 *
 * OSM relations come back as member ways; PostGIS assembles them into
 * polygons (ST_BuildArea), so a local database (DATABASE_URL) is required.
 * Data © OpenStreetMap contributors, ODbL.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../server/db/knex";

const OUT_DIR = path.resolve("data/boundaries/JO");
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const USER_AGENT = "aqar-boundary-fetch/1.0 (development data import)";

/** OSM relation id of Amman governorate (the area the neighbourhood points are taken from). */
const AMMAN_GOVERNORATE = 2926344;
/** OSM district (admin_level=5) relations merged into the four seed cities (SPEC §2.2). */
export const CITY_DISTRICTS = {
  amman: [13376001, 13376002, 13376005, 13376006, 13376007], // Qasabah, Marka, Quaismeh, Al-Jami'ah, Wadi Essier
  irbid: [13376097], // Irbid Qasabah
  zarqa: [13376133], // Zarqa Qasabah
  aqaba: [13376081], // Aqaba Qasabah
} as const;
/** Neighbourhoods that are drawn as areas in OSM (used instead of a generated cell). */
const NEIGHBOURHOOD_POLYGONS = [277741642]; // Dabouq (way)

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
}

async function overpass(query: string): Promise<OsmElement[]> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length]!;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) return ((await res.json()) as { elements: OsmElement[] }).elements;
      console.warn(`  ${url} → HTTP ${res.status}, retrying`);
    } catch (err) {
      console.warn(`  ${url} → ${(err as Error).message}, retrying`);
    }
    await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
  }
  throw new Error("Overpass API unavailable after retries");
}

const line = (pts: Array<{ lat: number; lon: number }>) => ({
  type: "LineString",
  coordinates: pts.map((p) => [p.lon, p.lat]),
});

/** Polygon/MultiPolygon GeoJSON for a relation or closed way, built by PostGIS. */
async function toPolygon(el: OsmElement): Promise<unknown> {
  const lines =
    el.type === "relation"
      ? (el.members ?? []).filter((m) => m.type === "way" && m.geometry && m.role !== "subarea" && m.role !== "admin_centre").map((m) => line(m.geometry!))
      : [line(el.geometry ?? [])];
  const result = await getDb().raw<{ rows: Array<{ geojson: string | null }> }>(
    `SELECT ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_BuildArea(ST_Collect(g))), 3)), 6) AS geojson
       FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(value::text), 4326) AS g FROM jsonb_array_elements(?::jsonb)) s`,
    [JSON.stringify(lines)],
  );
  const geojson = result.rows[0]?.geojson;
  if (!geojson) throw new Error(`Could not build a polygon for ${el.type} ${el.id}`);
  return JSON.parse(geojson);
}

function properties(el: OsmElement) {
  const t = el.tags ?? {};
  return {
    osm_type: el.type,
    osm_id: el.id,
    name: t.name ?? null,
    name_ar: t["name:ar"] ?? null,
    name_en: t["name:en"] ?? null,
    ...(t.admin_level ? { admin_level: t.admin_level } : {}),
    ...(t.place ? { place: t.place } : {}),
  };
}

async function polygons(query: string) {
  const elements = await overpass(query);
  const features = [];
  for (const el of elements.sort((a, b) => a.id - b.id)) {
    features.push({ type: "Feature", properties: properties(el), geometry: await toPolygon(el) });
  }
  return { type: "FeatureCollection", features };
}

async function write(file: string, data: unknown) {
  await writeFile(path.join(OUT_DIR, file), `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(`  wrote ${file}`);
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (part: string) => !only || only.includes(part);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  if (want("governorates")) {
  console.log("Governorates (admin_level=4)…");
  await write(
    "osm-governorates.geojson",
    await polygons(
      `[out:json][timeout:180];area["ISO3166-1"="JO"][admin_level=2]->.jo;relation(area.jo)["boundary"="administrative"]["admin_level"="4"];out geom;`,
    ),
  );

  }

  if (want("districts")) {
  console.log("City districts (admin_level=5)…");
  const ids = Object.values(CITY_DISTRICTS).flat().join(",");
  await write("osm-city-districts.geojson", await polygons(`[out:json][timeout:180];relation(id:${ids});out geom;`));

  }

  if (want("points")) {
  console.log("Amman neighbourhood points (place=neighbourhood)…");
  const nodes = await overpass(
    `[out:json][timeout:120];rel(${AMMAN_GOVERNORATE});map_to_area->.a;node(area.a)["place"="neighbourhood"];out;`,
  );
  await write("osm-amman-neighbourhood-points.geojson", {
    type: "FeatureCollection",
    features: nodes
      .sort((a, b) => a.id - b.id)
      .map((n) => ({ type: "Feature", properties: properties(n), geometry: { type: "Point", coordinates: [n.lon, n.lat] } })),
  });

  }

  if (want("polygons")) {
  console.log("Neighbourhood polygons…");
  await write(
    "osm-amman-neighbourhood-polygons.geojson",
    await polygons(`[out:json][timeout:120];way(id:${NEIGHBOURHOOD_POLYGONS.join(",")});out geom;`),
  );

  }

  if (want("suburbs")) {
  console.log("Municipal districts (place=suburb, recorded for a later level)…");
  const suburbs = await overpass(
    `[out:json][timeout:120];rel(${AMMAN_GOVERNORATE});map_to_area->.a;node(area.a)["place"="suburb"];out;`,
  );
  await write("osm-amman-municipal-district-points.geojson", {
    type: "FeatureCollection",
    features: suburbs
      .sort((a, b) => a.id - b.id)
      .map((n) => ({ type: "Feature", properties: properties(n), geometry: { type: "Point", coordinates: [n.lon, n.lat] } })),
  });

  }

  await getDb().destroy();
  console.log("Done. Review the diff and update data/boundaries/JO/SOURCES.md (date, counts).");
}

main().catch(async (err) => {
  console.error(err);
  await getDb().destroy();
  process.exit(1);
});
