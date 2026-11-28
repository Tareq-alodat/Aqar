import { createHmac, randomBytes } from "node:crypto";
import { stringifySetCookie } from "cookie";
import type { Knex } from "knex";
import { isStaffRole } from "../../app/shared/constants";
import { isPublicStatus, type Viewer } from "./listingService";

/**
 * View counting (SPEC §10; milestone 5 decision). The page reports the view
 * from the browser after it loads (so bots, prefetches and server renders do
 * not count). Counted at most once per visitor per listing per rolling 24 h;
 * never for the listing's owner or admins; only for publicly visible listings
 * (published, reserved, sold, rented — never drafts or other previews).
 * The visitor is an HMAC of the first-party `aqar_vid` cookie (or of the IP
 * when cookies are off) — raw ids are never stored.
 */

export const VISITOR_COOKIE = "aqar_vid";
export const VIEW_WINDOW_HOURS = 24;

export function newVisitorId(): string {
  return randomBytes(16).toString("base64url");
}

export function looksLikeVisitorId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{22}$/.test(v);
}

/** Settings for view counting, created once in server/createServer.ts. */
export interface ViewConfig {
  /** HMAC key for visitor hashes (REFRESH_TOKEN_SECRET). */
  secret: Buffer;
  /** https → Secure cookie. */
  secure: boolean;
}

/** Set-Cookie for a new visitor id: first-party, httpOnly, one year. */
export function visitorCookie(id: string, secure: boolean): string {
  return stringifySetCookie({
    name: VISITOR_COOKIE,
    value: id,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 365 * 24 * 60 * 60,
  });
}

export function visitorHash(visitor: { cookieId?: string | undefined; ip: string }, secret: Buffer): string {
  const key = looksLikeVisitorId(visitor.cookieId) ? `vid:${visitor.cookieId}` : `ip:${visitor.ip}`;
  return createHmac("sha256", secret).update(`view:${key}`).digest("hex");
}

/** Records a view; true when it was counted. */
export async function recordView(
  db: Knex,
  input: { propertyId: number; visitorHash: string; viewer: Viewer | null; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (trx) => {
    const p = await trx("properties").where({ id: input.propertyId }).first("owner_id", "status");
    if (!p || !isPublicStatus(p.status)) return false;
    // The owner's and back-office staff's own views are not counted.
    if (input.viewer && (input.viewer.userId === p.owner_id || isStaffRole(input.viewer.role))) return false;

    const inserted = await trx.raw<{ rowCount: number }>(
      `INSERT INTO property_views (property_id, visitor_hash, view_date, viewed_at)
       SELECT ?, ?, (?::timestamptz)::date, ?::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM property_views
           WHERE property_id = ? AND visitor_hash = ?
             AND viewed_at > ?::timestamptz - make_interval(hours => ?))
       ON CONFLICT DO NOTHING`,
      [input.propertyId, input.visitorHash, now, now, input.propertyId, input.visitorHash, now, VIEW_WINDOW_HOURS],
    );
    if (!inserted.rowCount) return false;
    await trx("properties").where({ id: input.propertyId }).increment("view_count", 1);
    return true;
  });
}
