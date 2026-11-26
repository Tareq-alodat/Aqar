import { describe, expect, it } from "vitest";
import { check, createLimiters, LIMITS, take } from "./rateLimitService";

describe("rate limits", () => {
  it("match SPEC §13: 100/min API, 5/min auth per IP; 10 failed logins per email per 15 min", () => {
    expect(LIMITS.api).toEqual({ points: 100, duration: 60 });
    expect(LIMITS.authIp).toEqual({ points: 5, duration: 60 });
    expect(LIMITS.loginEmail).toEqual({ points: 10, duration: 900 });
  });

  it("allows the limit, then refuses with a retry time", async () => {
    const { authIp } = createLimiters();
    for (let i = 0; i < 5; i++) expect(await take(authIp, "1.2.3.4")).toEqual({ ok: true });
    const blocked = await take(authIp, "1.2.3.4");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterS).toBeGreaterThan(0);
    expect(await take(authIp, "5.6.7.8")).toEqual({ ok: true });
  });

  it("check() does not use points", async () => {
    const { loginEmail } = createLimiters();
    for (let i = 0; i < 20; i++) expect(await check(loginEmail, "a@b.c")).toEqual({ ok: true });
    for (let i = 0; i < 10; i++) await take(loginEmail, "a@b.c");
    expect((await check(loginEmail, "a@b.c")).ok).toBe(false);
  });
});
