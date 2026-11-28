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
 * Back-office pages (milestone 7a), server-rendered through the real dev
 * setup: role guards, private headers, the one-time password shown once by
 * the page action, and the must-change-password gate on pages and actions.
 */

const BASE = "http://localhost:3997";
let db: Knex;
let server: AqarServer;

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
  server = await createServer({
    isProduction: false,
    port: 3997,
    publicBaseUrl: BASE,
    uploadDir: "./uploads",
    db,
    authSecrets: { jwtSecret: randomBytes(32), refreshTokenSecret: randomBytes(32) },
    phoneSecrets: () => requireSecrets(),
    hmr: false,
    logRequests: false,
    limiters: {
      ...createLimiters(),
      authIp: new RateLimiterMemory({ keyPrefix: "auth_ip_test", points: 1000, duration: 60 }),
      loginEmail: new RateLimiterMemory({ keyPrefix: "login_email_test", points: 1000, duration: 60 }),
    },
  });
});

afterAll(async () => {
  await server?.close();
  await db?.destroy();
});

const cookieOf = (res: request.Response) => ((res.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");

async function login(email: string, password = DEV_PASSWORD): Promise<string> {
  const res = await request(server.app).post("/api/v1/auth/login").set("Origin", BASE).send({ email, password });
  expect(res.status, `login ${email}`).toBe(200);
  return cookieOf(res);
}

const get = (path: string, cookie?: string) => {
  const r = request(server.app).get(path);
  return cookie ? r.set("Cookie", cookie) : r;
};
const post = (path: string, cookie: string, form: Record<string, string>) =>
  // A browser's Host matches its Origin; React Router refuses document POSTs where they differ.
  request(server.app).post(path).set("Host", new URL(BASE).host).set("Origin", BASE).set("Cookie", cookie).type("form").send(form);

describe("back-office pages", () => {
  it("visitors log in first; listers get 403; supervisors cannot manage supervisors", async () => {
    const anon = await get("/ar/backoffice");
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe("/ar/login?next=%2Far%2Fbackoffice");
    expect((await get("/ar/backoffice", await login("owner1@aqar.test"))).status).toBe(403);
    expect((await get("/en/backoffice", await login("agent1@aqar.test"))).status).toBe(403);

    const sup = await login("sup.amman@aqar.test");
    const home = await get("/ar/backoffice", sup);
    expect(home.status).toBe(200);
    expect(home.text).toContain("إعلانات قيد المراجعة مسندة إليّ");
    expect(home.text).not.toContain('href="/ar/backoffice/supervisors"');
    expect((await get("/ar/backoffice/supervisors", sup)).status).toBe(403);
    // A deactivated supervisor (fresh login) is refused.
    const id = (await db("users").where({ email: "sup.amman@aqar.test" }).first("id")).id;
    try {
      await db("supervisor_profiles").where({ user_id: id }).update({ is_active: false });
      expect((await get("/ar/backoffice", await login("sup.amman@aqar.test"))).status).toBe(403);
    } finally {
      await db("supervisor_profiles").where({ user_id: id }).update({ is_active: true });
    }
  });

  it("super_admin screens in both languages: private, noindex, no lister phones in the HTML", async () => {
    const admin = await login("admin@aqar.test");
    const sup = await db("users").where({ email: "sup.regions@aqar.test" }).first("id");
    const key = requireSecrets().encryptionKey;
    const listerPhones = (await db("properties").pluck("owner_phone_encrypted")).map((p: string) => decrypt(p, key).slice(4));
    for (const lang of ["ar", "en"]) {
      for (const path of [`/${lang}/backoffice`, `/${lang}/backoffice/supervisors`, `/${lang}/backoffice/supervisors/new`, `/${lang}/backoffice/supervisors/${sup.id}`]) {
        const res = await get(path, admin);
        expect(res.status, path).toBe(200);
        expect(res.headers["cache-control"], path).toBe("private, no-store");
        expect(res.headers["x-robots-tag"], path).toBe("noindex");
        expect(res.text).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
        expect(res.text).not.toContain("scrypt$");
        for (const p of listerPhones) expect(res.text).not.toContain(p);
      }
    }
    const detail = await get(`/en/backoffice/supervisors/${sup.id}`, admin);
    expect(detail.text).toContain("+962790000102");
    expect(detail.text).toContain('name="areaId"');
    expect((await get("/en/backoffice/supervisors/999999", admin)).status).toBe(404);
  });

  it("creates a supervisor through the page; the one-time password forces a change before anything else", async () => {
    const admin = await login("admin@aqar.test");
    const created = await post("/en/backoffice/supervisors/new", admin, { name: "Page Supervisor", email: "page.sup@aqar.test", workPhone: "0790000155", phoneCountry: "JO" });
    expect(created.status).toBe(200);
    expect(created.headers["cache-control"]).toBe("private, no-store");
    const otp = /([A-Za-z2-9]{5}(?:-[A-Za-z2-9]{5}){3})/.exec(created.text)?.[1];
    expect(otp).toBeDefined();
    expect(created.text).toContain("shown only once");

    const cookie = await login("page.sup@aqar.test", otp!);
    for (const path of ["/en/jo/map", "/en/backoffice", "/ar/backoffice"]) {
      const res = await get(path, cookie);
      expect(res.status, path).toBe(302);
      expect(res.headers.location).toMatch(/^\/(ar|en)\/account\/password$/);
    }
    expect((await post("/en/listings/new", cookie, { category: "apartment", listingType: "sale" })).status).toBe(403);
    const page = await get("/en/account/password", cookie);
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("private, no-store");
    expect(page.text).toContain("one-time password");

    const wrong = await post("/en/account/password", cookie, { currentPassword: "nope", newPassword: "page-sup-password", confirmPassword: "page-sup-password" });
    expect(wrong.status).toBe(401);
    const done = await post("/en/account/password", cookie, { currentPassword: otp!, newPassword: "page-sup-password", confirmPassword: "page-sup-password" });
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe("/en/backoffice");
    expect((await get("/en/backoffice", cookie)).status).toBe(200);
  });

  it("page actions: deactivation needs a reason; password reset shows a new one-time password once", async () => {
    const admin = await login("admin@aqar.test");
    const sup = await db("users").where({ email: "sup.regions@aqar.test" }).first("id");
    const path = `/en/backoffice/supervisors/${sup.id}`;
    const noReason = await post(path, admin, { intent: "status", active: "false", reason: "" });
    expect(noReason.status).toBe(400);
    expect(noReason.text).toContain("Enter a reason");
    expect((await db("supervisor_profiles").where({ user_id: sup.id }).first("is_active")).is_active).toBe(true);

    const reset = await post(path, admin, { intent: "password" });
    expect(reset.status).toBe(200);
    expect(reset.text).toContain("New one-time password issued");
    const otp = /([A-Za-z2-9]{5}(?:-[A-Za-z2-9]{5}){3})/.exec(reset.text)?.[1];
    expect(otp).toBeDefined();
    await expect(login("sup.regions@aqar.test")).rejects.toThrow();
    // Shown once: the page itself does not carry it afterwards.
    expect((await get(path, admin)).text).not.toContain(otp!);
  });
});
