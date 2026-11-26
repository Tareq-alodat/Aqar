import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { isAllowedOrigin, originCheck } from "./originCheck";

const allowed = new Set(["https://aqar.example"]);

describe("isAllowedOrigin", () => {
  it.each([
    [{ origin: "https://aqar.example" }, true],
    [{ origin: "https://evil.example" }, false],
    [{ origin: "null", "sec-fetch-site": "cross-site" }, false],
    [{ "sec-fetch-site": "same-origin" }, true],
    [{ "sec-fetch-site": "same-site" }, false],
    [{ "sec-fetch-site": "cross-site", referer: "https://aqar.example/ar" }, false],
    [{ referer: "https://aqar.example/ar/login" }, true],
    [{ referer: "https://evil.example/" }, false],
    [{}, false],
  ])("%j → %s", (headers, expected) => {
    expect(isAllowedOrigin(headers, allowed)).toBe(expected);
  });
});

describe("originCheck middleware", () => {
  const app = express();
  app.use(originCheck(allowed));
  app.all("/{*path}", (_req, res) => {
    res.json({ ok: true });
  });

  it("lets safe methods through", async () => {
    expect((await request(app).get("/ar/login")).status).toBe(200);
  });

  it("allows same-origin POSTs", async () => {
    expect((await request(app).post("/api/v1/auth/login").set("Origin", "https://aqar.example")).status).toBe(200);
  });

  it("refuses cross-origin and header-less POSTs (JSON for the API, text for pages)", async () => {
    const api = await request(app).post("/api/v1/auth/login").set("Origin", "https://evil.example");
    expect(api.status).toBe(403);
    expect(api.body).toEqual({ error: "forbidden_origin" });
    const page = await request(app).post("/theme");
    expect(page.status).toBe(403);
    expect(page.text).toBe("Forbidden");
    expect((await request(app).delete("/api/v1/x").set("Origin", "https://evil.example")).status).toBe(403);
  });
});
