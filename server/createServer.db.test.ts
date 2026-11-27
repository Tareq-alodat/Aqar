import { randomBytes } from "node:crypto";
import type { Knex } from "knex";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type AqarServer } from "./createServer";
import { createTestDb } from "./db/test/testDb";

/**
 * The development server setup end to end (hotfix: pages failed with "App
 * services are not set" when the dev server process was older than the code
 * Vite served). Builds the real dev app — Vite middleware, React Router
 * handler, auth — against the test database and requests pages.
 */

let db: Knex;
let server: AqarServer;

beforeAll(async () => {
  db = createTestDb();
  server = await createServer({
    isProduction: false,
    port: 3999,
    publicBaseUrl: "http://localhost:3999",
    uploadDir: "./uploads",
    db,
    authSecrets: { jwtSecret: randomBytes(32), refreshTokenSecret: randomBytes(32) },
    phoneSecrets: () => ({ encryptionKey: randomBytes(32), phoneHashKey: randomBytes(32) }),
    hmr: false, // no websocket port: tests must not clash with a running dev server
    logRequests: false,
  });
});

afterAll(async () => {
  await server?.close();
  await db?.destroy();
});

describe("development server", () => {
  it("renders the map page with its loaders' data", async () => {
    const res = await request(server.app).get("/ar/jo/map");
    expect(res.status).toBe(200);
    expect(res.text).toContain('dir="rtl"');
    expect(res.text).toContain("<title>البحث على الخريطة | عقار</title>");
    expect(res.text).not.toContain("App services are not set");
  });

  it("renders the English login page and the redirect from /", async () => {
    const login = await request(server.app).get("/en/login");
    expect(login.status).toBe(200);
    expect(login.text).toContain('name="password"');
    const root = await request(server.app).get("/");
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe("/ar/jo/map");
  });

  it("serves the API next to the pages", async () => {
    const res = await request(server.app).get("/api/v1/health");
    expect(res.status).toBe(200);
  });
});
