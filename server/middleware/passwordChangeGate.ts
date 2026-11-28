import type { RequestHandler } from "express";

/**
 * While a user must change their one-time password (milestone 7a), they may
 * only change it, see who they are, refresh and log out. Everything else is
 * refused with 403 `password_change_required`:
 * - `apiPasswordGate` on `/api/v1` (paths relative to the mount);
 * - `pageActionGate` on page form submissions (POST/PUT/PATCH/DELETE).
 * Page loaders redirect to the change-password page instead (`requireUser`
 * and the `/:lang` layout loader).
 */

const API_ALLOWED = new Set(["/auth/password", "/auth/me", "/auth/logout", "/auth/refresh", "/health"]);

export const apiPasswordGate: RequestHandler = (req, res, next) => {
  if (!res.locals.session?.user.mustChangePassword || API_ALLOWED.has(req.path.replace(/\/+$/, ""))) return next();
  res.status(403).json({ error: "password_change_required" });
};

/** The change-password page (document or single-fetch `.data` request), logout and the theme toggle. */
const PAGE_ALLOWED = /^\/(?:(?:ar|en)\/account\/password(?:\.data)?|logout|theme)\/?$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const pageActionGate: RequestHandler = (req, res, next) => {
  if (!res.locals.session?.user.mustChangePassword || SAFE_METHODS.has(req.method) || PAGE_ALLOWED.test(req.path)) return next();
  res.status(403).type("text/plain").send("password_change_required");
};
