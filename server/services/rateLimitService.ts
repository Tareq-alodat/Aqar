import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

/**
 * Rate limits (SPEC §13), in memory: one Node process on one VPS. Counters
 * reset on restart, which is acceptable for these limits.
 */
export const LIMITS = {
  /** Every /api/v1 request except those with their own limit below, per IP. */
  api: { points: 100, duration: 60 },
  /** /api/v1/map/points (GET and POST), per IP — its own limit, not counted in `api` (milestone 4 decision). */
  mapPoints: { points: 60, duration: 60 },
  /** GET /api/v1/areas/suggest (location autocomplete while typing), per IP — its own limit (milestone 4b). */
  areasSuggest: { points: 120, duration: 60 },
  /** POST /api/v1/listings/:id/view (the page's view beacon), per IP — its own limit (milestone 5). */
  views: { points: 30, duration: 60 },
  /** Photo uploads (POST /api/v1/my/listings/:id/images), per user — image processing is the expensive part (milestone 6). */
  uploads: { points: 30, duration: 60 },
  /** Login and register attempts (API and page forms share it), per IP. */
  authIp: { points: 5, duration: 60 },
  /** Failed logins per email, against guessing spread over many IPs. */
  loginEmail: { points: 10, duration: 15 * 60 },
} as const;

export type LimiterName = keyof typeof LIMITS;
export type Limiters = Record<LimiterName, RateLimiterMemory>;

export function createLimiters(): Limiters {
  return {
    api: new RateLimiterMemory({ keyPrefix: "api", ...LIMITS.api }),
    mapPoints: new RateLimiterMemory({ keyPrefix: "map_points", ...LIMITS.mapPoints }),
    areasSuggest: new RateLimiterMemory({ keyPrefix: "areas_suggest", ...LIMITS.areasSuggest }),
    views: new RateLimiterMemory({ keyPrefix: "views", ...LIMITS.views }),
    uploads: new RateLimiterMemory({ keyPrefix: "uploads", ...LIMITS.uploads }),
    authIp: new RateLimiterMemory({ keyPrefix: "auth_ip", ...LIMITS.authIp }),
    loginEmail: new RateLimiterMemory({ keyPrefix: "login_email", ...LIMITS.loginEmail }),
  };
}

export type LimitResult = { ok: true } | { ok: false; retryAfterS: number };

const retryAfter = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Uses one point; `ok: false` once the limit is exceeded. */
export async function take(limiter: RateLimiterMemory, key: string): Promise<LimitResult> {
  try {
    await limiter.consume(key);
    return { ok: true };
  } catch (res) {
    if (res instanceof RateLimiterRes) return { ok: false, retryAfterS: retryAfter(res.msBeforeNext) };
    throw res;
  }
}

/** Whether the key has already used all its points (does not use one). */
export async function check(limiter: RateLimiterMemory, key: string): Promise<LimitResult> {
  const res = await limiter.get(key);
  if (res && res.consumedPoints >= limiter.points) return { ok: false, retryAfterS: retryAfter(res.msBeforeNext) };
  return { ok: true };
}
