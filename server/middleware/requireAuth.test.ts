import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Role } from "../../app/shared/constants";
import { requireAuth, requireRole } from "./requireAuth";

function appAs(role: Role | null) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.session = role
      ? { familyId: "f", user: { id: 1, name: "U", email: "u@x", role, locale: "ar", companyId: null } }
      : null;
    next();
  });
  app.get("/me", requireAuth, (_req, res) => res.json({ ok: true }));
  app.get("/admin", requireRole("admin"), (_req, res) => res.json({ ok: true }));
  app.get("/listings", requireRole("agent", "owner"), (_req, res) => res.json({ ok: true }));
  return app;
}

describe("requireAuth / requireRole", () => {
  it("401 without a session", async () => {
    const app = appAs(null);
    expect((await request(app).get("/me")).status).toBe(401);
    expect((await request(app).get("/admin")).body).toEqual({ error: "unauthenticated" });
  });

  it("403 for the wrong role, 200 for the right one", async () => {
    expect((await request(appAs("owner")).get("/admin")).status).toBe(403);
    expect((await request(appAs("admin")).get("/admin")).status).toBe(200);
    expect((await request(appAs("agent")).get("/listings")).status).toBe(200);
    expect((await request(appAs("admin")).get("/listings")).status).toBe(403);
    expect((await request(appAs("owner")).get("/me")).status).toBe(200);
  });
});
