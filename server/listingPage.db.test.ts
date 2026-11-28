import { randomBytes } from "node:crypto";
import type { Knex } from "knex";
import { RateLimiterMemory } from "rate-limiter-flexible";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type AqarServer } from "./createServer";
import { DEV_PASSWORD, seed } from "./db/seeds/01_dev_data";
import { createTestDb } from "./db/test/testDb";
import { requireSecrets } from "./env";
import { decrypt } from "./services/cryptoService";
import { createLimiters } from "./services/rateLimitService";

/**
 * The listing detail page, server-rendered through the real dev setup
 * (milestone 5). Loader data is serialized into the HTML, so the rendered
 * page must never contain the owner's phone, the true point, property
 * identifiers or hidden address fields (CLAUDE.md rules 1–2).
 */

const BASE = "http://localhost:3998";
let db: Knex;
let server: AqarServer;

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
  server = await createServer({
    isProduction: false,
    port: 3998,
    publicBaseUrl: BASE,
    uploadDir: "./uploads",
    db,
    authSecrets: { jwtSecret: randomBytes(32), refreshTokenSecret: randomBytes(32) },
    phoneSecrets: () => requireSecrets(),
    hmr: false,
    logRequests: false,
    // Many logins in one file: lift the per-IP login limit (tested in the auth tests).
    limiters: { ...createLimiters(), authIp: new RateLimiterMemory({ keyPrefix: "auth_ip_test", points: 1000, duration: 60 }) },
  });
});

afterAll(async () => {
  await server?.close();
  await db?.destroy();
});

const sessions = new Map<string, string>();
async function login(email: string): Promise<string> {
  const cached = sessions.get(email);
  if (cached) return cached;
  const res = await request(server.app).post("/api/v1/auth/login").set("Origin", BASE).send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  const cookie = ((res.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
  sessions.set(email, cookie);
  return cookie;
}

interface Row {
  id: number;
  slug: string;
  owner_id: number;
  address: Record<string, string>;
  owner_phone_encrypted: string;
  px: number;
  py: number;
}
const find = async (where: Record<string, unknown>): Promise<Row> =>
  db("properties")
    .where(where)
    .orderBy("id")
    .first(
      "id",
      "slug",
      "owner_id",
      "address",
      "owner_phone_encrypted",
      db.raw("ST_X(point::geometry) AS px"),
      db.raw("ST_Y(point::geometry) AS py"),
    );

/** The detail page (public view or owner preview) never shows the phone, the true pin or non-public address fields. */
function expectNoLeak(html: string, r: Row) {
  const e164 = decrypt(r.owner_phone_encrypted, requireSecrets().encryptionKey);
  const national = e164.replace(/^\+962/, "");
  for (const form of [e164, e164.slice(1), `0${national}`, national]) expect(html).not.toContain(form);
  expect(html).not.toContain(Number(r.px).toFixed(5));
  expect(html).not.toContain(Number(r.py).toFixed(5));
  if (r.address.street) expect(html).not.toContain(r.address.street);
  for (const key of ["owner_phone", "phone_hash", "email", "apartment_number", "value_normalized"]) expect(html).not.toContain(key);
}

describe("listing detail page", () => {
  it("renders an approximate listing in Arabic without leaking private data", async () => {
    const r = await find({ status: "published", category: "apartment" });
    const res = await request(server.app).get(`/ar/property/${r.id}-${r.slug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('dir="rtl"');
    expect(res.text).toContain(`<link rel="canonical" href="${BASE}/ar/property/${r.id}-${r.slug}"/>`);
    expect(res.text).not.toContain('content="noindex"');
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(String(res.headers["set-cookie"])).toMatch(/aqar_vid=[A-Za-z0-9_-]{22};.*HttpOnly/);
    expectNoLeak(res.text, r);

    const identifiers = (await db("property_identifiers").select("value", "value_normalized")) as Array<{ value: string; value_normalized: string }>;
    for (const id of await db("property_identifiers").pluck("property_id")) {
      const p = await db("properties").where({ id }).first("slug", "status");
      if (p.status !== "published") continue;
      const html = (await request(server.app).get(`/en/property/${id}-${p.slug}`)).text;
      for (const v of identifiers) expect(html).not.toContain(v.value_normalized);
    }
  });

  it("renders listings in English with no exact_only or admin_only address fields", async () => {
    const r = await find({ status: "published", category: "apartment" });
    const res = await request(server.app).get(`/en/property/${r.id}-${r.slug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('dir="ltr"');
    expectNoLeak(res.text, r);
  });

  it("redirects a missing or wrong slug to the canonical URL; 404 otherwise", async () => {
    const r = await find({ status: "published" });
    for (const path of [`/ar/property/${r.id}`, `/ar/property/${r.id}-wrong-slug`]) {
      const res = await request(server.app).get(path);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`/ar/property/${r.id}-${r.slug}`);
    }
    expect((await request(server.app).get("/ar/property/999999")).status).toBe(404);
    expect((await request(server.app).get("/ar/property/abc")).status).toBe(404);
    expect((await request(server.app).get(`/fr/property/${r.id}-${r.slug}`)).status).toBe(404);
  });

  it("pending: 404 for visitors, a no-store, noindex preview for the owner and admins", async () => {
    const r = await find({ status: "pending" });
    const path = `/ar/property/${r.id}-${r.slug}`;
    expect((await request(server.app).get(path)).status).toBe(404);

    const owner = (await db("users").where({ id: r.owner_id }).first("email")).email as string;
    for (const email of [owner, "admin@aqar.test"]) {
      const res = await request(server.app).get(path).set("Cookie", await login(email));
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex");
      expect(res.text).toContain('<meta name="robots" content="noindex"/>');
      expectNoLeak(res.text, r);
    }
  });

  it("shows an individual owner's first name only, never the full name; agents keep the full name", async () => {
    const row = (role: string) =>
      db("properties as p")
        .join("users as u", "u.id", "p.owner_id")
        .where({ "p.status": "published", "u.role": role })
        .orderBy("p.id")
        .select("p.id", "p.slug", "u.name");
    const owners = (await row("owner")) as Array<{ id: number; slug: string; name: string }>;
    const [agent] = (await row("agent")) as Array<{ id: number; slug: string; name: string }>;
    expect(owners.length).toBeGreaterThan(0);

    for (const o of owners) {
      const first = o.name.split(/\s+/u)[0]!;
      const rest = o.name.slice(first.length).trim();
      for (const lang of ["ar", "en"]) {
        const html = (await request(server.app).get(`/${lang}/property/${o.id}-${o.slug}`)).text;
        expect(html).toContain(first);
        expect(html).not.toContain(o.name);
        expect(html).not.toContain(rest);
      }
    }
    const agentHtml = (await request(server.app).get(`/en/property/${agent!.id}-${agent!.slug}`)).text;
    expect(agentHtml).toContain(agent!.name);
  });

  it("sold listings stay public with a status banner and no contact number", async () => {
    const r = await find({ status: "sold" });
    const res = await request(server.app).get(`/en/property/${r.id}-${r.slug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("This property has been sold.");
    expect(res.text).not.toContain("tel:");
  });

  it("map result cards link to the detail page", async () => {
    const res = await request(server.app).get("/ar/jo/map");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/href="\/ar\/property\/\d+-[a-z0-9-]+"/);
  });
});

describe("submit wizard pages", () => {
  const draftFor = async (cookie: string) => {
    const res = await request(server.app)
      .post("/api/v1/my/listings")
      .set("Origin", BASE)
      .set("Cookie", cookie)
      .send({ category: "apartment", listingType: "sale", rentPeriod: null });
    expect(res.status).toBe(201);
    return res.body.id as number;
  };

  it("/listings/new: visitors go to login; listers get the form; admins are told they cannot list", async () => {
    const anon = await request(server.app).get("/ar/listings/new");
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe(`/ar/login?next=${encodeURIComponent("/ar/listings/new")}`);

    const page = await request(server.app).get("/en/listings/new").set("Cookie", await login("owner2@aqar.test"));
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("private, no-store");
    expect(page.text).toContain('name="category"');
    expect(page.text).toContain('<meta name="robots" content="noindex"/>');

    const adminPage = await request(server.app).get("/en/listings/new").set("Cookie", await login("admin@aqar.test"));
    expect(adminPage.text).toContain("Only owner and agent accounts can add listings.");
  });

  it("the step-1 form creates a draft and continues at the location step", async () => {
    const cookie = await login("owner2@aqar.test");
    // A browser's Host matches its Origin; React Router refuses document POSTs where they differ.
    const res = await request(server.app)
      .post("/ar/listings/new")
      .set("Host", new URL(BASE).host)
      .set("Origin", BASE)
      .set("Cookie", cookie)
      .type("form")
      .send({ category: "house", listingType: "rent" });
    expect(res.status).toBe(302);
    const m = /^\/ar\/listings\/(\d+)\/edit\?step=location$/.exec(res.headers.location ?? "");
    expect(m).not.toBeNull();
    // Without JavaScript the rent period defaults to monthly.
    expect((await db("properties").where({ id: Number(m![1]) }).first("rent_period")).rent_period).toBe("monthly");
  });

  it("the wizard is owner-only, private, and shows the phone masked — never the number", async () => {
    const cookie = await login("owner2@aqar.test");
    const id = await draftFor(cookie);
    const page = await request(server.app).get(`/en/listings/${id}/edit?step=review`).set("Cookie", cookie);
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("private, no-store");
    expect(page.headers["x-robots-tag"]).toBe("noindex");

    const user = await db("users").where({ email: "owner2@aqar.test" }).first("phone_encrypted");
    const e164 = decrypt(user.phone_encrypted, requireSecrets().encryptionKey);
    const national = e164.replace(/^\+962/, "");
    expect(page.text).toContain(`+962 ${"•".repeat(national.length - 2)}${national.slice(-2)}`);
    for (const form of [e164, e164.slice(1), `0${national}`, national, national.slice(0, 6)]) expect(page.text).not.toContain(form);

    expect((await request(server.app).get(`/en/listings/${id}/edit`).set("Cookie", await login("owner3@aqar.test"))).status).toBe(404);
    expect((await request(server.app).get(`/en/listings/${id}/edit`)).status).toBe(302);
    // Drafts have no public page.
    expect((await request(server.app).get(`/en/property/${id}`)).status).toBe(404);
  });

  it("the terms page renders the reviewed text: Arabic authoritative, English translation, indexed", async () => {
    const ar = await request(server.app).get("/ar/terms/commission");
    expect(ar.status).toBe(200);
    expect(ar.text).toContain('dir="rtl"');
    expect(ar.text).toContain("شروط الإدراج والعمولة");
    expect(ar.text).toContain("2026-12-v1");
    expect(ar.text).toContain("النص العربي هو المعتمد");
    // Arabic text first, then the English translation, each in its own language.
    const arStart = ar.text.indexOf('lang="ar" dir="rtl" class="flex flex-col');
    const enStart = ar.text.indexOf('lang="en" dir="ltr" class="flex flex-col');
    expect(arStart).toBeGreaterThan(0);
    expect(enStart).toBeGreaterThan(arStart);
    expect(ar.text).toContain("لا تُفرض أي فوائد على التأخير.");
    expect(ar.text).toContain("<strong");
    expect(ar.text).not.toContain("**");
    expect(ar.text).not.toContain("Draft — pending legal review.");
    expect(ar.text).not.toContain('content="noindex"');

    const en = await request(server.app).get("/en/terms/commission");
    expect(en.text).toContain("Listing &amp; commission terms");
    expect(en.text).toContain("no late-payment interest is charged");
    expect(en.text.indexOf('lang="en" dir="ltr" class="flex flex-col')).toBeLessThan(en.text.indexOf('lang="ar" dir="rtl" class="flex flex-col'));
  });
});

describe("map page with a selected area (area=, SPEC §5.2)", () => {
  it("renders the removable area chip and only that area's listings, in both languages", async () => {
    const zarqa = await db("admin_areas").where({ country_code: "JO", level: "governorate", name_ar: "الزرقاء" }).first("id", "name_en");
    const ar = await request(server.app).get(`/ar/jo/map?area=${zarqa.id}`);
    expect(ar.status).toBe(200);
    expect(ar.text).toContain("إزالة فلتر المنطقة: الزرقاء");
    expect(ar.text).toMatch(new RegExp(`<select aria-label="المحافظة"[^>]*>.*?<option value="${zarqa.id}" selected="">`));
    const en = await request(server.app).get(`/en/jo/map?area=${zarqa.id}`);
    expect(en.text).toContain(`Remove the area filter: ${zarqa.name_en}`);
    // No Amman listing in the server-rendered results.
    expect(ar.text).not.toMatch(/في (عبدون|خلدا|الصويفية|الجبيهة|دابوق|تلاع العلي)/);
    // An unknown area renders without a chip.
    const unknown = await request(server.app).get("/ar/jo/map?area=999999");
    expect(unknown.status).toBe(200);
    expect(unknown.text).not.toContain("إزالة فلتر المنطقة");
  });
});
