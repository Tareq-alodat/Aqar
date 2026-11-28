import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { Knex } from "knex";
import { RateLimiterMemory } from "rate-limiter-flexible";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DRAFT_LIMIT } from "../../app/shared/constants";
import { COMMISSION_TERMS_VERSION } from "../../app/shared/terms";
import { DEV_PASSWORD, seed } from "../db/seeds/01_dev_data";
import { createTestDb } from "../db/test/testDb";
import { requireSecrets } from "../env";
import { createAuthCookies } from "../services/authCookies";
import { createAuthService } from "../services/authService";
import { decrypt } from "../services/cryptoService";
import { distanceMeters } from "../services/locationService";
import { createLimiters } from "../services/rateLimitService";
import { LocalDiskStorage } from "../services/storageService";
import { createApiRouter } from "./index";

/**
 * Submit wizard API (milestone 6): owner-only drafts, location (always
 * approximate in public), address/identifiers, photos, submit with terms and
 * phone, the per-user submission rate, and no limit on active listings.
 */

let db: Knex;
let app: express.Express;
const uploadDir = mkdtempSync(path.join(tmpdir(), "aqar-uploads-"));
/** A point inside Abdoun (its stored interior point), set in beforeAll. */
let ABDOUN = { lng: 0, lat: 0 };
const TERMS = { acceptTerms: true, termsVersion: COMMISSION_TERMS_VERSION };

function buildApp({ submissionsPerDay = 100, realLimits = false } = {}) {
  const limiters = createLimiters();
  if (!realLimits) {
    limiters.api = new RateLimiterMemory({ keyPrefix: "api_test", points: 1_000_000, duration: 60 });
    limiters.uploads = new RateLimiterMemory({ keyPrefix: "uploads_test", points: 1_000_000, duration: 60 });
    limiters.authIp = new RateLimiterMemory({ keyPrefix: "auth_ip_test", points: 1_000_000, duration: 60 });
  }
  const auth = createAuthService({
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
      auth: { service: auth, cookies: createAuthCookies({ secure: false }) },
      limiters,
      db,
      views: { secret: randomBytes(32), secure: false },
      submission: { db, storage: new LocalDiskStorage(uploadDir), phoneSecrets: () => requireSecrets(), submissionsPerDay },
    }),
  );
  return a;
}

async function login(target: express.Express, email: string): Promise<string> {
  const res = await request(target).post("/api/v1/auth/login").send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  return ((res.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
}

const jpeg = (w = 1200, h = 800) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 120, b: 150 } } })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "31/1 57/1 0/1" }, IFD0: { Make: "PhoneCo" } })
    .jpeg()
    .toBuffer();

let owner: string;
let other: string;
let agent: string;
let admin: string;

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
  const c = await db("admin_areas").where({ country_code: "JO", name_ar: "عبدون" }).first(db.raw("ST_X(centroid::geometry) AS lng"), db.raw("ST_Y(centroid::geometry) AS lat"));
  ABDOUN = { lng: Number(Number(c.lng).toFixed(6)), lat: Number(Number(c.lat).toFixed(6)) };
  app = buildApp();
  [owner, other, agent, admin] = await Promise.all([
    login(app, "owner1@aqar.test"),
    login(app, "owner2@aqar.test"),
    login(app, "agent2@aqar.test"),
    login(app, "admin@aqar.test"),
  ]);
});
afterAll(async () => {
  await db.destroy();
  rmSync(uploadDir, { recursive: true, force: true });
});

const api = (cookie: string, target: express.Express = app) => ({
  create: (body: object = { category: "apartment", listingType: "sale", rentPeriod: null }) => request(target).post("/api/v1/my/listings").set("Cookie", cookie).send(body),
  get: (id: number) => request(target).get(`/api/v1/my/listings/${id}`).set("Cookie", cookie),
  patch: (id: number, step: string, data: object) => request(target).patch(`/api/v1/my/listings/${id}`).set("Cookie", cookie).send({ step, data }),
  upload: (id: number, buf: Buffer, name = "photo.jpg") => request(target).post(`/api/v1/my/listings/${id}/images`).set("Cookie", cookie).attach("image", buf, name),
  submit: (id: number, body: object = TERMS) => request(target).post(`/api/v1/my/listings/${id}/submit`).set("Cookie", cookie).send(body),
  remove: (id: number) => request(target).delete(`/api/v1/my/listings/${id}`).set("Cookie", cookie),
});

/** A draft with everything needed to submit (pin, price, title, one photo). */
async function completeDraft(cookie: string, category = "apartment", target: express.Express = app): Promise<number> {
  const a = api(cookie, target);
  const id = (await a.create({ category, listingType: "sale", rentPeriod: null })).body.id as number;
  await a.patch(id, "location", { point: ABDOUN });
  await a.patch(id, "details", { price: 120000, titleAr: "شقة للبيع" });
  if (category !== "land") expect((await a.upload(id, await jpeg(400, 300))).status).toBe(201);
  return id;
}

describe("access", () => {
  it("needs a session; the super_admin does not list properties", async () => {
    expect((await request(app).post("/api/v1/my/listings").send({})).status).toBe(401);
    expect((await api(admin).create()).status).toBe(403);
  });

  it("someone else's draft is a 404 for every action, and responses are private, no-store", async () => {
    const id = (await api(owner).create()).body.id as number;
    const o = api(other);
    expect((await o.get(id)).status).toBe(404);
    expect((await o.patch(id, "details", { price: 1 })).status).toBe(404);
    expect((await o.upload(id, await jpeg(100, 100))).status).toBe(404);
    expect((await o.submit(id)).status).toBe(404);
    expect((await o.remove(id)).status).toBe(404);
    const mine = await api(owner).get(id);
    expect(mine.status).toBe(200);
    expect(mine.headers["cache-control"]).toBe("private, no-store");
    // Drafts are never public.
    expect((await request(app).get(`/api/v1/listings/${id}`)).status).toBe(404);
  });

  it("refuses bad input", async () => {
    expect((await api(owner).create({ category: "castle", listingType: "sale", rentPeriod: null })).status).toBe(400);
    expect((await api(owner).create({ category: "house", listingType: "rent", rentPeriod: null })).status).toBe(400);
    expect((await request(app).get("/api/v1/my/listings/abc").set("Cookie", owner)).status).toBe(400);
  });
});

describe("limits", () => {
  it("at most 10 drafts per user", async () => {
    const cookie = await login(app, "owner3@aqar.test");
    const uid = (await db("users").where({ email: "owner3@aqar.test" }).first("id")).id;
    await db("properties").where({ owner_id: uid, status: "draft" }).delete();
    for (let i = 0; i < DRAFT_LIMIT; i++) expect((await api(cookie).create()).status).toBe(201);
    const res = await api(cookie).create();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("draft_limit");
    await db("properties").where({ owner_id: uid, status: "draft" }).delete();
  });

  it("no limit on active listings: an owner with 5+ active listings can create and submit", async () => {
    const uid = (await db("users").where({ email: "owner1@aqar.test" }).first("id")).id;
    const active = await db("properties").where({ owner_id: uid }).whereIn("status", ["pending", "published", "reserved"]).count({ n: "*" }).first();
    expect(Number(active!.n)).toBeGreaterThanOrEqual(5);
    const id = await completeDraft(owner);
    expect((await api(owner).submit(id)).status).toBe(200);
  });

  it("limits submissions per user per rolling 24 h (configurable)", async () => {
    const limited = buildApp({ submissionsPerDay: 2 });
    const cookie = await login(limited, "agent1@aqar.test");
    const uid = (await db("users").where({ email: "agent1@aqar.test" }).first("id")).id;
    const submit = (id: number) => request(limited).post(`/api/v1/my/listings/${id}/submit`).set("Cookie", cookie).send(TERMS);
    // Earlier submissions (seed) are older than 24 h and do not count.
    for (let i = 0; i < 2; i++) expect((await submit(await completeDraft(cookie, "apartment", limited))).status).toBe(200);
    const third = await completeDraft(cookie, "apartment", limited);
    const res = await submit(third);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("submission_rate_limited");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect((await db("properties").where({ id: third }).first("status")).status).toBe("draft");
    // Once the window has passed, it is allowed again.
    await db("properties").where({ owner_id: uid }).whereNotNull("commission_terms_accepted_at").update({ commission_terms_accepted_at: db.raw("now() - interval '25 hours'") });
    expect((await submit(third)).status).toBe(200);
  });
});

describe("location step", () => {
  it("stores the pin, the area and an approximate public point once per pin move", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    const r1 = await a.patch(id, "location", { point: ABDOUN });
    expect(r1.status).toBe(200);
    const loc = r1.body.draft.location;
    expect(loc.point).toEqual(ABDOUN);
    expect(loc.areaPath.map((x: { nameAr: string }) => x.nameAr)).toContain("عبدون");
    const d = distanceMeters(loc.point, loc.displayPoint);
    expect(d).toBeGreaterThan(149);
    expect(d).toBeLessThan(301);
    expect((await db("properties").where({ id }).first("location_precision")).location_precision).toBe("approximate");

    // Saving the same pin or other fields does not move the public point.
    const again = await a.patch(id, "location", { point: ABDOUN, address: { street: "شارع عبدون" } });
    expect(again.body.draft.location.displayPoint).toEqual(loc.displayPoint);
    expect((await a.patch(id, "details", { price: 5 })).body.draft.location.displayPoint).toEqual(loc.displayPoint);

    // Moving the pin computes a new one.
    const moved = await a.patch(id, "location", { point: { lng: ABDOUN.lng + 0.01, lat: ABDOUN.lat } });
    expect(moved.body.draft.location.displayPoint).not.toEqual(loc.displayPoint);
  });

  it("refuses a pin outside every area and keeps the previous one; no precision choice", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    await a.patch(id, "location", { point: ABDOUN });
    const res = await a.patch(id, "location", { point: { lng: 10, lat: 10 } });
    expect(res.status).toBe(200);
    expect(res.body.fieldErrors.point).toBe("out_of_area");
    expect(res.body.draft.location.point).toEqual(ABDOUN);
    expect((await a.patch(id, "location", { precision: "exact" })).status).toBe(400);
  });

  it("validates address fields and identifiers against the country's settings", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    const res = await a.patch(id, "location", {
      address: { street: "شارع زهران", building_number: "<script>", nonsense: "x" },
      identifiers: { jo_land_parcel: { directorate: "عمان الغربية", village: "عبدون" } },
    });
    expect(res.body.draft.address).toEqual({ street: "شارع زهران" });
    expect(res.body.fieldErrors).toMatchObject({ "address.building_number": "invalid", "address.nonsense": "unknown", "identifiers.jo_land_parcel.basin": "required" });
    expect(res.body.draft.identifiers).toEqual({});

    const ok = await a.patch(id, "location", {
      identifiers: { jo_land_parcel: { directorate: "عمان الغربية", village: "عبدون", basin: "12", parcel: "٠٤٥٦", apartment: "3" } },
    });
    expect(ok.body.fieldErrors).toEqual({});
    expect(ok.body.draft.identifiers.jo_land_parcel).toMatchObject({ parcel: "0456", apartment: "3" });
    const row = await db("property_identifiers").where({ property_id: id }).first("value_normalized");
    expect(row.value_normalized).toBe("عمان الغربيه/عبدون/12/456/3");
  });
});

describe("details step", () => {
  it("checks the price against the currency's decimals (JOD: 3)", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    const bad = await a.patch(id, "details", { price: 100.1234, bedrooms: 3 });
    expect(bad.body.fieldErrors.price).toBe("decimals");
    expect(bad.body.draft.details).toMatchObject({ price: null, bedrooms: 3 });
    expect((await a.patch(id, "details", { price: 100.125 })).body.draft.details.price).toBe(100.125);
    expect((await a.patch(id, "details", { bedrooms: -2 })).status).toBe(400);
  });
});

describe("photos", () => {
  it("stores WebP + thumbnail without EXIF/GPS; reorders and deletes", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    const up1 = await a.upload(id, await jpeg(2400, 1600));
    expect(up1.status).toBe(201);
    expect(up1.body.image).toMatchObject({ width: 2000, height: 1333 });
    const file = path.join(uploadDir, up1.body.image.url.replace("/uploads/", ""));
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(existsSync(path.join(uploadDir, up1.body.image.thumbnailUrl.replace("/uploads/", "")))).toBe(true);

    const up2 = await a.upload(id, await jpeg(300, 300));
    const ids = [up2.body.image.id, up1.body.image.id];
    expect((await request(app).put(`/api/v1/my/listings/${id}/images/order`).set("Cookie", owner).send({ ids })).status).toBe(204);
    expect((await a.get(id)).body.draft.images.map((i: { id: number }) => i.id)).toEqual(ids);
    expect((await request(app).put(`/api/v1/my/listings/${id}/images/order`).set("Cookie", owner).send({ ids: [ids[0]] })).status).toBe(400);

    expect((await request(app).delete(`/api/v1/my/listings/${id}/images/${ids[0]}`).set("Cookie", owner)).status).toBe(204);
    const left = (await a.get(id)).body.draft.images;
    expect(left.map((i: { id: number }) => i.id)).toEqual([ids[1]]);
    expect(await db("property_images").where({ property_id: id }).pluck("order_index")).toEqual([0]);
    expect(existsSync(path.join(uploadDir, up2.body.image.url.replace("/uploads/", "")))).toBe(false);
  });

  it("refuses non-images by content and more than 20 photos", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    const fake = await a.upload(id, Buffer.from("not really a jpeg"), "photo.jpg");
    expect(fake.status).toBe(415);
    const svg = await a.upload(id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "photo.png");
    expect(svg.status).toBe(415);
    const small = await jpeg(60, 40);
    for (let i = 0; i < 20; i++) expect((await a.upload(id, small)).status).toBe(201);
    const extra = await a.upload(id, small);
    expect(extra.status).toBe(409);
    expect(extra.body.error).toBe("too_many_photos");
    expect(readdirSync(path.join(uploadDir, "listings", String(id)))).toHaveLength(40);
  });

  it("limits uploads per user (30/min) before processing them", async () => {
    const limited = buildApp({ realLimits: true });
    const cookie = await login(limited, "owner2@aqar.test");
    const id = (await request(limited).post("/api/v1/my/listings").set("Cookie", cookie).send({ category: "land", listingType: "sale", rentPeriod: null })).body.id;
    const send = () => request(limited).post(`/api/v1/my/listings/${id}/images`).set("Cookie", cookie).attach("image", Buffer.from("x"), "x.jpg");
    for (let i = 0; i < 30; i++) expect((await send()).status).toBe(415);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("deleting a draft removes its files", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    const up = await a.upload(id, await jpeg(200, 200));
    const file = path.join(uploadDir, up.body.image.url.replace("/uploads/", ""));
    expect(existsSync(file)).toBe(true);
    expect((await a.remove(id)).status).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(await db("properties").where({ id }).first()).toBeUndefined();
  });
});

describe("submit", () => {
  it("lists what is missing; photos are required except for land", async () => {
    const a = api(owner);
    const id = (await a.create()).body.id as number;
    const res = await a.submit(id);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("incomplete");
    expect(res.body.missing.map((m: { field: string }) => m.field)).toEqual(["point", "price", "title", "images"]);

    const land = await completeDraft(owner, "land");
    expect((await db("property_images").where({ property_id: land }).count({ n: "*" }).first())!.n).toBe("0");
    expect((await a.submit(land)).status).toBe(200);
  });

  it("requires the current terms and a valid phone", async () => {
    const a = api(owner);
    const id = await completeDraft(owner);
    expect((await a.submit(id, { termsVersion: COMMISSION_TERMS_VERSION })).body.error).toBe("terms_required");
    expect((await a.submit(id, { acceptTerms: false, termsVersion: COMMISSION_TERMS_VERSION })).body.error).toBe("terms_required");
    expect((await a.submit(id, { acceptTerms: true, termsVersion: "2025-01" })).status).toBe(409);
    expect((await a.submit(id, { ...TERMS, phone: "12345" })).body.error).toBe("phone_invalid");

    const reg = await request(app).post("/api/v1/auth/register").send({ name: "No Phone", email: "nophone@aqar.test", password: "a-long-password" });
    expect(reg.status).toBe(201);
    const noPhone = ((reg.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
    const draft = await completeDraft(noPhone);
    expect((await api(noPhone).submit(draft)).body.error).toBe("phone_required");
  });

  it("submits → pending with the phone encrypted, payer, terms and price history; never echoes the phone", async () => {
    const a = api(agent);
    const id = await completeDraft(agent);
    const res = await a.submit(id, { ...TERMS, phone: "0795551234" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, status: "pending" });
    expect(res.text).not.toContain("795551234");

    const row = await db("properties").where({ id }).first();
    expect(row.status).toBe("pending");
    expect(decrypt(row.owner_phone_encrypted, requireSecrets().encryptionKey)).toBe("+962795551234");
    expect(row.commission_payer_type).toBe("agent");
    expect(row.commission_terms_version).toBe(COMMISSION_TERMS_VERSION);
    expect(row.commission_terms_accepted_at).toBeInstanceOf(Date);
    expect(row.slug).toBe("apartment-sale-abdoun");
    expect(row.location_precision).toBe("approximate");
    expect(await db("price_history").where({ property_id: id }).count({ n: "*" }).first()).toEqual({ n: "1" });

    // Milestone 7a: assigned to the supervisor of Amman city (Abdoun is inside it), recorded in the status history.
    const ammanSup = await db("users").where({ email: "sup.amman@aqar.test" }).first("id");
    expect(row.assigned_supervisor_id).toBe(ammanSup.id);
    expect(row.assigned_at).toBeInstanceOf(Date);
    const history = await db("status_history").where({ entity_type: "listing", entity_id: id }).select("from_status", "to_status", "actor_user_id");
    const agentId = (await db("users").where({ email: "agent2@aqar.test" }).first("id")).id;
    expect(history).toEqual([{ from_status: "draft", to_status: "pending", actor_user_id: agentId }]);
    const audit = await db("audit_log").where({ entity_type: "listing", entity_id: id }).select("action", "actor_user_id", "after", "reason");
    expect(audit).toEqual([{ action: "listing_assigned", actor_user_id: null, after: { assigned_supervisor_id: ammanSup.id }, reason: "submitted" }]);

    const view = await a.get(id);
    expect(view.body.draft.status).toBe("pending");
    expect(view.text).not.toContain("795551234");
    expect((await a.patch(id, "details", { price: 1 })).status).toBe(409);
    expect((await a.remove(id)).status).toBe(409);
    // Pending listings are not public.
    expect((await request(app).get(`/api/v1/listings/${id}`)).status).toBe(404);
  });

  it("an owner without a different number uses the profile phone; payer is the owner", async () => {
    const id = await completeDraft(owner);
    expect((await api(owner).submit(id)).status).toBe(200);
    const row = await db("properties as p").join("users as u", "u.id", "p.owner_id").where("p.id", id).first("p.owner_phone_hash", "u.phone_hash", "p.commission_payer_type");
    expect(row.owner_phone_hash).toBe(row.phone_hash);
    expect(row.commission_payer_type).toBe("owner");
  });
});
