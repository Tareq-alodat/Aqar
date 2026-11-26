import type { Request, RequestHandler, Response } from "express";
import type { AuthCookies } from "../services/authCookies";
import type { AuthService, IssuedTokens, RequestMeta, Session } from "../services/authService";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Set by `authenticate`: the signed-in session, or null. */
      session?: Session | null;
    }
  }
}

export function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip ?? req.socket.remoteAddress ?? "unknown", userAgent: req.get("user-agent") };
}

export function appendCookies(res: Response, cookies: string[]) {
  for (const cookie of cookies) res.append("Set-Cookie", cookie);
}

export function setSessionCookies(res: Response, cookies: AuthCookies, issued: IssuedTokens) {
  appendCookies(res, cookies.issue(issued, new Date()));
}

/**
 * Resolves the session for every API and page request (SPEC §13): checks the
 * access token, rotates the refresh token when the access token has expired,
 * and clears cookies that are no longer valid. Static files are served before
 * this runs, so they cost no database query.
 */
export function authenticate(auth: AuthService, cookies: AuthCookies): RequestHandler {
  return async (req, res, next) => {
    try {
      const result = await auth.resolve(cookies.read(req.headers.cookie), requestMeta(req));
      if (result.issued) setSessionCookies(res, cookies, result.issued);
      else if (result.clearCookies) appendCookies(res, cookies.clear());
      res.locals.session = result.session;
      next();
    } catch (error) {
      next(error);
    }
  };
}
