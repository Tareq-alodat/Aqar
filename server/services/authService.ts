import { randomBytes, randomUUID } from "node:crypto";
import type { Knex } from "knex";
import type { Role } from "../../app/shared/constants";
import type { Locale } from "../../app/shared/locales";
import type { AuthErrorCode, LoginInput, RegisterInput } from "../../app/shared/schemas/auth";
import type { Theme } from "../../app/shared/schemas/theme";
import type { AuthSecrets, Secrets } from "../env";
import { protectPhone } from "./cryptoService";
import * as passwordService from "./passwordService";
import { check, take, type Limiters } from "./rateLimitService";
import {
  familyCapReached,
  hashIp,
  hashRefreshToken,
  looksLikeRefreshToken,
  newRefreshToken,
  refreshExpiry,
  ROTATION_GRACE_MS,
  signAccessToken,
  verifyAccessToken,
} from "./tokenService";

/**
 * Authentication (SPEC §3, §13): registration, login, session resolution with
 * refresh-token rotation, logout. Used by the API (`server/api/auth.ts`) and
 * the page actions (through the load context), so both share the same rules
 * and rate limits. Never logs or returns passwords, hashes, tokens or phones.
 */

/** The signed-in user as the server sees it. Explicit fields only; never a raw row. */
export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  locale: Locale;
  companyId: number | null;
}

export interface Session {
  user: SessionUser;
  familyId: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface RequestMeta {
  ip: string;
  userAgent?: string | undefined;
}

export type AuthFailure = { ok: false; error: AuthErrorCode; retryAfterS?: number };
export type AuthSuccess = { ok: true; session: Session; issued: IssuedTokens };

export interface ResolveResult {
  session: Session | null;
  /** New cookies to set (after a rotation). */
  issued?: IssuedTokens;
  /** The request carried auth cookies that are no longer valid. */
  clearCookies: boolean;
}

export interface PasswordFns {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  needsRehash(stored: string): boolean;
}

export interface AuthDeps {
  db: Knex;
  secrets: AuthSecrets;
  limiters: Limiters;
  /** Phone keys, only needed when a phone is given. */
  phoneSecrets: () => Secrets;
  passwords?: PasswordFns;
  now?: () => Date;
}

export type AuthService = ReturnType<typeof createAuthService>;

const USER_COLUMNS = ["u.id", "u.name", "u.email", "u.role", "u.status", "u.locale", "u.company_id"] as const;

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: "active" | "suspended";
  locale: Locale;
  company_id: number | null;
}

function toSessionUser(row: UserRow): SessionUser {
  return { id: row.id, name: row.name, email: row.email, role: row.role, locale: row.locale, companyId: row.company_id };
}

function isEmailTaken(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string } | null;
  return e?.code === "23505" && e.constraint === "users_email_lower";
}

export function createAuthService(deps: AuthDeps) {
  const { db, secrets, limiters } = deps;
  const passwords: PasswordFns = deps.passwords ?? {
    hash: passwordService.hashPassword,
    verify: passwordService.verifyPassword,
    needsRehash: passwordService.needsRehash,
  };
  const clock = deps.now ?? (() => new Date());

  // Verified against for unknown emails, so a miss costs the same scrypt work as a hit.
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = () => (dummyHash ??= passwords.hash(randomBytes(32).toString("base64url")));

  async function issueAccess(user: SessionUser, familyId: string, now: Date) {
    return signAccessToken({ userId: user.id, role: user.role, familyId }, secrets.jwtSecret, now);
  }

  /** Starts a new token family (login/register). */
  async function startSession(q: Knex | Knex.Transaction, user: SessionUser, meta: RequestMeta, now: Date): Promise<AuthSuccess> {
    const familyId = randomUUID();
    const refreshToken = newRefreshToken();
    const refreshExpiresAt = refreshExpiry(user.role, now, now);
    await q("refresh_tokens").insert({
      id: randomUUID(),
      user_id: user.id,
      family_id: familyId,
      family_started_at: now,
      token_hash: hashRefreshToken(refreshToken, secrets.refreshTokenSecret),
      expires_at: refreshExpiresAt,
      user_agent: meta.userAgent?.slice(0, 255) ?? null,
      ip_hash: hashIp(meta.ip, secrets.refreshTokenSecret),
      created_at: now,
    });
    return {
      ok: true,
      session: { user, familyId },
      issued: { accessToken: await issueAccess(user, familyId, now), refreshToken, refreshExpiresAt },
    };
  }

  async function revokeFamily(q: Knex | Knex.Transaction, familyId: string, now: Date) {
    await q("refresh_tokens").where({ family_id: familyId }).whereNull("revoked_at").update({ revoked_at: now });
  }

  async function register(
    input: RegisterInput,
    options: { countryCode: string; locale: Locale; theme: Theme },
    meta: RequestMeta,
  ): Promise<AuthSuccess | AuthFailure> {
    const ip = await take(limiters.authIp, meta.ip);
    if (!ip.ok) return { ok: false, error: "rate_limited", retryAfterS: ip.retryAfterS };

    const passwordHash = await passwords.hash(input.password);
    const phone = input.phone ? protectPhone(input.phone, options.countryCode, deps.phoneSecrets()) : null;
    const now = clock();
    try {
      return await db.transaction(async (trx) => {
        const [row] = (await trx("users as u")
          .insert({
            email: input.email,
            name: input.name,
            password_hash: passwordHash,
            phone_encrypted: phone?.encrypted ?? null,
            phone_hash: phone?.hash ?? null,
            locale: options.locale,
            theme: options.theme,
            last_login_at: now,
          })
          .returning(USER_COLUMNS.map((c) => c.slice(2)))) as UserRow[];
        return startSession(trx, toSessionUser(row!), meta, now);
      });
    } catch (error) {
      if (isEmailTaken(error)) return { ok: false, error: "email_taken" };
      throw error;
    }
  }

  async function login(input: LoginInput, meta: RequestMeta): Promise<AuthSuccess | AuthFailure> {
    const ip = await take(limiters.authIp, meta.ip);
    if (!ip.ok) return { ok: false, error: "rate_limited", retryAfterS: ip.retryAfterS };
    const perEmail = await check(limiters.loginEmail, input.email);
    if (!perEmail.ok) return { ok: false, error: "rate_limited", retryAfterS: perEmail.retryAfterS };

    const row = (await db("users as u")
      .whereRaw("lower(u.email) = ?", [input.email])
      .first(...USER_COLUMNS, "u.password_hash")) as (UserRow & { password_hash: string }) | undefined;

    let valid: boolean;
    if (row) {
      valid = await passwords.verify(input.password, row.password_hash);
    } else {
      // Same work as a real check, so timing does not reveal which emails exist.
      await passwords.verify(input.password, await getDummyHash());
      valid = false;
    }

    if (!row || !valid) {
      await take(limiters.loginEmail, input.email);
      return { ok: false, error: "invalid_credentials" };
    }
    // Only someone with the right password learns that the account is suspended.
    if (row.status !== "active") return { ok: false, error: "account_suspended" };

    await limiters.loginEmail.delete(input.email);
    const now = clock();
    const update: Record<string, unknown> = { last_login_at: now };
    if (passwords.needsRehash(row.password_hash)) update.password_hash = await passwords.hash(input.password);

    return db.transaction(async (trx) => {
      await trx("users").where({ id: row.id }).update(update);
      // Expired tokens can no longer be replayed; drop them.
      await trx("refresh_tokens").where({ user_id: row.id }).where("expires_at", "<", now).delete();
      return startSession(trx, toSessionUser(row), meta, now);
    });
  }

  /** Active session for a valid access token, checked against the database. */
  async function loadSession(userId: number, familyId: string, now: Date): Promise<Session | null> {
    const row = (await db("users as u")
      .join("refresh_tokens as r", "r.user_id", "u.id")
      .where({ "u.id": userId, "r.family_id": familyId })
      .whereNull("r.revoked_at")
      .where("r.expires_at", ">", now)
      .first(...USER_COLUMNS, "r.family_started_at")) as (UserRow & { family_started_at: Date }) | undefined;
    if (!row || row.status !== "active" || familyCapReached(row.role, row.family_started_at, now)) return null;
    return { user: toSessionUser(row), familyId };
  }

  type RotateResult =
    | { kind: "rotated"; session: Session; issued: IssuedTokens }
    | { kind: "grace"; session: Session }
    | { kind: "reuse" }
    | { kind: "invalid" };

  /** Exchanges a refresh token for a new pair (one-time use; reuse revokes the family). */
  async function rotate(refreshToken: string, meta: RequestMeta): Promise<RotateResult> {
    const now = clock();
    const tokenHash = hashRefreshToken(refreshToken, secrets.refreshTokenSecret);
    return db.transaction(async (trx) => {
      const row = (await trx("refresh_tokens as r")
        .join("users as u", "u.id", "r.user_id")
        .where("r.token_hash", tokenHash)
        .forUpdate("r")
        .first(
          ...USER_COLUMNS,
          "r.id as token_id",
          "r.family_id",
          "r.family_started_at",
          "r.expires_at",
          "r.revoked_at",
          "r.replaced_by",
        )) as
        | (UserRow & {
            token_id: string;
            family_id: string;
            family_started_at: Date;
            expires_at: Date;
            revoked_at: Date | null;
            replaced_by: string | null;
          })
        | undefined;
      if (!row) return { kind: "invalid" };

      const user = toSessionUser(row);
      const usable = row.status === "active" && !familyCapReached(user.role, row.family_started_at, now);

      if (row.revoked_at) {
        if (!row.replaced_by) return { kind: "invalid" }; // revoked by logout or a family revocation
        if (now.getTime() - row.revoked_at.getTime() <= ROTATION_GRACE_MS) {
          // Concurrent request with the token this browser just rotated: let it through without new tokens.
          return usable ? { kind: "grace", session: { user, familyId: row.family_id } } : { kind: "invalid" };
        }
        // A rotated token came back later: someone else has a copy. End the whole session.
        await revokeFamily(trx, row.family_id, now);
        return { kind: "reuse" };
      }
      if (row.expires_at.getTime() <= now.getTime()) return { kind: "invalid" };
      if (!usable) {
        await revokeFamily(trx, row.family_id, now);
        return { kind: "invalid" };
      }

      const id = randomUUID();
      const next = newRefreshToken();
      const refreshExpiresAt = refreshExpiry(user.role, row.family_started_at, now);
      await trx("refresh_tokens").insert({
        id,
        user_id: user.id,
        family_id: row.family_id,
        family_started_at: row.family_started_at,
        token_hash: hashRefreshToken(next, secrets.refreshTokenSecret),
        expires_at: refreshExpiresAt,
        user_agent: meta.userAgent?.slice(0, 255) ?? null,
        ip_hash: hashIp(meta.ip, secrets.refreshTokenSecret),
        created_at: now,
      });
      await trx("refresh_tokens").where({ id: row.token_id }).update({ revoked_at: now, replaced_by: id });
      return {
        kind: "rotated",
        session: { user, familyId: row.family_id },
        issued: { accessToken: await issueAccess(user, row.family_id, now), refreshToken: next, refreshExpiresAt },
      };
    });
  }

  /**
   * Session for a request: a valid access token, else a refresh-token
   * rotation, else anonymous.
   */
  async function resolve(cookies: { access?: string; refresh?: string }, meta: RequestMeta): Promise<ResolveResult> {
    const now = clock();
    if (cookies.access) {
      const claims = await verifyAccessToken(cookies.access, secrets.jwtSecret, now);
      if (claims) {
        const session = await loadSession(claims.userId, claims.familyId, now);
        if (session) return { session, clearCookies: false };
      }
    }
    if (looksLikeRefreshToken(cookies.refresh)) {
      const result = await rotate(cookies.refresh, meta);
      if (result.kind === "rotated") return { session: result.session, issued: result.issued, clearCookies: false };
      if (result.kind === "grace") return { session: result.session, clearCookies: false };
      return { session: null, clearCookies: true };
    }
    return { session: null, clearCookies: Boolean(cookies.access || cookies.refresh) };
  }

  /** Ends the session(s) the cookies belong to. */
  async function logout(cookies: { access?: string; refresh?: string }, session?: Session | null): Promise<void> {
    const now = clock();
    const families = new Set<string>();
    if (session) families.add(session.familyId);
    if (cookies.access) {
      const claims = await verifyAccessToken(cookies.access, secrets.jwtSecret, now);
      if (claims) families.add(claims.familyId);
    }
    if (looksLikeRefreshToken(cookies.refresh)) {
      const row = await db("refresh_tokens")
        .where({ token_hash: hashRefreshToken(cookies.refresh, secrets.refreshTokenSecret) })
        .first("family_id");
      if (row) families.add(row.family_id as string);
    }
    for (const familyId of families) await revokeFamily(db, familyId, now);
  }

  return {
    register,
    login,
    resolve,
    logout,
    /** Explicit refresh (POST /api/v1/auth/refresh). */
    async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<ResolveResult> {
      if (!looksLikeRefreshToken(refreshToken)) return { session: null, clearCookies: Boolean(refreshToken) };
      const result = await rotate(refreshToken, meta);
      if (result.kind === "rotated") return { session: result.session, issued: result.issued, clearCookies: false };
      if (result.kind === "grace") return { session: result.session, clearCookies: false };
      return { session: null, clearCookies: true };
    },
    /** Computes the dummy hash ahead of the first login (startup). */
    warmUp: () => getDummyHash().then(() => undefined),
  };
}
