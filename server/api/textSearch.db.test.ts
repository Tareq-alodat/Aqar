import { randomBytes } from "node:crypto";
import express from "express";
import type { Knex } from "knex";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONTACT_MASK } from "../../app/shared/contactDetails";
import { seed } from "../db/seeds/01_dev_data";
import { createTestDb } from "../db/test/testDb";
import { createLimiters } from "../services/rateLimitService";
import { createApiRouter } from "./index";

/** Text search, near me and location autocomplete (SPEC §5.6); contact masking in search output (§8.1). */

let db: Knex;
let app: express.Express;

function buildApp() {
  const a = express();
  a.use(
    "/api/v1",
    createApiRouter({
      isProduction: true,
      checkDatabase: vi.fn().mockResolvedValue("ok" as const),
      limiters: createLimiters(),
      db,
      views: { secret: randomBytes(32), secure: false },
    }),
  );
  return a;
}

type Card = { id: number; title: string; category: string; areaName: string | null };

/** Every result card of a search (all pages). */
async function search(qs: string): Promise<{ total: number; items: Card[] }> {
  const items: Card[] = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const res = await request(app).get(`/api/v1/listings?country=JO&${qs}&page=${page}`);
    expect(res.status, qs).toBe(200);
    total = res.body.total;
    items.push(...res.body.items);
    if (items.length >= total) break;
  }
  return { total, items };
}
const ids = (r: { items: Card[] }) => r.items.map((i) => i.id).sort((a, b) => a - b);
const q = (text: string) => `q=${encodeURIComponent(text)}`;

const area = (level: string, nameEn: string) => db("admin_areas").where({ country_code: "JO", level, name_en: nameEn }).first("id");

/** Published listings anywhere inside an area. */
async function publishedInside(areaId: number): Promise<number[]> {
  const r = await db.raw(
    `WITH RECURSIVE d AS (SELECT id FROM admin_areas WHERE id = ? UNION ALL SELECT a.id FROM admin_areas a JOIN d ON a.parent_id = d.id)
     SELECT p.id FROM properties p WHERE p.status = 'published' AND p.admin_area_id IN (SELECT id FROM d) ORDER BY p.id`,
    [areaId],
  );
  return r.rows.map((x: { id: number }) => x.id);
}

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
  app = buildApp();
});
afterAll(async () => {
  await db.destroy();
});

describe("text search (q)", () => {
  it("finds listings by area name, through the area path, across the whole country", async () => {
    const abdoun = await area("area", "Abdoun");
    const expected = await publishedInside(abdoun.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(await search(q("عبدون")))).toEqual(expected);
    expect(ids(await search(q("Abdoun")))).toEqual(expected);

    // "Amman" is not in the titles: it matches through the area path (city and governorate).
    const amman = await area("governorate", "Amman");
    expect(ids(await search(q("عمان")))).toEqual(await publishedInside(amman.id));
  });

  it("is tolerant of Arabic spelling variants and typos", async () => {
    const base = ids(await search(q("شقة")));
    expect(base.length).toBeGreaterThan(0);
    for (const variant of ["شقه", "شَقَّة", "شقـــة"]) expect(ids(await search(q(variant))), variant).toEqual(base);
    const apartments = await search(q("شقة"));
    for (const i of apartments.items) expect(i.category).toBe("apartment");

    const abdoun = ids(await search(q("عبدون")));
    expect(ids(await search(q("عبدوم")))).toEqual(abdoun);
    expect(ids(await search(q("abdon")))).toEqual(abdoun);
    expect(ids(await search(q("ABDOUN")))).toEqual(abdoun);
  });

  it("needs every word to match, skipping stop words", async () => {
    const khalda = await area("area", "Khalda");
    const inKhalda = await publishedInside(khalda.id);
    const villas = await db("properties").whereIn("id", inKhalda).where({ category: "villa" }).orderBy("id").pluck("id");
    expect(villas.length).toBeGreaterThan(0);
    expect(ids(await search(q("فيلا في خلدا")))).toEqual(villas);
    expect(ids(await search(q("villa in khalda")))).toEqual(villas);
    expect(ids(await search(q("villas khalda")))).toEqual(villas);
  });

  it("returns only published listings, best match first by default", async () => {
    const res = await search(q("شقة"));
    const statuses = await db("properties").whereIn("id", ids(res)).distinct("status").pluck("status");
    expect(statuses).toEqual(["published"]);
    const first = await request(app).get(`/api/v1/listings?country=JO&${q("شقة عبدون")}`);
    expect(first.body.items[0].areaName).toBe("عبدون");
    const sorted = await request(app).get(`/api/v1/listings?country=JO&${q("شقة")}&sort=price_asc`);
    const prices = sorted.body.items.map((i: { price: number | null }) => i.price).filter((p: number | null) => p !== null);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
  });

  it("combines with filters and a map area", async () => {
    const all = await search(q("شقة"));
    const rent = await search(`${q("شقة")}&type=rent`);
    expect(rent.total).toBeLessThan(all.total);
    for (const id of ids(rent)) expect((await db("properties").where({ id }).first("listing_type")).listing_type).toBe("rent");

    // In the view ("Search this area"): the client sends the bbox.
    const amman = await db.raw("SELECT ST_XMin(boundary::geometry) a, ST_YMin(boundary::geometry) b, ST_XMax(boundary::geometry) c, ST_YMax(boundary::geometry) d FROM admin_areas WHERE level = 'city' AND name_en = 'Amman'");
    const b = amman.rows[0];
    const inView = await search(`${q("شقة")}&bbox=${b.a},${b.b},${b.c},${b.d}`);
    expect(inView.total).toBeGreaterThan(0);
    expect(inView.total).toBeLessThanOrEqual(all.total);
  });

  it("never matches or shows contact details written into listing text", async () => {
    // Seed listing 1 has "للتواصل ٠٧٩١٢٣٤٥٦٧ أو واتساب" in its description.
    for (const text of ["0791234567", "٠٧٩١٢٣٤٥٦٧", "واتساب"]) expect((await search(q(text))).total, text).toBe(0);

    const target = (await db("properties").where({ status: "published" }).orderBy("id").first("id", "title_ar")) as { id: number; title_ar: string };
    try {
      await db("properties").where({ id: target.id }).update({ title_ar: `${target.title_ar} 0791234567` });
      const res = await search(q(target.title_ar));
      const card = res.items.find((i) => i.id === target.id);
      expect(card?.title).toBe(`${target.title_ar} ${CONTACT_MASK}`);
      const detail = await request(app).get(`/api/v1/listings/${target.id}?lang=ar`);
      expect(detail.body.listing.title).toBe(`${target.title_ar} ${CONTACT_MASK}`);
      expect(JSON.stringify(detail.body)).not.toContain("0791234567");
    } finally {
      await db("properties").where({ id: target.id }).update({ title_ar: target.title_ar });
    }
  });

  it("masks contact details in the listing description", async () => {
    const withContact = await db("properties").where("description_ar", "like", "%واتساب%").first("id");
    const detail = await request(app).get(`/api/v1/listings/${withContact.id}?lang=ar`);
    expect(detail.status).toBe(200);
    expect(detail.body.listing.description).toContain(`للتواصل ${CONTACT_MASK} أو ${CONTACT_MASK}`);
    expect(JSON.stringify(detail.body)).not.toMatch(/٠٧٩١٢٣٤٥٦٧|واتساب/);
  });

  it("gives points with the bounds of all matches", async () => {
    const res = await request(app).get(`/api/v1/map/points?country=JO&${q("عبدون")}`);
    expect(res.status).toBe(200);
    const list = await search(q("عبدون"));
    expect(res.body.features).toHaveLength(list.total);
    const [minLng, minLat, maxLng, maxLat] = res.body.bbox;
    for (const f of res.body.features) {
      const [lng, lat] = f.geometry.coordinates;
      expect(lng).toBeGreaterThanOrEqual(minLng - 1e-5);
      expect(lng).toBeLessThanOrEqual(maxLng + 1e-5);
      expect(lat).toBeGreaterThanOrEqual(minLat - 1e-5);
      expect(lat).toBeLessThanOrEqual(maxLat + 1e-5);
    }
    const none = await request(app).get(`/api/v1/map/points?country=JO&${q("zzzzqqqq")}`);
    expect(none.body).toMatchObject({ features: [], bbox: null });
    // Without a query, the response has no bounds (as before).
    expect((await request(app).get("/api/v1/map/points?country=JO&bbox=34.9,29.1,39.4,33.4")).body.bbox).toBeUndefined();
  });

  it("refuses bad input", async () => {
    expect((await request(app).get(`/api/v1/listings?country=JO&bbox=34.9,29.1,39.4,33.4&q=${"x".repeat(101)}`)).body).toEqual({ error: "invalid_input", fields: ["q"] });
    expect((await request(app).get("/api/v1/listings?country=JO&q=a&q=b")).status).toBe(400);
    // Whitespace only is no query: an area is then required.
    expect((await request(app).get("/api/v1/listings?country=JO&q=%20%20")).body.fields).toEqual(["bbox"]);
  });
});

describe("near me", () => {
  const centre = { lng: 35.871, lat: 31.952 };
  const near = (radius?: number) => `near=${centre.lng},${centre.lat}${radius ? `&radius=${radius}` : ""}`;

  it("searches within the radius of display points (default 2 km)", async () => {
    const counts: number[] = [];
    for (const r of [1, 2, 5, 10]) {
      const res = await search(near(r));
      counts.push(res.total);
      const far = await db.raw(
        "SELECT count(*)::int AS n FROM properties WHERE id = ANY(?) AND ST_Distance(display_point, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) > ?",
        [ids(res), centre.lng, centre.lat, r * 1000],
      );
      expect(far.rows[0].n).toBe(0);
      const inside = await db.raw(
        "SELECT count(*)::int AS n FROM properties WHERE status = 'published' AND ST_DWithin(display_point, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)",
        [centre.lng, centre.lat, r * 1000],
      );
      expect(res.total).toBe(inside.rows[0].n);
    }
    expect(counts[3]!).toBeGreaterThan(0);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect((await search(near())).total).toBe(counts[1]!);
  });

  it("combines with a text query and the points endpoint", async () => {
    const both = await search(`${near(10)}&${q("شقة")}`);
    const onlyNear = await search(near(10));
    expect(both.total).toBeLessThanOrEqual(onlyNear.total);
    for (const i of both.items) expect(i.category).toBe("apartment");
    const points = await request(app).get(`/api/v1/map/points?country=JO&${near(10)}`);
    expect(points.body.features).toHaveLength(onlyNear.total);
  });

  it("refuses bad radii and near with a drawn area", async () => {
    expect((await request(app).get(`/api/v1/listings?country=JO&${near(3)}`)).body.fields).toEqual(["radius"]);
    expect((await request(app).get("/api/v1/listings?country=JO&near=35.9")).body.fields).toEqual(expect.arrayContaining(["near"]));
    const ring = [[35.8, 31.9], [35.9, 31.9], [35.9, 32.0], [35.8, 32.0], [35.8, 31.9]];
    const post = await request(app)
      .post("/api/v1/map/points")
      .send({ country: "JO", polygon: { type: "Polygon", coordinates: [ring] }, filters: { near: "35.87,31.95" } });
    expect(post.status).toBe(400);
    expect(post.body.fields).toEqual(["near"]);
  });
});

describe("GET /api/v1/areas/suggest", () => {
  type Suggestion = { id: number; level: string; nameAr: string; nameEn: string; bbox: number[]; parents: Array<{ nameAr: string; nameEn: string }> };
  const suggest = async (text: string): Promise<Suggestion[]> => {
    const res = await request(app).get(`/api/v1/areas/suggest?country=JO&${q(text)}`);
    expect(res.status, text).toBe(200);
    return res.body.items;
  };

  it("suggests areas with their path and bounds", async () => {
    const [first] = await suggest("عبد");
    expect(first).toMatchObject({ nameEn: "Abdoun", level: "area" });
    expect(first!.parents.map((p) => `${p.nameEn}`)).toEqual(["Amman", "Amman"]);
    expect(first!.bbox[0]!).toBeLessThan(first!.bbox[2]!);
  });

  it("matches English names, spelling variants and typos", async () => {
    expect((await suggest("abdoun"))[0]?.nameEn).toBe("Abdoun");
    expect((await suggest("Abdon")).map((s) => s.nameEn)).toContain("Abdoun");
    expect((await suggest("الصويفيه")).map((s) => s.nameEn)).toContain("Sweifieh");
    expect((await suggest("الجبيهه")).map((s) => s.nameEn)).toContainEqual(expect.stringMatching(/Jubeiha/));
  });

  it("returns at most 8, higher levels first on equal match", async () => {
    const amman = await suggest("عمان");
    expect(amman.length).toBeLessThanOrEqual(8);
    expect(amman.slice(0, 2).map((s) => s.level)).toEqual(["governorate", "city"]);
    expect((await suggest("zzzzqqqq"))).toEqual([]);
  });

  it("refuses bad input", async () => {
    expect((await request(app).get("/api/v1/areas/suggest?country=JO&q=%20")).status).toBe(400);
    expect((await request(app).get("/api/v1/areas/suggest?country=SA&q=abc")).status).toBe(400);
    expect((await request(app).get(`/api/v1/areas/suggest?country=JO&q=${"x".repeat(101)}`)).status).toBe(400);
  });

  it("has its own 120/min limit, not counted in the general 100/min", async () => {
    const fresh = buildApp();
    for (let i = 0; i < 120; i++) expect((await request(fresh).get("/api/v1/areas/suggest?country=JO&q=abd")).status).toBe(200);
    const limited = await request(fresh).get("/api/v1/areas/suggest?country=JO&q=abd");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) expect((await request(fresh).get("/api/v1/health")).status).toBe(200);
    expect((await request(fresh).get("/api/v1/health")).status).toBe(429);
  });
});
