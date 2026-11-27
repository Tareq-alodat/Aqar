import { randomBytes } from "node:crypto";
import type { Knex } from "knex";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type AqarServer } from "./createServer";
import { DEV_PASSWORD, seed } from "./db/seeds/01_dev_data";
import { createTestDb } from "./db/test/testDb";
import { requireSecrets } from "./env";
import { decrypt } from "./services/cryptoService";

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
  });
});

afterAll(async () => {
  await server?.close();
  await db?.destroy();
});

async function login(email: string): Promise<string> {
  const res = await request(server.app).post("/api/v1/auth/login").set("Origin", BASE).send({ email, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
  return ((res.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");
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

function expectNoLeak(html: string, r: Row, approximate: boolean) {
  const e164 = decrypt(r.owner_phone_encrypted, requireSecrets().encryptionKey);
  const national = e164.replace(/^\+962/, "");
  for (const form of [e164, e164.slice(1), `0${national}`, national]) expect(html).not.toContain(form);
  if (approximate) {
    expect(html).not.toContain(Number(r.px).toFixed(5));
    expect(html).not.toContain(Number(r.py).toFixed(5));
    if (r.address.street) expect(html).not.toContain(r.address.street);
  }
  for (const key of ["owner_phone", "phone_hash", "email", "apartment_number", "value_normalized"]) expect(html).not.toContain(key);
}

describe("listing detail page", () => {
  it("renders an approximate listing in Arabic without leaking private data", async () => {
    const r = await find({ status: "published", location_precision: "approximate", category: "apartment" });
    const res = await request(server.app).get(`/ar/property/${r.id}-${r.slug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('dir="rtl"');
    expect(res.text).toContain(`<link rel="canonical" href="${BASE}/ar/property/${r.id}-${r.slug}"/>`);
    expect(res.text).not.toContain('content="noindex"');
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(String(res.headers["set-cookie"])).toMatch(/aqar_vid=[A-Za-z0-9_-]{22};.*HttpOnly/);
    expectNoLeak(res.text, r, true);

    const identifiers = (await db("property_identifiers").select("value", "value_normalized")) as Array<{ value: string; value_normalized: string }>;
    for (const id of await db("property_identifiers").pluck("property_id")) {
      const p = await db("properties").where({ id }).first("slug", "status");
      if (p.status !== "published") continue;
      const html = (await request(server.app).get(`/en/property/${id}-${p.slug}`)).text;
      for (const v of identifiers) expect(html).not.toContain(v.value_normalized);
    }
  });

  it("renders an exact listing in English with its public address but no admin-only fields", async () => {
    const r = await find({ status: "published", location_precision: "exact", category: "apartment" });
    const res = await request(server.app).get(`/en/property/${r.id}-${r.slug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('dir="ltr"');
    expect(res.text).toContain(r.address.street);
    expectNoLeak(res.text, r, false);
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
      expectNoLeak(res.text, r, false);
    }
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
