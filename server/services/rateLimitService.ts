import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

/**
 * Rate limits (SPEC §13), in memory: one Node process on one VPS. Counters
 * reset on restart, which is acceptable for these limits. The map endpoint
 * limit (30/min) arrives with milestone 4.
 */
export const LIMITS = {
  /** Every /api/v1 request, per IP. */
  api: { points: 100, duration: 60 },
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
