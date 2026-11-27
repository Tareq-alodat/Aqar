import express from "express";
import type { Knex } from "knex";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodePolygon } from "../../app/shared/schemas/mapSearch";
import { seed } from "../db/seeds/01_dev_data";
import { createTestDb } from "../db/test/testDb";
import { clearOutlineCache } from "../services/areaService";
import { createLimiters } from "../services/rateLimitService";
import { createApiRouter } from "./index";

const JORDAN = "34.9,29.1,39.4,33.4";
let db: Knex;
let app: express.Express;

function buildApp() {
  const a = express();
  a.use(
    "/api/v1",
    createApiRouter({ isProduction: true, checkDatabase: vi.fn().mockResolvedValue("ok" as const), limiters: createLimiters(), db }),
  );
  return a;
}

const area = (level: string, nameAr: string) => db("admin_areas").where({ country_code: "JO", level, name_ar: nameAr }).first();
const centroid = async (id: number) =>
  (await db.raw("SELECT ST_X(centroid::geometry) AS lng, ST_Y(centroid::geometry) AS lat FROM admin_areas WHERE id = ?", [id])).rows[0] as {
    lng: number;
    lat: number;
  };
const outlineRing = async (id: number): Promise<Array<[number, number]>> => {
  const r = await db.raw("SELECT ST_AsGeoJSON(ST_ExteriorRing(ST_GeometryN(boundary::geometry, 1)), 6) AS g FROM admin_areas WHERE id = ?", [id]);
  return JSON.parse(r.rows[0].g).coordinates;
};

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
  clearOutlineCache();
  app = buildApp();
});
afterAll(async () => {
  await db.destroy();
});

describe("GET /api/v1/map/points", () => {
  it("returns only published listings, with allow-listed properties", async () => {
    const res = await request(app).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}`);
    expect(res.status).toBe(200);
    const published = await db("properties").where({ status: "published" }).count({ n: "*" }).first();
    expect(res.body.features).toHaveLength(Number(published!.n));
    expect(res.body.truncated).toBe(false);
    for (const f of res.body.features) {
      expect(Object.keys(f.properties).sort()).toEqual(["category", "currency", "id", "is_featured", "listing_type", "price", "rent_period"]);
    }
  });

  it("uses display_point, never the true point", async () => {
    const res = await request(app).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}`);
    const rows = await db("properties")
      .where({ status: "published", location_precision: "approximate" })
      .select("id", db.raw("ST_X(display_point::geometry) AS dx"), db.raw("ST_X(point::geometry) AS px"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const f = res.body.features.find((x: { id: number }) => x.id === r.id);
      expect(f.geometry.coordinates[0]).toBeCloseTo(Number(r.dx), 6);
      expect(Math.abs(f.geometry.coordinates[0] - Number(r.px))).toBeGreaterThan(1e-7);
    }
  });

  it("applies filters", async () => {
    const get = async (qs: string) => (await request(app).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}&${qs}`)).body.features;
    const ids = (fs: Array<{ id: number }>) => fs.map((f) => f.id);

    for (const f of await get("type=rent")) expect(f.properties.listing_type).toBe("rent");
    for (const f of await get("cat=land&type=sale")) expect(f.properties).toMatchObject({ category: "land", listing_type: "sale" });

    const priced = await get("minPrice=100000&maxPrice=200000");
    for (const f of priced) expect(f.properties.price).toBeGreaterThanOrEqual(100000);
    for (const f of priced) expect(f.properties.price).toBeLessThanOrEqual(200000);

    const fivePlus = ids(await get("beds=5"));
    const rows = await db("properties").whereIn("id", fivePlus).pluck("bedrooms");
    for (const b of rows) expect(b).toBeGreaterThanOrEqual(5);

    const pool = ids(await get("amen=pool,parking"));
    for (const r of await db("properties").whereIn("id", pool).select("pool", "parking")) expect(r).toEqual({ pool: true, parking: true });

    const amman = await area("city", "عمان");
    const inAmman = ids(await get(`area=${amman.id}`));
    expect(inAmman.length).toBeGreaterThan(0);
    const outside = await db("properties as p")
      .whereIn("p.id", inAmman)
      .whereRaw(
        "NOT EXISTS (WITH RECURSIVE up AS (SELECT id, parent_id FROM admin_areas WHERE id = p.admin_area_id UNION ALL SELECT a.id, a.parent_id FROM admin_areas a JOIN up ON a.id = up.parent_id) SELECT 1 FROM up WHERE id = ?)",
        [amman.id],
      )
      .count({ n: "*" })
      .first();
    expect(Number(outside!.n)).toBe(0);
  });

  it("refuses bad input", async () => {
    expect((await request(app).get("/api/v1/map/points?country=JO")).body).toEqual({ error: "invalid_input", fields: ["bbox"] });
    expect((await request(app).get(`/api/v1/map/points?country=SA&bbox=${JORDAN}`)).status).toBe(400);
    expect((await request(app).get("/api/v1/map/points?country=JO&bbox=36,32,35,31")).status).toBe(400);
    const bad = await request(app).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}&type=castle&beds=x`);
    expect(bad.body.fields.sort()).toEqual(["beds", "type"]);
    expect((await request(app).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}&type=sale&type=rent`)).status).toBe(400);
  });
});

describe("POST /api/v1/map/points (draw to search)", () => {
  it("returns only listings inside the polygon", async () => {
    const abdoun = await area("area", "عبدون");
    const ring = await outlineRing(abdoun.id);
    const res = await request(app)
      .post("/api/v1/map/points")
      .send({ country: "JO", polygon: { type: "Polygon", coordinates: [ring] }, filters: {} });
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBeGreaterThan(0);
    const inside = await db.raw(
      `SELECT count(*)::int AS n FROM properties p, admin_areas a
        WHERE a.id = ? AND p.status = 'published' AND ST_Covers(a.boundary, p.display_point)`,
      [abdoun.id],
    );
    expect(res.body.features.length).toBe(inside.rows[0].n);
  });

  it("refuses a self-intersecting polygon and malformed bodies", async () => {
    const bowtie = [[35.8, 31.9], [35.9, 32.0], [35.9, 31.9], [35.8, 32.0], [35.8, 31.9]];
    const res = await request(app).post("/api/v1/map/points").send({ country: "JO", polygon: { type: "Polygon", coordinates: [bowtie] } });
    expect(res.status).toBe(400);
    expect(res.body.fields).toEqual(["poly"]);
    expect((await request(app).post("/api/v1/map/points").send({ country: "JO" })).status).toBe(400);
    const open = [[35.8, 31.9], [35.9, 32.0], [35.9, 31.9], [35.85, 31.8]];
    expect((await request(app).post("/api/v1/map/points").send({ country: "JO", polygon: { type: "Polygon", coordinates: [open] } })).status).toBe(400);
  });
});

describe("GET /api/v1/listings", () => {
  it("pages result cards with a total matching the map", async () => {
    const points = (await request(app).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}`)).body.features.length;
    const p1 = await request(app).get(`/api/v1/listings?country=JO&bbox=${JORDAN}&lang=ar`);
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ total: points, page: 1, pageSize: 20 });
    expect(p1.body.items).toHaveLength(20);
    const p3 = await request(app).get(`/api/v1/listings?country=JO&bbox=${JORDAN}&page=3`);
    expect(p3.body.items).toHaveLength(points - 40);
    expect(Object.keys(p1.body.items[0]).sort()).toEqual(
      ["areaName", "areaSqm", "bathrooms", "bedrooms", "category", "currency", "id", "isFeatured", "listingType", "price", "rentPeriod", "thumbnailUrl", "title"].sort(),
    );
    expect(JSON.stringify(p1.body)).not.toMatch(/phone|"point"|address|identifier/i);
  });

  it("sorts by price with listings without a price last", async () => {
    const res = await request(app).get(`/api/v1/listings?country=JO&bbox=${JORDAN}&sort=price_asc&page=1`);
    const prices = res.body.items.map((i: { price: number | null }) => i.price).filter((p: number | null) => p !== null);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const desc = await request(app).get(`/api/v1/listings?country=JO&bbox=${JORDAN}&sort=price_desc`);
    expect(desc.body.items[0].price).toBeGreaterThanOrEqual(desc.body.items[1].price);
  });

  it("gives titles and area names in the requested language, falling back to Arabic", async () => {
    const all = async (lang: string) => {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        out.push(...(await request(app).get(`/api/v1/listings?country=JO&bbox=${JORDAN}&lang=${lang}&page=${page}`)).body.items);
      }
      return out as Array<{ id: number; title: string; areaName: string }>;
    };
    const en = await all("en");
    const arOnly = await db("properties").where({ status: "published" }).whereNull("title_en").pluck("id");
    expect(arOnly.length).toBeGreaterThan(0);
    for (const item of en) {
      if (arOnly.includes(item.id)) expect(item.title).toMatch(/[؀-ۿ]/);
      else expect(item.title).toMatch(/^[A-Za-z]/);
    }
    expect(en.some((i) => i.areaName === "Abdoun")).toBe(true);
  });

  it("accepts a polygon in the query (poly=)", async () => {
    const abdoun = await area("area", "عبدون");
    const poly = encodeURIComponent(encodePolygon(await outlineRing(abdoun.id)));
    const res = await request(app).get(`/api/v1/listings?country=JO&poly=${poly}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    for (const i of res.body.items) expect(i.areaName).toBe("عبدون");
  });
});

describe("/api/v1/areas", () => {
  it("lists jump-to areas and the zoom of each level", async () => {
    const res = await request(app).get("/api/v1/areas/tree?country=JO");
    expect(res.status).toBe(200);
    expect(res.body.levels).toEqual([
      { level: "governorate", position: 1, minZoom: 6 },
      { level: "city", position: 2, minZoom: 9 },
      { level: "area", position: 3, minZoom: 12 },
    ]);
    const byLevel = (l: string) => res.body.areas.filter((a: { level: string }) => a.level === l);
    expect(byLevel("governorate")).toHaveLength(12);
    expect(byLevel("city")).toHaveLength(4);
    for (const a of res.body.areas) expect(a.bbox[0]).toBeLessThan(a.bbox[2]);
  });

  it("serves simplified outlines with label points", async () => {
    const res = await request(app).get("/api/v1/areas/outlines?country=JO&level=area");
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBeGreaterThanOrEqual(140);
    const f = res.body.features[0];
    expect(f.properties).toMatchObject({ level: "area" });
    expect(f.properties.label).toHaveLength(2);
    expect(["Polygon", "MultiPolygon"]).toContain(f.geometry.type);
    expect(res.headers["cache-control"]).toMatch(/max-age/);
    expect((await request(app).get("/api/v1/areas/outlines?country=JO&level=block")).status).toBe(404);
  });

  it("gives the address path at a point for the zoom level", async () => {
    const abdoun = await area("area", "عبدون");
    const c = await centroid(abdoun.id);
    const at = async (z: number) =>
      ((await request(app).get(`/api/v1/areas/at?country=JO&lng=${c.lng}&lat=${c.lat}&z=${z}`)).body.path as Array<{ nameEn: string; level: string }>).map(
        (p) => `${p.level}:${p.nameEn}`,
      );
    expect(await at(13)).toEqual(["governorate:Amman", "city:Amman", "area:Abdoun"]);
    expect(await at(10)).toEqual(["governorate:Amman", "city:Amman"]);
    expect(await at(7)).toEqual(["governorate:Amman"]);
    expect(await at(4)).toEqual([]);
  });
});

describe("rate limits", () => {
  it("gives /map/points its own 60/min, not counted in the general 100/min", async () => {
    const fresh = buildApp();
    for (let i = 0; i < 60; i++) expect((await request(fresh).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}`)).status).toBe(200);
    const limited = await request(fresh).get(`/api/v1/map/points?country=JO&bbox=${JORDAN}`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // The 61 points requests did not use the general budget.
    for (let i = 0; i < 100; i++) expect((await request(fresh).get("/api/v1/health")).status).toBe(200);
    expect((await request(fresh).get("/api/v1/health")).status).toBe(429);
  });
});
