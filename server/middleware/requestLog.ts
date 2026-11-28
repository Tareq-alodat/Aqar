import type { IncomingMessage } from "node:http";
import morgan from "morgan";

/**
 * Request logging without the visitor's location (SPEC §5.6): "near me"
 * (`near`) is never logged, and neither are map-centre coordinates (`lat`,
 * `lng`), which follow the visitor's location after "near me" (the map page
 * and /api/v1/areas/at).
 */
const LOCATION_PARAMS = new Set(["near", "lat", "lng"]);

export function redactLocation(url: string): string {
  const qAt = url.indexOf("?");
  if (qAt === -1) return url;
  const params = new URLSearchParams(url.slice(qAt + 1));
  let changed = false;
  for (const key of [...params.keys()]) {
    if (LOCATION_PARAMS.has(key)) {
      params.set(key, "redacted");
      changed = true;
    }
  }
  return changed ? `${url.slice(0, qAt)}?${params.toString()}` : url;
}

/** morgan with the `:url` token redacted. */
export function requestLogger(isProduction: boolean) {
  morgan.token("url", (req: IncomingMessage & { originalUrl?: string }) => redactLocation(req.originalUrl ?? req.url ?? ""));
  return morgan(isProduction ? "tiny" : "dev");
}
