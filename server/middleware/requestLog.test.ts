import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { redactLocation, requestLogger } from "./requestLog";

describe("redactLocation", () => {
  it("removes near, lat and lng values and keeps the rest", () => {
    expect(redactLocation("/api/v1/listings?country=JO&near=35.871,31.957&radius=5&q=villa")).toBe(
      "/api/v1/listings?country=JO&near=redacted&radius=5&q=villa",
    );
    expect(redactLocation("/ar/jo/map?lat=31.95&lng=35.91&z=12")).toBe("/ar/jo/map?lat=redacted&lng=redacted&z=12");
    expect(redactLocation("/api/v1/health")).toBe("/api/v1/health");
    expect(redactLocation("/ar/jo/map?type=sale")).toBe("/ar/jo/map?type=sale");
  });
});

describe("requestLogger", () => {
  it("never writes the location to the log", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const app = express();
      app.use(requestLogger(true));
      app.get("/x", (_req, res) => void res.send("ok"));
      await request(app).get("/x?near=35.871%2C31.957&lat=31.9571&lng=35.8712");
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      spy.mockRestore();
    }
    const log = lines.join("");
    expect(log).toContain("/x?near=redacted");
    expect(log).not.toMatch(/35\.87|31\.95/);
  });
});
