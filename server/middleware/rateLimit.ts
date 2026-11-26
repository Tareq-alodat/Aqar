import type { RequestHandler } from "express";
import type { RateLimiterMemory } from "rate-limiter-flexible";
import { take } from "../services/rateLimitService";

/** Per-IP limit for a router; 429 with Retry-After when exceeded. */
export function rateLimit(limiter: RateLimiterMemory): RequestHandler {
  return async (req, res, next) => {
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
