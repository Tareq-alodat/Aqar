import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { apiPasswordGate, pageActionGate } from "./passwordChangeGate";

function appWith(mustChangePassword: boolean | null) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.session =
      mustChangePassword === null
        ? null
        : { familyId: "f", user: { id: 1, name: "S", email: "s@x", role: "supervisor", locale: "ar", companyId: null, mustChangePassword } };
    next();
  });
  const api = express.Router();
  api.use(apiPasswordGate);
  api.all(/.*/, (_req, res) => void res.json({ ok: true }));
  app.use("/api/v1", api);
  app.use(pageActionGate);
  app.all(/.*/, (_req, res) => void res.send("page"));
  return app;
}

describe("password change gates (milestone 7a)", () => {
  it("API: only password, me, refresh, logout and health while a one-time password is pending", async () => {
    const app = appWith(true);
    for (const path of ["/auth/password", "/auth/me", "/auth/logout", "/auth/refresh", "/health"]) {
      expect((await request(app).post(`/api/v1${path}`)).status, path).toBe(200);
    }
    for (const path of ["/backoffice/supervisors", "/my/listings", "/map/points", "/listings/1", "/auth/passwordx"]) {
      const res = await request(app).get(`/api/v1${path}`);
      expect(res.status, path).toBe(403);
      expect(res.body).toEqual({ error: "password_change_required" });
    }
  });

  it("pages: form submissions are refused except the change-password page, logout and theme; GETs pass to the loaders", async () => {
    const app = appWith(true);
    for (const path of ["/ar/account/password", "/en/account/password.data", "/logout", "/theme"]) {
      expect((await request(app).post(path)).status, path).toBe(200);
    }
    for (const path of ["/ar/backoffice/supervisors/new", "/en/listings/new", "/ar/login"]) {
      const res = await request(app).post(path);
      expect(res.status, path).toBe(403);
      expect(res.text).toBe("password_change_required");
    }
    expect((await request(app).get("/ar/backoffice")).status).toBe(200);
  });

  it("does nothing for other users and visitors", async () => {
    for (const app of [appWith(false), appWith(null)]) {
      expect((await request(app).get("/api/v1/backoffice/supervisors")).status).toBe(200);
      expect((await request(app).post("/ar/listings/new")).status).toBe(200);
    }
  });
});
