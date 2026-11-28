import { randomInt } from "node:crypto";
import type { Knex } from "knex";
import type { ScopesInput, SupervisorCreateInput, SupervisorUpdateInput } from "../../app/shared/schemas/backoffice";
import { assignQueuedInScopeOf, AUTO_REASONS, openListingCount, reassignOpenListingsOf } from "./assignmentService";
import { recordAudit } from "./auditService";
import { hashPassword } from "./passwordService";
import type { Actor } from "./scopeService";

/**
 * Supervisor accounts (SPEC §3, §9), managed by the super_admin only:
 * always new accounts (never a promoted owner/agent), a public AQAR work
 * mobile, a scope of admin areas, activate/deactivate (open listings move on),
 * and one-time passwords. Every change is audited without personal values.
 *
 * One-time passwords are returned once to the caller and never stored in
 * plain text, logged or audited (the audit entry is `password_issued`).
 */

export class SupervisorError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "email_taken" | "area_invalid" | "already_in_state" | "reason_required") {
    super(code);
  }
}

export interface Context {
  ipHash?: string | null;
}

export interface ScopeArea {
  id: number;
  countryCode: string;
  level: string;
  nameAr: string;
  nameEn: string;
}

export interface SupervisorView {
  id: number;
  name: string;
  email: string;
  workPhone: string;
  whatsapp: boolean;
  titleAr: string | null;
  titleEn: string | null;
  isActive: boolean;
  accountActive: boolean;
  mustChangePassword: boolean;
  scopes: ScopeArea[];
  openListings: number;
  createdAt: string;
}

function assertSuperAdmin(actor: Actor) {
  if (actor.role !== "super_admin") throw new SupervisorError("forbidden");
}

// Easy to read aloud and type: no 0/O, 1/l/I.
const OTP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A one-time password: 4 groups of 5 characters (~114 bits), e.g. `Kp7Qe-…`. */
export function generateOneTimePassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let s = "";
    for (let i = 0; i < 5; i++) s += OTP_ALPHABET[randomInt(OTP_ALPHABET.length)];
    groups.push(s);
  }
  return groups.join("-");
}

const isEmailTaken = (e: unknown) => (e as { code?: string; constraint?: string } | null)?.code === "23505" && (e as { constraint?: string }).constraint === "users_email_lower";

interface Row {
  id: number;
  name: string;
  email: string;
  status: string;
  must_change_password: boolean;
  created_at: Date;
  work_phone_e164: string;
  work_phone_whatsapp: boolean;
  title_ar: string | null;
  title_en: string | null;
  is_active: boolean;
}

function baseQuery(db: Knex | Knex.Transaction) {
  return db("supervisor_profiles as sp")
    .join("users as u", "u.id", "sp.user_id")
    .where("u.role", "supervisor")
    .select(
      "u.id",
      "u.name",
      "u.email",
      "u.status",
      "u.must_change_password",
      "u.created_at",
      "sp.work_phone_e164",
      "sp.work_phone_whatsapp",
      "sp.title_ar",
      "sp.title_en",
      "sp.is_active",
    );
}

async function scopesOf(db: Knex | Knex.Transaction, ids: number[]): Promise<Map<number, ScopeArea[]>> {
  const out = new Map<number, ScopeArea[]>();
  if (!ids.length) return out;
  const rows = await db("supervisor_scopes as s")
    .join("admin_areas as a", "a.id", "s.admin_area_id")
    .whereIn("s.supervisor_id", ids)
    .orderBy(["a.country_code", "a.name_ar"])
    .select("s.supervisor_id", "a.id", "a.country_code", "a.level", "a.name_ar", "a.name_en");
  for (const r of rows) {
    const list = out.get(r.supervisor_id) ?? [];
    list.push({ id: r.id, countryCode: String(r.country_code).trim(), level: r.level, nameAr: r.name_ar, nameEn: r.name_en });
    out.set(r.supervisor_id, list);
  }
  return out;
}

async function toViews(db: Knex | Knex.Transaction, rows: Row[]): Promise<SupervisorView[]> {
  const scopes = await scopesOf(db, rows.map((r) => r.id));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      workPhone: r.work_phone_e164,
      whatsapp: r.work_phone_whatsapp,
      titleAr: r.title_ar,
      titleEn: r.title_en,
      isActive: r.is_active,
      accountActive: r.status === "active",
      mustChangePassword: r.must_change_password,
      scopes: scopes.get(r.id) ?? [],
      openListings: await openListingCount(db, r.id),
      createdAt: r.created_at.toISOString(),
    })),
  );
}

export async function listSupervisors(db: Knex, actor: Actor): Promise<SupervisorView[]> {
  assertSuperAdmin(actor);
  return toViews(db, (await baseQuery(db).orderBy("u.name")) as Row[]);
}

export async function getSupervisor(db: Knex | Knex.Transaction, actor: Actor, id: number): Promise<SupervisorView> {
  assertSuperAdmin(actor);
  const row = (await baseQuery(db).where("u.id", id).first()) as Row | undefined;
  if (!row) throw new SupervisorError("not_found");
  return (await toViews(db, [row]))[0]!;
}

/** Creates the account and profile; returns the one-time password once. */
export async function createSupervisor(db: Knex, actor: Actor, input: SupervisorCreateInput, ctx: Context = {}): Promise<{ id: number; oneTimePassword: string }> {
  assertSuperAdmin(actor);
  const oneTimePassword = generateOneTimePassword();
  const passwordHash = await hashPassword(oneTimePassword);
  try {
    const id = await db.transaction(async (trx) => {
      const [user] = await trx("users")
        .insert({ email: input.email, name: input.name, password_hash: passwordHash, role: "supervisor", must_change_password: true })
        .returning("id");
      const userId = user.id as number;
      await trx("supervisor_profiles").insert({
        user_id: userId,
        work_phone_e164: input.workPhone,
        work_phone_whatsapp: input.whatsapp,
        title_ar: input.titleAr,
        title_en: input.titleEn,
      });
      const audit = { actorUserId: actor.id, entityType: "user" as const, entityId: userId, ipHash: ctx.ipHash ?? null };
      await recordAudit(trx, {
        ...audit,
        action: "supervisor_created",
        after: { role: "supervisor", name: input.name, email: input.email, work_phone: input.workPhone, whatsapp: input.whatsapp, title_ar: input.titleAr, title_en: input.titleEn },
      });
      await recordAudit(trx, { ...audit, action: "password_issued" });
      return userId;
    });
    return { id, oneTimePassword };
  } catch (error) {
    if (isEmailTaken(error)) throw new SupervisorError("email_taken");
    throw error;
  }
}

export async function updateSupervisor(db: Knex, actor: Actor, id: number, input: SupervisorUpdateInput, ctx: Context = {}): Promise<void> {
  assertSuperAdmin(actor);
  await db.transaction(async (trx) => {
    const current = (await baseQuery(trx).where("u.id", id).forUpdate("sp").first()) as Row | undefined;
    if (!current) throw new SupervisorError("not_found");
    const before: Record<string, string | boolean | null> = {};
    const after: Record<string, string | boolean | null> = {};
    const diff = (key: string, a: string | boolean | null, b: string | boolean | null) => {
      if (a !== b) {
        before[key] = a;
        after[key] = b;
      }
    };
    diff("name", current.name, input.name);
    diff("work_phone", current.work_phone_e164, input.workPhone);
    diff("whatsapp", current.work_phone_whatsapp, input.whatsapp);
    diff("title_ar", current.title_ar, input.titleAr);
    diff("title_en", current.title_en, input.titleEn);
    if (!Object.keys(after).length) return;
    await trx("users").where({ id }).update({ name: input.name });
    await trx("supervisor_profiles")
      .where({ user_id: id })
      .update({ work_phone_e164: input.workPhone, work_phone_whatsapp: input.whatsapp, title_ar: input.titleAr, title_en: input.titleEn });
    await recordAudit(trx, { actorUserId: actor.id, action: "supervisor_updated", entityType: "user", entityId: id, before, after, ipHash: ctx.ipHash ?? null });
  });
}

/**
 * Replaces the supervisor's scope. Their open listings that fall outside the
 * new scope move to the next match, and open listings in the super_admin's
 * queue that the new scope covers are assigned (approved default). Listings
 * already assigned to someone else stay where they are.
 */
export async function setSupervisorScopes(db: Knex, actor: Actor, id: number, input: ScopesInput, ctx: Context = {}): Promise<{ moved: number; picked: number }> {
  assertSuperAdmin(actor);
  return db.transaction(async (trx) => {
    const profile = await trx("supervisor_profiles").where({ user_id: id }).forUpdate().first("user_id");
    if (!profile) throw new SupervisorError("not_found");
    if (input.areaIds.length) {
      const found = await trx("admin_areas").whereIn("id", input.areaIds).where({ is_active: true }).count({ n: "*" }).first();
      if (Number(found?.n ?? 0) !== input.areaIds.length) throw new SupervisorError("area_invalid");
    }
    const before = (await trx("supervisor_scopes").where({ supervisor_id: id }).orderBy("admin_area_id").pluck("admin_area_id")) as number[];
    if (before.length === input.areaIds.length && before.every((v, i) => v === input.areaIds[i])) return { moved: 0, picked: 0 };

    await trx("supervisor_scopes").where({ supervisor_id: id }).delete();
    if (input.areaIds.length) {
      await trx("supervisor_scopes").insert(input.areaIds.map((areaId) => ({ supervisor_id: id, admin_area_id: areaId, created_by: actor.id })));
    }
    await recordAudit(trx, {
      actorUserId: actor.id,
      action: "supervisor_scopes_changed",
      entityType: "user",
      entityId: id,
      before: { admin_area_ids: before },
      after: { admin_area_ids: input.areaIds },
      ipHash: ctx.ipHash ?? null,
    });
    const audit = { actorUserId: actor.id, reason: AUTO_REASONS.scopeChanged, ipHash: ctx.ipHash ?? null };
    const moved = await reassignOpenListingsOf(trx, id, { ...audit, onlyOutOfScope: true });
    const picked = await assignQueuedInScopeOf(trx, id, audit);
    return { moved, picked };
  });
}

/**
 * Activates or deactivates a supervisor (reason required, audited).
 * Deactivating ends their sessions (database trigger) and moves their open
 * listings to the next match or the super_admin's queue.
 */
export async function setSupervisorActive(
  db: Knex,
  actor: Actor,
  id: number,
  input: { active: boolean; reason: string },
  ctx: Context = {},
): Promise<{ moved: number }> {
  assertSuperAdmin(actor);
  const reason = input.reason.trim();
  if (!reason) throw new SupervisorError("reason_required");
  return db.transaction(async (trx) => {
    const profile = await trx("supervisor_profiles").where({ user_id: id }).forUpdate().first("is_active");
    if (!profile) throw new SupervisorError("not_found");
    if (profile.is_active === input.active) throw new SupervisorError("already_in_state");
    await trx("supervisor_profiles").where({ user_id: id }).update({ is_active: input.active });
    await recordAudit(trx, {
      actorUserId: actor.id,
      action: input.active ? "supervisor_activated" : "supervisor_deactivated",
      entityType: "user",
      entityId: id,
      before: { is_active: !input.active },
      after: { is_active: input.active },
      reason,
      ipHash: ctx.ipHash ?? null,
    });
    if (input.active) return { moved: 0 };
    const moved = await reassignOpenListingsOf(trx, id, { actorUserId: actor.id, reason: AUTO_REASONS.supervisorDeactivated, ipHash: ctx.ipHash ?? null });
    return { moved };
  });
}

/** Issues a new one-time password: sets `must_change_password`, ends the user's sessions, audited. */
export async function resetSupervisorPassword(db: Knex, actor: Actor, id: number, ctx: Context = {}): Promise<{ oneTimePassword: string }> {
  assertSuperAdmin(actor);
  const oneTimePassword = generateOneTimePassword();
  const passwordHash = await hashPassword(oneTimePassword);
  await db.transaction(async (trx) => {
    const user = await trx("users").where({ id, role: "supervisor" }).forUpdate().first("id");
    if (!user) throw new SupervisorError("not_found");
    await trx("users").where({ id }).update({ password_hash: passwordHash, must_change_password: true });
    await trx.raw("SELECT aqar_revoke_user_sessions(?)", [id]);
    await recordAudit(trx, { actorUserId: actor.id, action: "password_issued", entityType: "user", entityId: id, ipHash: ctx.ipHash ?? null });
  });
  return { oneTimePassword };
}

/** Admin areas of a country for the scope picker (every level, active only). */
export async function scopeAreaTree(db: Knex, countryCode: string) {
  const rows = await db("admin_areas")
    .where({ country_code: countryCode, is_active: true })
    .orderBy(["name_ar"])
    .select("id", "parent_id", "level", "name_ar", "name_en");
  return rows.map((r: { id: number; parent_id: number | null; level: string; name_ar: string; name_en: string }) => ({
    id: r.id,
    parentId: r.parent_id,
    level: r.level,
    nameAr: r.name_ar,
    nameEn: r.name_en,
  }));
}

/** Countries with admin areas (scope picker tabs). */
export async function scopeCountries(db: Knex): Promise<string[]> {
  const rows = await db("admin_areas").distinct("country_code").orderBy("country_code");
  return rows.map((r: { country_code: string }) => String(r.country_code).trim());
}
