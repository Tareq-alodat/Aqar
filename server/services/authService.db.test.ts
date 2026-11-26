import { randomBytes } from "node:crypto";
import type { Knex } from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/test/testDb";
import { createAuthService, type AuthService, type AuthSuccess, type PasswordFns } from "./authService";
import { decrypt } from "./cryptoService";
import { createLimiters } from "./rateLimitService";
import { ROTATION_GRACE_MS } from "./tokenService";

const DAY = 24 * 60 * 60 * 1000;
const secrets = { jwtSecret: randomBytes(32), refreshTokenSecret: randomBytes(32) };
const phoneSecrets = { encryptionKey: randomBytes(32), phoneHashKey: randomBytes(32) };

/** Fast stand-in for scrypt: "fake$<password>", and "old$<password>" needs a re-hash. */
function fakePasswords(): PasswordFns & { verify: ReturnType<typeof vi.fn> } {
  return {
    hash: vi.fn(async (pw: string) => `fake$${pw}`),
    verify: vi.fn(async (pw: string, stored: string) => stored === `fake$${pw}` || stored === `old$${pw}`),
    needsRehash: (stored: string) => stored.startsWith("old$"),
  };
}

let db: Knex;
let now: Date;
let passwords: ReturnType<typeof fakePasswords>;
let auth: AuthService;
let ipSeq = 0;
/** A different IP per call, so the 5/min auth limit only applies where a test wants it. */
const meta = () => ({ ip: `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`, userAgent: "vitest" });
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

function makeService() {
  passwords = fakePasswords();
  return createAuthService({
    db,
    secrets,
    limiters: createLimiters(),
    phoneSecrets: () => phoneSecrets,
    passwords,
    now: () => now,
  });
}

async function registerUser(email: string, extra: Partial<{ phone: string }> = {}) {
  const r = await auth.register(
    { name: "Test User", email, password: "correct-password", ...extra },
    { countryCode: "JO", locale: "ar", theme: "dark" },
    meta(),
  );
  if (!r.ok) throw new Error(`register failed: ${r.error}`);
  return r;
}

const cookiesOf = (r: Pick<AuthSuccess, "issued">) => ({ access: r.issued.accessToken, refresh: r.issued.refreshToken });

beforeAll(() => {
  db = createTestDb();
});
afterAll(async () => {
  await db.raw("TRUNCATE refresh_tokens, users RESTART IDENTITY CASCADE");
  await db.destroy();
});
beforeEach(async () => {
  await db.raw("TRUNCATE refresh_tokens, users RESTART IDENTITY CASCADE");
  now = new Date("2026-12-01T10:00:00Z");
  auth = makeService();
});

describe("register", () => {
  it("creates an owner with a session and no phone", async () => {
    const r = await registerUser("new@aqar.test");
    expect(r.session.user).toMatchObject({ email: "new@aqar.test", role: "owner", locale: "ar", companyId: null });
    const row = await db("users").where({ id: r.session.user.id }).first();
    expect(row.password_hash).toBe("fake$correct-password");
    expect(row.phone_encrypted).toBeNull();
    expect(await db("refresh_tokens").where({ user_id: row.id }).count({ n: "*" }).first()).toEqual({ n: "1" });
  });

  it("stores a local-format phone normalized and encrypted", async () => {
    const r = await registerUser("phone@aqar.test", { phone: "79 123 4567" });
    const row = await db("users").where({ id: r.session.user.id }).first();
    expect(row.phone_encrypted).not.toContain("791234567");
    expect(decrypt(row.phone_encrypted, phoneSecrets.encryptionKey)).toBe("+962791234567");
  });

  it("refuses a second account with the same email in any case", async () => {
    await registerUser("dup@aqar.test");
    const r = await auth.register(
      { name: "Other", email: "dup@aqar.test", password: "another-password" },
      { countryCode: "JO", locale: "en", theme: "light" },
      meta(),
    );
    expect(r).toEqual({ ok: false, error: "email_taken" });
    await db("users").where({ email: "dup@aqar.test" }).update({ email: "DUP@aqar.test" });
    const again = await auth.register(
      { name: "Other", email: "dup@aqar.test", password: "another-password" },
      { countryCode: "JO", locale: "en", theme: "light" },
      meta(),
    );
    expect(again).toEqual({ ok: false, error: "email_taken" });
  });
});

describe("login", () => {
  beforeEach(async () => {
    await registerUser("user@aqar.test");
    passwords.verify.mockClear();
  });

  it("succeeds with the right password and records the login", async () => {
    advance(60_000);
    const r = await auth.login({ email: "user@aqar.test", password: "correct-password" }, meta());
    expect(r.ok).toBe(true);
    const row = await db("users").where({ email: "user@aqar.test" }).first();
    expect(row.last_login_at.getTime()).toBe(now.getTime());
  });

  it("gives the same answer for a wrong password and an unknown email, doing the same scrypt work", async () => {
    const wrong = await auth.login({ email: "user@aqar.test", password: "wrong-password" }, meta());
    const unknown = await auth.login({ email: "nobody@aqar.test", password: "wrong-password" }, meta());
    expect(wrong).toEqual({ ok: false, error: "invalid_credentials" });
    expect(unknown).toEqual(wrong);
    // One verify each: the unknown email is checked against the dummy hash.
    expect(passwords.verify).toHaveBeenCalledTimes(2);
    const dummy = passwords.verify.mock.calls[1]![1] as string;
    expect(dummy).toMatch(/^fake\$/);
    expect(dummy).not.toBe("fake$correct-password");
  });

  it("re-hashes a password stored with old parameters", async () => {
    await db("users").where({ email: "user@aqar.test" }).update({ password_hash: "old$correct-password" });
    expect((await auth.login({ email: "user@aqar.test", password: "correct-password" }, meta())).ok).toBe(true);
    expect((await db("users").where({ email: "user@aqar.test" }).first()).password_hash).toBe("fake$correct-password");
  });

  it("reveals a suspension only to someone with the right password", async () => {
    await db("users").where({ email: "user@aqar.test" }).update({ status: "suspended" });
    expect(await auth.login({ email: "user@aqar.test", password: "wrong-password" }, meta())).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
    expect(await auth.login({ email: "user@aqar.test", password: "correct-password" }, meta())).toEqual({
      ok: false,
      error: "account_suspended",
    });
  });

  it("limits login attempts to 5 per minute per IP", async () => {
    const ip = { ip: "203.0.113.7" };
    for (let i = 0; i < 5; i++) await auth.login({ email: "user@aqar.test", password: "wrong-password" }, ip);
    const r = await auth.login({ email: "user@aqar.test", password: "correct-password" }, ip);
    expect(r).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("locks an email after 10 failures from any IPs, and a success resets the count", async () => {
    for (let i = 0; i < 9; i++) await auth.login({ email: "user@aqar.test", password: "wrong-password" }, meta());
    expect((await auth.login({ email: "user@aqar.test", password: "correct-password" }, meta())).ok).toBe(true);
    for (let i = 0; i < 10; i++) await auth.login({ email: "user@aqar.test", password: "wrong-password" }, meta());
    const r = await auth.login({ email: "user@aqar.test", password: "correct-password" }, meta());
    expect(r).toMatchObject({ ok: false, error: "rate_limited" });
    expect(passwords.verify).toHaveBeenCalledTimes(20); // the locked attempt did no scrypt work
  });
});

describe("sessions", () => {
  it("resolves an access token, checked against the database", async () => {
    const r = await registerUser("s@aqar.test");
    const resolved = await auth.resolve({ access: r.issued.accessToken }, meta());
    expect(resolved.session?.user.email).toBe("s@aqar.test");
    expect(resolved.issued).toBeUndefined();
  });

  it("ends immediately on suspension, even with a valid access token", async () => {
    const r = await registerUser("s@aqar.test");
    await db("users").where({ id: r.session.user.id }).update({ status: "suspended" });
    const resolved = await auth.resolve(cookiesOf(r), meta());
    expect(resolved).toEqual({ session: null, clearCookies: true });
  });

  it("applies a role change on the next request", async () => {
    const r = await registerUser("s@aqar.test");
    await db("users").where({ id: r.session.user.id }).update({ role: "admin" });
    expect((await auth.resolve({ access: r.issued.accessToken }, meta())).session?.user.role).toBe("admin");
  });

  it("rotates the refresh token once the access token has expired", async () => {
    const r = await registerUser("s@aqar.test");
    advance(16 * 60 * 1000);
    const rotated = await auth.resolve(cookiesOf(r), meta());
    expect(rotated.session?.user.email).toBe("s@aqar.test");
    expect(rotated.issued?.refreshToken).toBeDefined();
    expect(rotated.issued?.refreshToken).not.toBe(r.issued.refreshToken);
    const rows = await db("refresh_tokens").orderBy("created_at");
    expect(rows).toHaveLength(2);
    expect(rows[0].revoked_at).not.toBeNull();
    expect(rows[0].replaced_by).toBe(rows[1].id);
    expect(rows[1].family_id).toBe(rows[0].family_id);
  });

  it("lets a concurrent request with the just-rotated token through without new tokens (grace)", async () => {
    const r = await registerUser("s@aqar.test");
    advance(16 * 60 * 1000);
    const first = await auth.resolve({ refresh: r.issued.refreshToken }, meta());
    advance(ROTATION_GRACE_MS - 1000);
    const second = await auth.resolve({ refresh: r.issued.refreshToken }, meta());
    expect(second.session?.user.email).toBe("s@aqar.test");
    expect(second.issued).toBeUndefined();
    // The new token from the first request still works.
    const third = await auth.resolve({ refresh: first.issued!.refreshToken }, meta());
    expect(third.issued).toBeDefined();
  });

  it("revokes the whole session when a rotated token is reused later", async () => {
    const r = await registerUser("s@aqar.test");
    advance(16 * 60 * 1000);
    const first = await auth.resolve({ refresh: r.issued.refreshToken }, meta());
    advance(ROTATION_GRACE_MS + 1000);
    const replay = await auth.resolve({ refresh: r.issued.refreshToken }, meta());
    expect(replay).toEqual({ session: null, clearCookies: true });
    // The legitimate holder's new tokens are dead too.
    expect((await auth.resolve({ refresh: first.issued!.refreshToken }, meta())).session).toBeNull();
    expect((await auth.resolve({ access: first.issued!.accessToken }, meta())).session).toBeNull();
    expect(await db("refresh_tokens").whereNull("revoked_at").count({ n: "*" }).first()).toEqual({ n: "0" });
  });

  it("expires after 30 days without use, sliding while in use", async () => {
    const r = await registerUser("s@aqar.test");
    let refresh = r.issued.refreshToken;
    for (let i = 0; i < 3; i++) {
      advance(29 * DAY);
      const res = await auth.resolve({ refresh }, meta());
      expect(res.issued, `rotation ${i + 1}`).toBeDefined();
      refresh = res.issued!.refreshToken;
    }
    advance(30 * DAY + 1000);
    expect((await auth.resolve({ refresh }, meta())).session).toBeNull();
  });

  it("caps a session at 90 days from login however often it is used", async () => {
    const r = await registerUser("s@aqar.test");
    let refresh = r.issued.refreshToken;
    for (let day = 20; day < 90; day += 20) {
      advance(20 * DAY);
      const res = await auth.resolve({ refresh }, meta());
      expect(res.issued).toBeDefined();
      expect(res.issued!.refreshExpiresAt.getTime()).toBeLessThanOrEqual(new Date("2026-12-01T10:00:00Z").getTime() + 90 * DAY);
      refresh = res.issued!.refreshToken;
    }
    advance(11 * DAY); // day 91
    expect((await auth.resolve({ refresh }, meta())).session).toBeNull();
  });

  it("gives admins 1 day idle and 7 days absolute", async () => {
    const r = await registerUser("admin@aqar.test");
    await db("users").where({ id: r.session.user.id }).update({ role: "admin" });
    const login = await auth.login({ email: "admin@aqar.test", password: "correct-password" }, meta());
    if (!login.ok) throw new Error("login failed");
    expect(login.issued.refreshExpiresAt.getTime()).toBe(now.getTime() + DAY);

    advance(DAY + 1000);
    expect((await auth.resolve({ refresh: login.issued.refreshToken }, meta())).session).toBeNull();

    const again = await auth.login({ email: "admin@aqar.test", password: "correct-password" }, meta());
    if (!again.ok) throw new Error("login failed");
    let refresh = again.issued.refreshToken;
    for (let i = 0; i < 6; i++) {
      advance(DAY - 60_000);
      const res = await auth.resolve({ refresh }, meta());
      expect(res.issued, `day ${i + 1}`).toBeDefined();
      refresh = res.issued!.refreshToken;
    }
    advance(DAY); // past 7 days from this login
    expect((await auth.resolve({ refresh }, meta())).session).toBeNull();
  });

  it("applies the admin cap to a session that started before a promotion", async () => {
    const r = await registerUser("promoted@aqar.test");
    advance(8 * DAY);
    await db("users").where({ id: r.session.user.id }).update({ role: "admin" });
    expect((await auth.resolve({ refresh: r.issued.refreshToken }, meta())).session).toBeNull();
  });

  it("logout ends the session for both tokens", async () => {
    const r = await registerUser("s@aqar.test");
    await auth.logout(cookiesOf(r));
    expect((await auth.resolve({ access: r.issued.accessToken }, meta())).session).toBeNull();
    expect((await auth.resolve({ refresh: r.issued.refreshToken }, meta())).session).toBeNull();
  });

  it("ignores junk cookies and asks to clear them", async () => {
    expect(await auth.resolve({ access: "junk", refresh: "junk" }, meta())).toEqual({ session: null, clearCookies: true });
    expect(await auth.resolve({}, meta())).toEqual({ session: null, clearCookies: false });
  });

  it("never stores the refresh token itself", async () => {
    const r = await registerUser("s@aqar.test");
    const row = await db("refresh_tokens").first();
    expect(JSON.stringify(row)).not.toContain(r.issued.refreshToken);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
