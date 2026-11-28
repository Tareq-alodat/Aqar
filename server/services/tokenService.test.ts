import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_S,
  familyCapReached,
  hashRefreshToken,
  looksLikeRefreshToken,
  newRefreshToken,
  refreshExpiry,
  SESSION_POLICY,
  signAccessToken,
  verifyAccessToken,
} from "./tokenService";

const secret = randomBytes(32);
const now = new Date("2026-12-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const claims = { userId: 42, role: "owner" as const, familyId: randomUUID() };

describe("access tokens", () => {
  it("round-trips the claims", async () => {
    const token = await signAccessToken(claims, secret, now);
    expect(await verifyAccessToken(token, secret, now)).toEqual(claims);
  });

  it("expires after 15 minutes", async () => {
    const token = await signAccessToken(claims, secret, now);
    const later = (s: number) => new Date(now.getTime() + s * 1000);
    expect(await verifyAccessToken(token, secret, later(ACCESS_TOKEN_TTL_S - 1))).not.toBeNull();
    expect(await verifyAccessToken(token, secret, later(ACCESS_TOKEN_TTL_S + 1))).toBeNull();
  });

  it("rejects another key, a tampered payload and junk", async () => {
    const token = await signAccessToken(claims, secret, now);
    expect(await verifyAccessToken(token, randomBytes(32), now)).toBeNull();
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    payload.role = "super_admin";
    const forged = [h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join(".");
    expect(await verifyAccessToken(forged, secret, now)).toBeNull();
    expect(await verifyAccessToken("not-a-jwt", secret, now)).toBeNull();
  });

  it("rejects alg=none tokens", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(now.getTime() / 1000) + 600;
    const none = `${enc({ alg: "none" })}.${enc({ sub: "1", role: "super_admin", sid: randomUUID(), iss: "aqar", aud: "aqar", exp })}.`;
    expect(await verifyAccessToken(none, secret, now)).toBeNull();
  });
});

describe("session policy", () => {
  it("is 30 days idle / 90 absolute, and 1 / 7 for staff and financiers", () => {
    expect(SESSION_POLICY.owner).toEqual({ idleMs: 30 * DAY, absoluteMs: 90 * DAY });
    expect(SESSION_POLICY.agent).toEqual({ idleMs: 30 * DAY, absoluteMs: 90 * DAY });
    for (const role of ["super_admin", "supervisor", "financier"] as const) {
      expect(SESSION_POLICY[role]).toEqual({ idleMs: 1 * DAY, absoluteMs: 7 * DAY });
    }
  });

  it("slides the expiry but never past the family cap", () => {
    const start = now;
    expect(refreshExpiry("owner", start, now).getTime()).toBe(now.getTime() + 30 * DAY);
    const day80 = new Date(start.getTime() + 80 * DAY);
    expect(refreshExpiry("owner", start, day80).getTime()).toBe(start.getTime() + 90 * DAY);
    const day6 = new Date(start.getTime() + 6.5 * DAY);
    expect(refreshExpiry("supervisor", start, day6).getTime()).toBe(start.getTime() + 7 * DAY);
  });

  it("detects a family past its cap", () => {
    expect(familyCapReached("owner", now, new Date(now.getTime() + 90 * DAY - 1))).toBe(false);
    expect(familyCapReached("owner", now, new Date(now.getTime() + 90 * DAY))).toBe(true);
    expect(familyCapReached("super_admin", now, new Date(now.getTime() + 7 * DAY))).toBe(true);
  });
});

describe("refresh tokens", () => {
  it("are 256-bit base64url and hashed with the key", () => {
    const token = newRefreshToken();
    expect(looksLikeRefreshToken(token)).toBe(true);
    expect(newRefreshToken()).not.toBe(token);
    expect(hashRefreshToken(token, secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token, secret)).not.toBe(hashRefreshToken(token, randomBytes(32)));
  });

  it("rejects malformed cookie values", () => {
    for (const v of [undefined, "", "short", "x".repeat(43) + "!", 42]) expect(looksLikeRefreshToken(v)).toBe(false);
  });
});
