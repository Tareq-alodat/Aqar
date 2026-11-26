import { createHmac, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { ROLES, type Role } from "../../app/shared/constants";

/**
 * Tokens and session policy (SPEC §13).
 *
 * - Access token: HS256 JWT, 15 minutes, claims `sub` (user id), `role`, `sid`
 *   (refresh-token family). Only a session pointer: the user and the family
 *   are checked in the database on every request.
 * - Refresh token: 32 random bytes (base64url), never stored; the database
 *   keeps an HMAC-SHA256 of it keyed with REFRESH_TOKEN_SECRET.
 */

export const ACCESS_TOKEN_TTL_S = 15 * 60;
const ISSUER = "aqar";
const AUDIENCE = "aqar";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sliding idle expiry and absolute family cap per role (decided for milestone 3). */
export const SESSION_POLICY: Record<Role, { idleMs: number; absoluteMs: number }> = {
  admin: { idleMs: 1 * DAY_MS, absoluteMs: 7 * DAY_MS },
  agent: { idleMs: 30 * DAY_MS, absoluteMs: 90 * DAY_MS },
  owner: { idleMs: 30 * DAY_MS, absoluteMs: 90 * DAY_MS },
};

/**
 * A rotated refresh token presented again within this window is treated as a
 * concurrent request from the same browser (e.g. two tabs), not as theft.
 */
export const ROTATION_GRACE_MS = 30 * 1000;

/** Expiry of a refresh token issued now: idle window, never past the family's absolute cap. */
export function refreshExpiry(role: Role, familyStartedAt: Date, now: Date): Date {
  const policy = SESSION_POLICY[role];
  return new Date(Math.min(now.getTime() + policy.idleMs, familyStartedAt.getTime() + policy.absoluteMs));
}

export function familyCapReached(role: Role, familyStartedAt: Date, now: Date): boolean {
  return now.getTime() >= familyStartedAt.getTime() + SESSION_POLICY[role].absoluteMs;
}

export interface AccessClaims {
  userId: number;
  role: Role;
  familyId: string;
}

const claimsSchema = z.object({
  sub: z.string().regex(/^[1-9]\d{0,9}$/),
  role: z.enum(ROLES),
  sid: z.uuid(),
});

export async function signAccessToken(claims: AccessClaims, secret: Buffer, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: claims.role, sid: claims.familyId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(claims.userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_S)
    .sign(secret);
}

/** Claims of a valid, unexpired access token, or null (never throws). */
export async function verifyAccessToken(token: string, secret: Buffer, now: Date): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
    });
    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) return null;
    return { userId: Number(parsed.data.sub), role: parsed.data.role, familyId: parsed.data.sid };
  } catch {
    return null;
  }
}

export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lookup key for a refresh token (the token itself is never stored). */
export function hashRefreshToken(token: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(`refresh:${token}`).digest("hex");
}

/** Keyed hash of the client IP for refresh_tokens.ip_hash (no raw IPs stored). */
export function hashIp(ip: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("hex");
}

/** Shape check before hashing/looking up a cookie value. */
export function looksLikeRefreshToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
