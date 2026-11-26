import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF check (SPEC §13): cookies are SameSite=Lax, and every state-changing
 * request must come from one of our origins. Uses `Origin`, then
 * `Sec-Fetch-Site`, then `Referer`; a request with none of them is refused.
 */
export function isAllowedOrigin(headers: IncomingHttpHeaders, allowed: ReadonlySet<string>): boolean {
  const origin = headers.origin;
  if (typeof origin === "string" && origin !== "null") return allowed.has(origin);
  const site = headers["sec-fetch-site"];
  if (typeof site === "string") return site === "same-origin";
  const referer = originOf(headers.referer);
  return referer !== null && allowed.has(referer);
}

export function originCheck(allowedOrigins: Iterable<string>): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || isAllowedOrigin(req.headers, allowed)) {
      next();
      return;
    }
    if (req.path.startsWith("/api/")) res.status(403).json({ error: "forbidden_origin" });
    else res.status(403).type("text/plain").send("Forbidden");
  };
}
