import type { Request, RequestHandler } from "express";
import type { RateLimiterMemory } from "rate-limiter-flexible";
import { take } from "../services/rateLimitService";

/** Per-IP limit for a router; 429 with Retry-After when exceeded. `skip` exempts requests counted by another limiter. */
export function rateLimit(limiter: RateLimiterMemory, options: { skip?: (req: Request) => boolean } = {}): RequestHandler {
  return async (req, res, next) => {
    if (options.skip?.(req)) {
      next();
      return;
    }
    try {
      const result = await take(limiter, req.ip ?? "unknown");
      if (result.ok) {
        next();
        return;
      }
      res.set("Retry-After", String(result.retryAfterS)).status(429).json({ error: "rate_limited" });
    } catch (error) {
      next(error);
    }
  };
}
