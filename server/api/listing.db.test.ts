import { randomBytes } from "node:crypto";
import express from "express";
import type { Knex } from "knex";
import { RateLimiterMemory } from "rate-limiter-flexible";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEV_PASSWORD, seed } from "../db/seeds/01_dev_data";
import { createTestDb } from "../db/test/testDb";
import { requireSecrets } from "../env";
import { createAuthCookies } from "../services/authCookies";
import { createAuthService } from "../services/authService";
import { resolveContactNumber } from "../services/contactService";
import { SIMILAR_COUNT, SIMILAR_RADIUS_M } from "../services/listingService";
import { createLimiters } from "../services/rateLimitService";
import { decrypt } from "../services/cryptoService";
import { newVisitorId, recordView, visitorHash } from "../services/viewService";
import { createApiRouter } from "./index";

/**
 * Listing detail API (milestone 5): the public serializer never leaks the
 * owner's phone, the true point, identifiers or hidden address fields
 * (CLAUDE.md rules 1–2); visibility, contact resolution, views, similar, save.
 */

let db: Knex;
let app: express.Express;
const viewSecret = randomBytes(32);

/** `realLimits: false` lifts the general 100/min limit: this file sends far more requests than that. */
function buildApp({ realLimits = false } = {}) {
  const limiters = createLimiters();
  if (!realLimits) limiters.api = new RateLimiterMemory({ keyPrefix: "api_test", points: 1_000_000, duration: 60 });
  const service = createAuthService({
    db,
    secrets: { jwtSecret: randomBytes(32), refreshTokenSecret: randomBytes(32) },
    limiters,
    phoneSecrets: () => requireSecrets(),
  });
  const a = express();
  a.use(
    "/api/v1",
    createApiRouter({
      isProduction: true,
      checkDatabase: vi.fn().mockResolvedValue("ok" as const),
      auth: { service, cookies: createAuthCookies({ secure: false }) },
      limiters,
      db,
      views: { secret: viewSecret, secure: false },
    }),
  );
  return a;
}

function cookieHeader(res: request.Response): string {
  const set = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (set ?? [])
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c && !c.endsWith("="))
    .join("; ");
}

const sessions = new Map<string, string>();
async function login(email: string): Promise<string> {
  const cached = sessions.get(email);
  if (cached) return cached;
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  const cookie = cookieHeader(res);
  sessions.set(email, cookie);
  return cookie;
}

const userId = async (email: string) => (await db("users").where({ email }).first("id")).id as number;

interface Row {
  id: number;
  owner_id: number;
  status: string;
  location_precision: string;
  category: string;
  address: Record<string, string>;
  owner_phone_encrypted: string;
  px: number;
  py: number;
  dx: number;
  dy: number;
}
const rows = (q: Knex.QueryBuilder): Promise<Row[]> =>
  q.select(
    "p.id",
    "p.owner_id",
    "p.status",
    "p.location_precision",
    "p.category",
    "p.address",
    "p.owner_phone_encrypted",
    db.raw("ST_X(p.point::geometry) AS px"),
    db.raw("ST_Y(p.point::geometry) AS py"),
    db.raw("ST_X(p.display_point::geometry) AS dx"),
    db.raw("ST_Y(p.display_point::geometry) AS dy"),
  );
const one = async (where: Record<string, unknown>) => (await rows(db("properties as p").where(where).orderBy("p.id").limit(1)))[0]!;

/** Every way the owner's phone could be written: E.164, digits only, local 07…, national 7…. */
function phoneForms(encrypted: string): string[] {
  const e164 = decrypt(encrypted, requireSecrets().encryptionKey);
  const national = e164.replace(/^\+962/, "");
  return [e164, e164.slice(1), `0${national}`, national];
}

function expectNoLeak(body: string, r: Row) {
  for (const form of phoneForms(r.owner_phone_encrypted)) expect(body).not.toContain(form);
  if (r.location_precision === "approximate") {
    expect(body).not.toContain(Number(r.px).toFixed(5));
    expect(body).not.toContain(Number(r.py).toFixed(5));
  }
  for (const key of ["owner_phone", "phone_encrypted", "phone_hash", "email", "\"point\"", "value_normalized", "identifiers", "owner_id"]) {
    expect(body).not.toContain(key);
  }
}

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
  app = buildApp();
});
afterAll(async () => {
  await db.destroy();
});

describe("GET /api/v1/listings/:id — privacy", () => {
  it("returns an explicit field list and never the phone, true point or identifiers", async () => {
    const published = await rows(db("properties as p").where("p.status", "published"));
    const identified = new Set((await db("property_identifiers").pluck("property_id")) as number[]);
    expect(published.some((r) => identified.has(r.id))).toBe(true);
    const values = (await db("property_identifiers").select("value", "value_normalized")) as Array<{ value: string; value_normalized: string }>;

    for (const r of published) {
      const res = await request(app).get(`/api/v1/listings/${r.id}?lang=ar`);
      expect(res.status).toBe(200);
      expect(res.body.access).toBe("public");
      expect(Object.keys(res.body.listing).sort()).toEqual(
        [
          "address", "ageYears", "amenities", "areaPath", "areaSqm", "bathrooms", "bedrooms", "category", "contact", "currency",
          "currencyDecimals", "description", "features", "floorNumber", "floors", "furnished", "id", "images", "isFeatured",
          "listingType", "location", "owner", "price", "pricePerSqm", "publishedAt", "rentPeriod", "slug", "status", "title", "viewCount",
        ].sort(),
      );
      expect(Object.keys(res.body.listing.owner).sort()).toEqual(["company", "memberSince", "name", "role"]);
      expectNoLeak(res.text, r);
      if (identified.has(r.id)) for (const v of values) expect(res.text).not.toContain(v.value_normalized);
      // The public point is the stored display point.
      expect(res.body.listing.location.lng).toBeCloseTo(Number(r.dx), 6);
      expect(res.body.listing.location.lat).toBeCloseTo(Number(r.dy), 6);
    }
  });

  it("shows exact_only address fields only for exact pins, admin_only never", async () => {
    const exact = await one({ "p.status": "published", "p.location_precision": "exact", "p.category": "apartment" });
    const approx = await one({ "p.status": "published", "p.location_precision": "approximate", "p.category": "apartment" });
    for (const r of [exact, approx]) expect(r.address.apartment_number).toBeTruthy();

    const keys = async (id: number) =>
      ((await request(app).get(`/api/v1/listings/${id}`)).body.listing.address as Array<{ key: string }>).map((a) => a.key);
    expect(await keys(exact.id)).toEqual(expect.arrayContaining(["street", "building_number"]));
    expect(await keys(exact.id)).not.toContain("apartment_number");
    expect(await keys(approx.id)).toEqual([]);

    const approxText = (await request(app).get(`/api/v1/listings/${approx.id}`)).text;
    expect(approxText).not.toContain(approx.address.street!);
  });

  it("refuses bad ids", async () => {
    expect((await request(app).get("/api/v1/listings/abc")).status).toBe(400);
    expect((await request(app).get("/api/v1/listings/1?lang=fr")).status).toBe(400);
    expect((await request(app).get("/api/v1/listings/999999")).status).toBe(404);
  });
});

describe("visibility", () => {
  it("hides non-public listings except as a no-store, noindex preview for the owner and admins", async () => {
    const pending = await one({ "p.status": "pending" });
    const owner = (await db("users").where({ id: pending.owner_id }).first("email")).email as string;
    const stranger = (await db("users").where({ role: "owner" }).whereNot({ id: pending.owner_id }).first("email")).email as string;

    expect((await request(app).get(`/api/v1/listings/${pending.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/listings/${pending.id}`).set("Cookie", await login(stranger))).status).toBe(404);
    expect((await request(app).get(`/api/v1/listings/${pending.id}/similar`)).status).toBe(404);

    for (const email of [owner, "admin@aqar.test"]) {
      const res = await request(app).get(`/api/v1/listings/${pending.id}`).set("Cookie", await login(email));
      expect(res.status).toBe(200);
      expect(res.body.access).toBe("preview");
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex");
      expect(res.body.listing.contact).toBeNull();
      expectNoLeak(res.text, pending);
    }

    const published = await one({ "p.status": "published" });
    const pub = await request(app).get(`/api/v1/listings/${published.id}`);
    expect(pub.headers["cache-control"]).toBeUndefined();
    expect(pub.headers["x-robots-tag"]).toBeUndefined();
  });

  it("sold/rented are public without contact; reserved keeps it", async () => {
    const sold = await one({ "p.status": "sold" });
    const res = await request(app).get(`/api/v1/listings/${sold.id}`);
    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe("sold");
    expect(res.body.listing.contact).toBeNull();

    const pub = await one({ "p.status": "published" });
    try {
      await db("properties").where({ id: pub.id }).update({ status: "reserved" });
      const reserved = await request(app).get(`/api/v1/listings/${pub.id}`);
      expect(reserved.body.access).toBe("public");
      expect(reserved.body.listing.contact).not.toBeNull();
      await db("properties").where({ id: pub.id }).update({ status: "rented" });
      expect((await request(app).get(`/api/v1/listings/${pub.id}`)).body.listing.contact).toBeNull();
    } finally {
      await db("properties").where({ id: pub.id }).update({ status: "published" });
    }
  });
});

describe("resolveContactNumber (SPEC §8 order)", () => {
  const areaId = async (level: string, nameAr: string) =>
    (await db("admin_areas").where({ country_code: "JO", level, name_ar: nameAr }).first("id")).id as number;

  it("property → area → ancestors → country → global, active numbers only", async () => {
    const abdoun = await areaId("area", "عبدون");
    const propertyNumber = await db("contact_numbers").where({ scope: "property" }).first("property_id");
    const listing = await db("properties").where({ id: propertyNumber.property_id }).first("id", "admin_area_id", "country_code");
    const resolve = (id: number, adminAreaId: number | null) => resolveContactNumber(db, { id, adminAreaId, countryCode: "JO" });

    expect((await resolve(listing.id, listing.admin_area_id))?.phone).toBe("+96265000005");
    expect((await resolve(-1, abdoun))?.phone).toBe("+96265000004");
    // Another Amman neighbourhood: Abdoun's number does not apply, the city's does.
    const other = await db("admin_areas as a")
      .join("admin_areas as c", "c.id", "a.parent_id")
      .where({ "a.level": "area", "c.name_ar": "عمان" })
      .whereNot("a.id", abdoun)
      .first("a.id");
    expect((await resolve(-1, other.id))?.phone).toBe("+96265000003");
    // A governorate other than Amman's: no area number on its chain → the country's.
    const ammanGov = (await db("admin_areas").where({ country_code: "JO", level: "city", name_ar: "عمان" }).first("parent_id")).parent_id;
    const otherGov = await db("admin_areas").where({ country_code: "JO", level: "governorate" }).whereNot({ id: ammanGov }).first("id");
    expect((await resolve(-1, otherGov.id))?.phone).toBe("+96265000002");
    expect((await resolve(-1, null))?.phone).toBe("+96265000002");

    try {
      await db("contact_numbers").where({ scope: "property" }).update({ is_active: false });
      await db("contact_numbers").where({ scope: "country" }).update({ is_active: false });
      expect((await resolve(listing.id, abdoun))?.phone).toBe("+96265000004");
      expect((await resolve(-1, null))?.phone).toBe("+96265000001");
      // A number on another country never applies.
      expect((await resolveContactNumber(db, { id: -1, adminAreaId: null, countryCode: "KW" }))?.phone).toBe("+96265000001");
    } finally {
      await db("contact_numbers").update({ is_active: true });
    }
  });

  it("is what the API returns", async () => {
    const propertyNumber = await db("contact_numbers").where({ scope: "property" }).first("property_id");
    const res = await request(app).get(`/api/v1/listings/${propertyNumber.property_id}`);
    expect(res.body.listing.contact).toEqual({ phone: "+96265000005", whatsapp: true });
  });
});

describe("similar listings", () => {
  it("published only, same category and type, nearest within 5 km first, at most 4", async () => {
    const published = await db("properties").where({ status: "published" }).select("id", "category", "listing_type");
    let checked = 0;
    for (const p of published) {
      const res = await request(app).get(`/api/v1/listings/${p.id}/similar`);
      expect(res.status).toBe(200);
      const items = res.body.items as Array<{ id: number; category: string; listingType: string; slug: string | null }>;
      expect(items.length).toBeLessThanOrEqual(SIMILAR_COUNT);
      if (items.length === 0) continue;
      checked++;
      const ids = items.map((i) => i.id);
      expect(ids).not.toContain(p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const i of items) expect(i).toMatchObject({ category: p.category, listingType: p.listing_type });
      const statuses = await db("properties").whereIn("id", ids).pluck("status");
      expect(new Set(statuses)).toEqual(new Set(["published"]));

      const dist = await db.raw<{ rows: Array<{ id: number; d: number }> }>(
        "SELECT o.id, ST_Distance(o.display_point, s.display_point) AS d FROM properties o, properties s WHERE s.id = ? AND o.id = ANY(?)",
        [p.id, ids],
      );
      const d = ids.map((id) => Number(dist.rows.find((r) => r.id === id)!.d));
      const near = d.filter((x) => x <= SIMILAR_RADIUS_M);
      // Nearby ones come first, closest first; the rest fill up from the city.
      expect(d.slice(0, near.length)).toEqual([...near].sort((a, b) => a - b));
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("never includes sold or pending listings", async () => {
    const sold = await one({ "p.status": "sold" });
    const hidden = (await db("properties").whereNot({ status: "published" }).pluck("id")) as number[];
    const published = (await db("properties").where({ status: "published" }).pluck("id")) as number[];
    for (const id of [sold.id, ...published]) {
      const items = (await request(app).get(`/api/v1/listings/${id}/similar`)).body.items as Array<{ id: number }>;
      for (const i of items) expect(hidden).not.toContain(i.id);
    }
  });
});

describe("POST /api/v1/listings/:id/view", () => {
  const count = async (id: number) => (await db("properties").where({ id }).first("view_count")).view_count as number;
  const view = (id: number, cookie?: string) => {
    const r = request(app).post(`/api/v1/listings/${id}/view`);
    return cookie ? r.set("Cookie", cookie) : r;
  };

  it("counts once per visitor per 24 h and never the owner or admins", async () => {
    const r = await one({ "p.status": "published" });
    const before = await count(r.id);
    const a = `aqar_vid=${newVisitorId()}`;
    const b = `aqar_vid=${newVisitorId()}`;

    expect((await view(r.id, a)).status).toBe(204);
    expect((await view(r.id, a)).status).toBe(204);
    expect(await count(r.id)).toBe(before + 1);
    await view(r.id, b);
    expect(await count(r.id)).toBe(before + 2);

    const owner = (await db("users").where({ id: r.owner_id }).first("email")).email as string;
    await view(r.id, `${await login(owner)}; aqar_vid=${newVisitorId()}`);
    await view(r.id, `${await login("admin@aqar.test")}; aqar_vid=${newVisitorId()}`);
    expect(await count(r.id)).toBe(before + 2);
  });

  it("only for public listings (incl. sold), never drafts/pending; 204 either way", async () => {
    const pending = await one({ "p.status": "pending" });
    const sold = await one({ "p.status": "sold" });
    const [p0, s0] = [await count(pending.id), await count(sold.id)];
    expect((await view(pending.id, `aqar_vid=${newVisitorId()}`)).status).toBe(204);
    expect((await view(sold.id, `aqar_vid=${newVisitorId()}`)).status).toBe(204);
    expect((await view(999999)).status).toBe(204);
    expect((await view(0)).status).toBe(400);
    expect(await count(pending.id)).toBe(p0);
    expect(await count(sold.id)).toBe(s0 + 1);
  });

  it("the 24 h window is rolling, across the date change", async () => {
    const r = await one({ "p.status": "published" });
    const hash = visitorHash({ cookieId: newVisitorId(), ip: "203.0.113.9" }, viewSecret);
    const t0 = new Date("2026-12-01T22:00:00Z");
    const at = (h: number) => new Date(t0.getTime() + h * 3_600_000);
    const rec = (now: Date) => recordView(db, { propertyId: r.id, visitorHash: hash, viewer: null, now });
    expect(await rec(t0)).toBe(true);
    expect(await rec(at(3))).toBe(false); // next calendar day, same 24 h
    expect(await rec(at(23.9))).toBe(false);
    expect(await rec(at(24.1))).toBe(true);
  });

  it("is rate-limited on its own (30/min per IP)", async () => {
    const r = await one({ "p.status": "published" });
    const fresh = buildApp({ realLimits: true });
    for (let i = 0; i < 30; i++) expect((await request(fresh).post(`/api/v1/listings/${r.id}/view`)).status).toBe(204);
    const limited = await request(fresh).post(`/api/v1/listings/${r.id}/view`);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    // Not counted in the general API limit.
    expect((await request(fresh).get(`/api/v1/listings/${r.id}`)).status).toBe(200);
  });
});

describe("PUT/DELETE /api/v1/listings/:id/save", () => {
  it("needs a session", async () => {
    const r = await one({ "p.status": "published" });
    expect((await request(app).put(`/api/v1/listings/${r.id}/save`)).status).toBe(401);
    expect((await request(app).delete(`/api/v1/listings/${r.id}/save`)).status).toBe(401);
  });

  it("saves and unsaves public listings only", async () => {
    const email = "owner3@aqar.test";
    const cookie = await login(email);
    const uid = await userId(email);
    const r = await one({ "p.status": "published" });
    const saved = () => db("saved_properties").where({ user_id: uid, property_id: r.id }).first();

    const put = await request(app).put(`/api/v1/listings/${r.id}/save`).set("Cookie", cookie);
    expect(put.body).toEqual({ saved: true });
    expect((await request(app).put(`/api/v1/listings/${r.id}/save`).set("Cookie", cookie)).status).toBe(200);
    expect(await saved()).toBeTruthy();
    expect((await request(app).get(`/api/v1/listings/${r.id}`).set("Cookie", cookie)).status).toBe(200);

    expect((await request(app).delete(`/api/v1/listings/${r.id}/save`).set("Cookie", cookie)).body).toEqual({ saved: false });
    expect(await saved()).toBeUndefined();

    const pending = await db("properties").where({ status: "pending" }).whereNot({ owner_id: uid }).first("id");
    expect((await request(app).put(`/api/v1/listings/${pending.id}/save`).set("Cookie", cookie)).status).toBe(404);
    expect((await request(app).put("/api/v1/listings/x/save").set("Cookie", cookie)).status).toBe(400);
  });
});
