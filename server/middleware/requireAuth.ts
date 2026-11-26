import type { RequestHandler } from "express";
import type { Role } from "../../app/shared/constants";

/** 401 unless `authenticate` found a session. */
export const requireAuth: RequestHandler = (_req, res, next) => {
  if (!res.locals.session) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  next();
};

/** 401 without a session, 403 unless the user has one of `roles` (read from the database on this request). */
export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const session = res.locals.session;
    if (!session) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!roles.includes(session.user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
