import { randomBytes } from "node:crypto";
import express from "express";
import type { Knex } from "knex";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/test/testDb";
import { originCheck } from "../middleware/originCheck";
import { createAuthCookies } from "../services/authCookies";
import { createAuthService } from "../services/authService";
import { createLimiters } from "../services/rateLimitService";
import { createApiRouter } from "./index";
import { truncateForDev } from "../db/devTruncate";

const ORIGIN = "http://aqar.test";
let db: Knex;
let app: express.Express;
let now: Date;

function buildApp() {
  const limiters = createLimiters();
  const service = createAuthService({
    db,
    secrets: { jwtSecret: randomBytes(32), refreshTokenSecret: randomBytes(32) },
    limiters,
    phoneSecrets: () => ({ encryptionKey: randomBytes(32), phoneHashKey: randomBytes(32) }),
    passwords: {
      hash: async (pw) => `fake$${pw}`,
      verify: async (pw, stored) => stored === `fake$${pw}`,
      needsRehash: () => false,
    },
    now: () => now,
  });
  const a = express();
  a.use(originCheck([ORIGIN]));
  a.use(
    "/api/v1",
    createApiRouter({
      isProduction: true,
      checkDatabase: vi.fn().mockResolvedValue("ok" as const),
      auth: { service, cookies: createAuthCookies({ secure: false }) },
      limiters,
    }),
  );
  return a;
}

/** "name=value" pairs from Set-Cookie, for the next request. */
function cookieHeader(res: request.Response): string {
  const set = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (set ?? [])
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c && !c.endsWith("="))
    .join("; ");
}

const post = (path: string) => request(app).post(`/api/v1/auth${path}`).set("Origin", ORIGIN);
const account = { name: "Api User", email: "api@aqar.test", password: "correct-password", phone: "0791234567" };

beforeAll(() => {
  db = createTestDb();
});
afterAll(async () => {
  await truncateForDev(db, ["refresh_tokens", "users"]);
  await db.destroy();
});
beforeEach(async () => {
  await truncateForDev(db, ["refresh_tokens", "users"]);
  now = new Date("2026-12-01T10:00:00Z");
  app = buildApp();
});

describe("/api/v1/auth", () => {
  it("registers, returning only the account's own allow-listed fields", async () => {
    const res = await post("/register").send(account);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.user).sort()).toEqual(["companyId", "email", "id", "locale", "mustChangePassword", "name", "role"]);
    expect(res.body.user).toMatchObject({ email: "api@aqar.test", role: "owner" });
    expect(JSON.stringify(res.body)).not.toMatch(/phone|hash|791234567/);
    expect(cookieHeader(res)).toMatch(/aqar_at=.+; aqar_rt=.+/);
  });

  it("reports invalid fields and a taken email", async () => {
    const bad = await post("/register").send({ name: "A", email: "x", password: "short", phone: "0761234567" });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({
      error: "invalid_input",
      fields: { name: "name_invalid", email: "email_invalid", password: "password_too_short", phone: "phone_invalid" },
    });
    await post("/register").send(account);
    const dup = await post("/register").send({ ...account, email: "API@aqar.test" });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: "email_taken" });
  });

  it("logs in, serves /me, refreshes and logs out", async () => {
    await post("/register").send(account);
    expect((await post("/login").send({ email: account.email, password: "wrong" })).status).toBe(401);

    const login = await post("/login").send({ email: account.email, password: account.password });
    expect(login.status).toBe(200);
    const cookies = cookieHeader(login);

    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookies);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(account.email);
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);

    const refreshed = await post("/refresh").set("Cookie", cookies);
    expect(refreshed.status).toBe(200);
    const newCookies = cookieHeader(refreshed);
    expect(newCookies).not.toBe(cookies);

    const out = await post("/logout").set("Cookie", newCookies);
    expect(out.status).toBe(204);
    expect((out.headers["set-cookie"] as unknown as string[]).join("\n")).toMatch(/aqar_at=;.*Max-Age=0/);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", newCookies)).status).toBe(401);
  });

  it("refuses a refresh without a valid token and clears cookies", async () => {
    const res = await post("/refresh").set("Cookie", "aqar_rt=garbage");
    expect(res.status).toBe(401);
    expect((res.headers["set-cookie"] as unknown as string[]).join("\n")).toMatch(/aqar_rt=;/);
  });

  it("refuses state-changing requests from other origins (CSRF)", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("Origin", "https://evil.example").send(account);
    expect(res.status).toBe(403);
    expect((await request(app).post("/api/v1/auth/login").send(account)).status).toBe(403);
  });

  it("answers malformed JSON with 400", async () => {
    const res = await post("/login").set("Content-Type", "application/json").send("{nope");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
  });

  it("limits login to 5 per minute per IP with Retry-After", async () => {
    for (let i = 0; i < 5; i++) await post("/login").send({ email: "x@aqar.test", password: "whatever" });
    const res = await post("/login").send({ email: "x@aqar.test", password: "whatever" });
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("limits the API to 100 requests per minute per IP", async () => {
    for (let i = 0; i < 100; i++) expect((await request(app).get("/api/v1/health")).status).toBe(200);
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
  });
});
