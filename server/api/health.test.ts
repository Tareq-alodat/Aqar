import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApiRouter } from "./index";

function makeApp(isProduction: boolean) {
  const checkDatabase = vi.fn().mockResolvedValue("ok" as const);
  const app = express();
  app.use("/api/v1", createApiRouter({ isProduction, checkDatabase }));
  return { app, checkDatabase };
}

describe("GET /api/v1/health", () => {
  it("returns only the status in production", async () => {
    const { app, checkDatabase } = makeApp(true);
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it("includes details in development", async () => {
    const { app } = makeApp(false);
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "ok" });
    expect(res.body).toHaveProperty("uptimeSeconds");
    expect(res.body).toHaveProperty("node");
  });

  it("reports an unreachable database without failing", async () => {
    const app = express();
    app.use(
      "/api/v1",
      createApiRouter({
        isProduction: false,
        checkDatabase: vi.fn().mockResolvedValue("unreachable" as const),
      }),
    );
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("unreachable");
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const { app } = makeApp(true);
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });
});
