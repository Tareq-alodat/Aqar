import { randomBytes } from "node:crypto";
import express from "express";
import type { Knex } from "knex";
import { RateLimiterMemory } from "rate-limiter-flexible";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_LISTING_STATUSES } from "../../app/shared/constants";
import { truncateForDev } from "../db/devTruncate";
import { DEV_PASSWORD, seed } from "../db/seeds/01_dev_data";
import { createTestDb } from "../db/test/testDb";
import { requireSecrets } from "../env";
import { assignOnSubmit, reassignListing } from "../services/assignmentService";
import { CHANGED } from "../services/auditService";
import { createAuthCookies } from "../services/authCookies";
import { createAuthService } from "../services/authService";
import { resolveContactNumber } from "../services/contactService";
import { decrypt } from "../services/cryptoService";
import { createLimiters } from "../services/rateLimitService";
import { findAssignee, isAreaInScope, isOwnListing, whereListingInScope } from "../services/scopeService";
import { LocalDiskStorage } from "../services/storageService";
import { createApiRouter } from "./index";

/**
 * Milestone 7a: supervisor model. Roles and scope isolation, automatic
 * assignment (deepest scope, tie-break, inactive/owner skipped), reassignment
 * and deactivation with reasons, the public contact (supervisor's work mobile,
 * then AQAR fallback numbers only — never a lister's phone), one-time
 * passwords and `must_change_password`, session revocation, and the
 * append-only audit log / status history.
 */

let db: Knex;
let app: express.Express;

function buildApp() {
  const limiters = createLimiters();
  limiters.api = new RateLimiterMemory({ keyPrefix: "api_test", points: 1_000_000, duration: 60 });
  limiters.authIp = new RateLimiterMemory({ keyPrefix: "auth_ip_test", points: 1_000_000, duration: 60 });
  limiters.loginEmail = new RateLimiterMemory({ keyPrefix: "login_email_test", points: 1_000_000, duration: 60 });
  const auth = createAuthService({ db, secrets: { jwtSecret: randomBytes(32), refreshTokenSecret: randomBytes(32) }, limiters, phoneSecrets: () => requireSecrets() });
  const a = express();
  a.use(
    "/api/v1",
    createApiRouter({
      isProduction: true,
      checkDatabase: vi.fn().mockResolvedValue("ok" as const),
      auth: { service: auth, cookies: createAuthCookies({ secure: false }) },
      limiters,
      db,
      views: { secret: randomBytes(32), secure: false },
      submission: { db, storage: new LocalDiskStorage("./uploads"), phoneSecrets: () => requireSecrets() },
      backoffice: { db, ipHashSecret: randomBytes(32) },
    }),
  );
  return a;
}

const cookieOf = (res: request.Response) => ((res.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]).join("; ");

async function login(email: string, password = DEV_PASSWORD): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status, `login ${email}`).toBe(200);
  return cookieOf(res);
}

const userId = async (email: string) => (await db("users").where({ email }).first("id")).id as number;
const areaId = async (level: string, nameAr: string) => (await db("admin_areas").where({ country_code: "JO", level, name_ar: nameAr }).first("id")).id as number;

let superAdmin: { id: number; role: "super_admin" };
let supAmman: number;
let supRegions: number;
let admin: string;

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
  app = buildApp();
  superAdmin = { id: await userId("admin@aqar.test"), role: "super_admin" };
  supAmman = await userId("sup.amman@aqar.test");
  supRegions = await userId("sup.regions@aqar.test");
  admin = await login("admin@aqar.test");
});
afterAll(async () => {
  await db.destroy();
});

/** A supervisor created directly (tests that need extra ones). */
async function makeSupervisor(email: string, scopeAreaIds: number[], phone = "+962790000199"): Promise<number> {
  const [u] = await db("users").insert({ email, name: "Test Supervisor", role: "supervisor", password_hash: "x" }).returning("id");
  await db("supervisor_profiles").insert({ user_id: u.id, work_phone_e164: phone, work_phone_whatsapp: false });
  if (scopeAreaIds.length) await db("supervisor_scopes").insert(scopeAreaIds.map((a) => ({ supervisor_id: u.id, admin_area_id: a })));
  return u.id as number;
}

async function dropSupervisor(id: number) {
  await db("properties").where({ assigned_supervisor_id: id }).update({ assigned_supervisor_id: null, assigned_at: null });
  await db("supervisor_profiles").where({ user_id: id }).delete();
  await db("refresh_tokens").where({ user_id: id }).delete();
  // Audit rows reference users with RESTRICT; tests that audit a temporary supervisor keep the user (renamed).
  await db("users").where({ id }).update({ email: `gone-${id}@aqar.test`, role: "owner" });
}

describe("append-only audit log and status history", () => {
  it("rejects UPDATE, DELETE and TRUNCATE (no bypass in the schema)", async () => {
    await db("audit_log").insert({ action: "password_issued", entity_type: "user", entity_id: 1 });
    await db("status_history").insert({ entity_type: "listing", entity_id: 1, to_status: "pending" });
    for (const table of ["audit_log", "status_history"]) {
      await expect(db(table).update({ entity_id: 2 })).rejects.toThrow(/append-only/);
      await expect(db(table).delete()).rejects.toThrow(/append-only/);
      await expect(db.raw(`TRUNCATE ${table}`)).rejects.toThrow(/append-only/);
    }
    // A cascade from users is refused too.
    await expect(db.raw("TRUNCATE users CASCADE")).rejects.toThrow(/append-only/);
    // No trigger is disabled.
    const triggers = await db.raw<{ rows: Array<{ tgname: string; tgenabled: string }> }>(
      "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%_no_change' OR tgname LIKE '%_no_truncate' ORDER BY tgname",
    );
    expect(triggers.rows).toEqual([
      { tgname: "audit_log_no_change", tgenabled: "O" },
      { tgname: "audit_log_no_truncate", tgenabled: "O" },
      { tgname: "status_history_no_change", tgenabled: "O" },
      { tgname: "status_history_no_truncate", tgenabled: "O" },
    ]);
  });

  it("the dev/test cleanup refuses to run in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(truncateForDev(db, ["audit_log"])).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("roles and supervisor profiles (schema)", () => {
  it("accepts exactly the new roles; a profile needs a supervisor, who keeps the role", async () => {
    await expect(db("users").insert({ email: "old-admin@aqar.test", name: "X", password_hash: "x", role: "admin" })).rejects.toThrow(/violates/);
    const owner = await userId("owner1@aqar.test");
    await expect(db("supervisor_profiles").insert({ user_id: owner, work_phone_e164: "+962790000150" })).rejects.toThrow(/not a supervisor/);
    await expect(db("users").where({ id: supAmman }).update({ role: "owner" })).rejects.toThrow(/supervisor profile/);
    await expect(db("supervisor_profiles").where({ user_id: supAmman }).update({ work_phone_e164: "0790000101" })).rejects.toThrow(/violates/);
  });
});

describe("session revocation on role or active-status changes", () => {
  it("deactivating a supervisor profile, suspending or changing a role ends every session of that user", async () => {
    const id = await makeSupervisor("revoke@aqar.test", []);
    await db("users").where({ id }).update({ password_hash: (await db("users").where({ id: supAmman }).first("password_hash")).password_hash });
    const live = async () => Number((await db("refresh_tokens").where({ user_id: id }).whereNull("revoked_at").count({ n: "*" }).first())?.n);

    let cookie = await login("revoke@aqar.test");
    await login("revoke@aqar.test");
    expect(await live()).toBe(2);
    await db("supervisor_profiles").where({ user_id: id }).update({ is_active: false });
    expect(await live()).toBe(0);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);

    await db("supervisor_profiles").where({ user_id: id }).update({ is_active: true });
    cookie = await login("revoke@aqar.test");
    await db("users").where({ id }).update({ status: "suspended" });
    expect(await live()).toBe(0);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
    await db("users").where({ id }).update({ status: "active" });

    cookie = await login("revoke@aqar.test");
    await db("supervisor_profiles").where({ user_id: id }).delete();
    await db("users").where({ id }).update({ role: "owner" });
    expect(await live()).toBe(0);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
    await db("users").where({ id }).update({ email: "revoked-gone@aqar.test" });
  });
});

describe("scope (SPEC §3, §13)", () => {
  it("filters listings per supervisor, descendants included; the super_admin sees all; others nothing", async () => {
    const all = await db("properties").pluck("id");
    const inScope = async (actor: { id: number; role: "super_admin" | "supervisor" | "owner" }) =>
      (await whereListingInScope(db("properties as p"), actor).pluck("p.id")) as number[];
    const amman = await inScope({ id: supAmman, role: "supervisor" });
    const regions = await inScope({ id: supRegions, role: "supervisor" });
    expect((await inScope(superAdmin)).sort()).toEqual(all.sort());
    expect(await inScope({ id: await userId("owner1@aqar.test"), role: "owner" })).toEqual([]);
    expect(amman.length).toBeGreaterThan(20);
    expect(amman.filter((id) => regions.includes(id))).toEqual([]);
    // Listings without an area are the super_admin's only.
    const noArea = await db("properties").whereNull("admin_area_id").pluck("id");
    expect(noArea.length).toBeGreaterThan(0);
    for (const id of noArea) expect([...amman, ...regions]).not.toContain(id);

    const abdoun = await areaId("area", "عبدون");
    expect(await isAreaInScope(db, supAmman, abdoun)).toBe(true);
    expect(await isAreaInScope(db, supRegions, abdoun)).toBe(false);
    expect(await isAreaInScope(db, supAmman, null)).toBe(false);
  });

  it("unpublished listings: preview for the supervisor in scope and the super_admin; 404 out of scope", async () => {
    const pending = await db("properties").where({ status: "pending", assigned_supervisor_id: supAmman }).first("id");
    const amman = await login("sup.amman@aqar.test");
    const regions = await login("sup.regions@aqar.test");
    const res = await request(app).get(`/api/v1/listings/${pending.id}`).set("Cookie", amman);
    expect(res.status).toBe(200);
    expect(res.body.access).toBe("preview");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect((await request(app).get(`/api/v1/listings/${pending.id}`).set("Cookie", regions)).status).toBe(404);
    expect((await request(app).get(`/api/v1/listings/${pending.id}`).set("Cookie", admin)).body.access).toBe("preview");
  });
});

describe("assignment (SPEC §4.2)", () => {
  const abdoun = () => areaId("area", "عبدون");

  it("deepest scope wins; ties go to fewer open listings, then the lowest id; inactive and suspended are skipped", async () => {
    const area = await abdoun();
    const owner = await userId("owner1@aqar.test");
    expect(await findAssignee(db, { adminAreaId: area, ownerId: owner })).toBe(supAmman);

    const deepA = await makeSupervisor("deep-a@aqar.test", [area]);
    const deepB = await makeSupervisor("deep-b@aqar.test", [area]);
    try {
      expect(await findAssignee(db, { adminAreaId: area, ownerId: owner })).toBe(Math.min(deepA, deepB));
      // deepA gets more open work → deepB wins the tie.
      const someListing = await db("properties").whereIn("status", [...OPEN_LISTING_STATUSES]).first("id", "assigned_supervisor_id", "assigned_at");
      await db("properties").where({ id: someListing.id }).update({ assigned_supervisor_id: Math.min(deepA, deepB), assigned_at: db.fn.now() });
      expect(await findAssignee(db, { adminAreaId: area, ownerId: owner })).toBe(Math.max(deepA, deepB));
      await db("properties").where({ id: someListing.id }).update({ assigned_supervisor_id: someListing.assigned_supervisor_id, assigned_at: someListing.assigned_at });

      // Self-review guard: never the listing's owner.
      expect(await findAssignee(db, { adminAreaId: area, ownerId: Math.min(deepA, deepB) })).toBe(Math.max(deepA, deepB));
      expect(isOwnListing({ id: 5 }, { ownerId: 5 })).toBe(true);
      expect(isOwnListing({ id: 5 }, { ownerId: 6 })).toBe(false);

      await db("supervisor_profiles").whereIn("user_id", [deepA]).update({ is_active: false });
      await db("users").where({ id: deepB }).update({ status: "suspended" });
      expect(await findAssignee(db, { adminAreaId: area, ownerId: owner })).toBe(supAmman);
      expect(await findAssignee(db, { adminAreaId: area, ownerId: owner }, [supAmman])).toBeNull();
    } finally {
      await db("users").where({ id: deepB }).update({ status: "active" });
      await dropSupervisor(deepA);
      await dropSupervisor(deepB);
    }
  });

  it("no matching scope, or no area → the super_admin's queue", async () => {
    const ammanGov = (await db("admin_areas").where({ id: await areaId("city", "عمان") }).first("parent_id")).parent_id;
    const owner = await userId("owner1@aqar.test");
    expect(await findAssignee(db, { adminAreaId: ammanGov, ownerId: owner })).toBeNull();
    expect(await findAssignee(db, { adminAreaId: null, ownerId: owner })).toBeNull();
  });

  it("assignOnSubmit sets the assignee and audits it (actor: system)", async () => {
    const listing = await db("properties").where({ status: "pending", assigned_supervisor_id: supAmman }).first("id");
    await db("properties").where({ id: listing.id }).update({ assigned_supervisor_id: null, assigned_at: null });
    const to = await db.transaction((trx) => assignOnSubmit(trx, listing.id));
    expect(to).toBe(supAmman);
    const last = await db("audit_log").where({ entity_type: "listing", entity_id: listing.id }).orderBy("id", "desc").first();
    expect(last).toMatchObject({ action: "listing_assigned", actor_user_id: null, reason: "submitted", before: { assigned_supervisor_id: null }, after: { assigned_supervisor_id: supAmman } });
  });
});

describe("reassignment API (super_admin, reason required)", () => {
  const url = (id: number) => `/api/v1/backoffice/listings/${id}/assignment`;

  it("refuses other roles, a missing reason, out-of-scope targets, closed listings and unknown ids", async () => {
    const listing = await db("properties").where({ status: "published", assigned_supervisor_id: supAmman }).first("id");
    const supCookie = await login("sup.amman@aqar.test");
    expect((await request(app).post(url(listing.id)).set("Cookie", supCookie).send({ supervisorId: null, reason: "x" })).status).toBe(403);
    expect((await request(app).post(url(listing.id)).set("Cookie", await login("owner1@aqar.test")).send({ supervisorId: null, reason: "x" })).status).toBe(403);
    expect((await request(app).post(url(listing.id)).send({ supervisorId: null, reason: "x" })).status).toBe(401);

    const blank = await request(app).post(url(listing.id)).set("Cookie", admin).send({ supervisorId: null, reason: "   " });
    expect(blank.status).toBe(400);
    expect(blank.body.fields.reason).toBe("reason_required");
    expect((await request(app).post(url(listing.id)).set("Cookie", admin).send({ supervisorId: null })).status).toBe(400);

    const outOfScope = await request(app).post(url(listing.id)).set("Cookie", admin).send({ supervisorId: supRegions, reason: "balance" });
    expect(outOfScope.status).toBe(400);
    expect(outOfScope.body.error).toBe("invalid_assignee");

    const sold = await db("properties").where({ status: "sold" }).first("id");
    expect((await request(app).post(url(sold.id)).set("Cookie", admin).send({ supervisorId: null, reason: "x" })).status).toBe(409);
    expect((await request(app).post(url(999999)).set("Cookie", admin).send({ supervisorId: null, reason: "x" })).status).toBe(404);
    expect((await request(app).post(url(listing.id)).set("Cookie", admin).send({ supervisorId: null, reason: "x" })).headers["cache-control"]).toBe(
      "private, no-store",
    );
    await db("properties").where({ id: listing.id }).update({ assigned_supervisor_id: supAmman, assigned_at: db.fn.now() });
  });

  it("moves the listing and stores the reason in the audit log", async () => {
    const listing = await db("properties").where({ status: "published", assigned_supervisor_id: supAmman }).orderBy("id", "desc").first("id");
    const res = await request(app).post(url(listing.id)).set("Cookie", admin).send({ supervisorId: null, reason: "Covering while on leave" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assignedSupervisorId: null, changed: true });
    const row = await db("properties").where({ id: listing.id }).first("assigned_supervisor_id", "assigned_at");
    expect(row).toEqual({ assigned_supervisor_id: null, assigned_at: null });
    const entry = await db("audit_log").where({ entity_type: "listing", entity_id: listing.id, action: "listing_reassigned" }).orderBy("id", "desc").first();
    expect(entry).toMatchObject({ actor_user_id: superAdmin.id, reason: "Covering while on leave", before: { assigned_supervisor_id: supAmman }, after: { assigned_supervisor_id: null } });
    expect(entry.ip_hash).toMatch(/^[0-9a-f]{64}$/);

    const back = await request(app).post(url(listing.id)).set("Cookie", admin).send({ supervisorId: supAmman, reason: "Back from leave" });
    expect(back.body).toEqual({ assignedSupervisorId: supAmman, changed: true });
  });

  it("staff never act on their own listing (self-review guard)", async () => {
    const listing = await db("properties").where({ status: "published" }).first("id", "owner_id");
    try {
      await db("properties").where({ id: listing.id }).update({ owner_id: superAdmin.id });
      await expect(reassignListing(db, superAdmin, listing.id, { supervisorId: null, reason: "x" })).rejects.toThrow("forbidden");
    } finally {
      await db("properties").where({ id: listing.id }).update({ owner_id: listing.owner_id });
    }
  });
});

describe("public contact (SPEC §8): supervisor's work mobile, then AQAR numbers only", () => {
  /** Every lister phone on file: listings' encrypted phones and users' profile phones (owners, agents, everyone). */
  async function listerPhones(): Promise<Set<string>> {
    const key = requireSecrets().encryptionKey;
    const out = new Set<string>();
    for (const r of await db("properties").whereNotNull("owner_phone_encrypted").pluck("owner_phone_encrypted")) out.add(decrypt(r, key));
    for (const r of await db("users").whereNotNull("phone_encrypted").pluck("phone_encrypted")) out.add(decrypt(r, key));
    return out;
  }

  it("never returns a lister's, owner's or agent's own phone at any step of the chain", async () => {
    const phones = await listerPhones();
    expect(phones.size).toBeGreaterThan(10);
    // Adversarial: the listing's own phone equals… nothing in contact_numbers; and the chain is walked step by step.
    const propertyNumber = await db("contact_numbers").where({ scope: "property" }).first("property_id");
    const listing = await db("properties").where({ id: propertyNumber.property_id }).first("id", "admin_area_id", "country_code", "assigned_supervisor_id", "owner_id");
    const resolve = (assignedSupervisorId: number | null) =>
      resolveContactNumber(db, { id: listing.id, adminAreaId: listing.admin_area_id, countryCode: "JO", assignedSupervisorId });
    const steps: Array<string | null> = [];
    const step = async (expected: string | null, assigned: number | null = listing.assigned_supervisor_id) => {
      const c = await resolve(assigned);
      steps.push(c?.phone ?? null);
      expect(c?.phone ?? null).toBe(expected);
      if (c) expect(phones.has(c.phone)).toBe(false);
    };
    try {
      await step("+962790000101"); // the assigned supervisor (Amman)
      await db("supervisor_profiles").where({ user_id: supAmman }).update({ is_active: false });
      await step("+96265000005"); // inactive profile → the listing's own AQAR number
      await db("contact_numbers").where({ scope: "property" }).update({ is_active: false });
      await step("+96265000003"); // → Amman city (listing is not in Abdoun)
      await db("contact_numbers").where({ scope: "admin_area" }).update({ is_active: false });
      await step("+96265000002"); // → country
      await db("contact_numbers").where({ scope: "country" }).update({ is_active: false });
      await step("+96265000001"); // → global
      await db("contact_numbers").where({ scope: "global" }).update({ is_active: false });
      await step(null); // nothing → no number at all (never the lister's)
      // A suspended supervisor account falls back too.
      await db("supervisor_profiles").where({ user_id: supAmman }).update({ is_active: true });
      await db("contact_numbers").update({ is_active: true });
      await db("users").where({ id: supAmman }).update({ status: "suspended" });
      await step("+96265000005");
    } finally {
      await db("users").where({ id: supAmman }).update({ status: "active" });
      await db("supervisor_profiles").where({ user_id: supAmman }).update({ is_active: true });
      await db("contact_numbers").update({ is_active: true });
    }
    expect(steps).toHaveLength(7);

    // Every published listing, as the public API returns it.
    for (const id of await db("properties").whereIn("status", ["published", "reserved"]).pluck("id")) {
      const res = await request(app).get(`/api/v1/listings/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.listing.contact).not.toBeNull();
      expect(phones.has(res.body.listing.contact.phone)).toBe(false);
      for (const p of phones) expect(res.text).not.toContain(p.slice(4));
    }
  });
});

describe("supervisor management API (super_admin)", () => {
  const base = "/api/v1/backoffice/supervisors";
  const body = { name: "سلمى الحسن", email: "new.sup@aqar.test", workPhone: "079 000 0123", whatsapp: true, titleAr: "مشرفة", titleEn: "Supervisor" };

  beforeEach(async () => {
    // Re-created per test.
    const existing = await db("users").where({ email: body.email }).first("id");
    if (existing) await dropSupervisor(existing.id);
  });

  it("is staff-only, and supervisor management is super_admin only", async () => {
    expect((await request(app).get(base)).status).toBe(401);
    expect((await request(app).get(base).set("Cookie", await login("owner1@aqar.test"))).status).toBe(403);
    expect((await request(app).get(base).set("Cookie", await login("agent1@aqar.test"))).status).toBe(403);
    expect((await request(app).get(base).set("Cookie", await login("sup.amman@aqar.test"))).status).toBe(403);
    const list = await request(app).get(base).set("Cookie", admin);
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.body.supervisors.map((s: { email: string }) => s.email).sort()).toEqual(["sup.amman@aqar.test", "sup.regions@aqar.test"]);
    expect(Object.keys(list.body.supervisors[0]).sort()).toEqual(
      ["accountActive", "createdAt", "email", "id", "isActive", "mustChangePassword", "name", "openListings", "scopes", "titleAr", "titleEn", "whatsapp", "workPhone"].sort(),
    );
  });

  it("creates a new account with a one-time password shown once — never stored, logged or audited", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.join(" "))));
    let res;
    try {
      res = await request(app).post(base).set("Cookie", admin).send(body);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    expect(res.status).toBe(201);
    const { id, oneTimePassword } = res.body as { id: number; oneTimePassword: string };
    expect(oneTimePassword).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
    expect(logs.join("\n")).not.toContain(oneTimePassword);

    const user = await db("users").where({ id }).first();
    expect(user).toMatchObject({ role: "supervisor", must_change_password: true, status: "active" });
    expect(user.password_hash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(user)).not.toContain(oneTimePassword);
    const profile = await db("supervisor_profiles").where({ user_id: id }).first();
    expect(profile).toMatchObject({ work_phone_e164: "+962790000123", work_phone_whatsapp: true, title_ar: "مشرفة", is_active: true });

    const audit = await db("audit_log").where({ entity_type: "user", entity_id: id }).orderBy("id").select("action", "actor_user_id", "before", "after");
    expect(audit.map((a) => a.action)).toEqual(["supervisor_created", "password_issued"]);
    expect(audit[0].after).toMatchObject({ role: "supervisor", name: CHANGED, email: CHANGED, work_phone: CHANGED });
    expect(audit[1]).toMatchObject({ actor_user_id: superAdmin.id, before: null, after: null });
    const everything = JSON.stringify(await db("audit_log").select());
    for (const secret of [oneTimePassword, body.email, body.name, "790000123"]) expect(everything).not.toContain(secret);

    // Always a new account: an existing owner's email is refused.
    const taken = await request(app).post(base).set("Cookie", admin).send({ ...body, email: "owner1@aqar.test" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("email_taken");
    expect((await db("users").where({ email: "owner1@aqar.test" }).first("role")).role).toBe("owner");
    const badPhone = await request(app).post(base).set("Cookie", admin).send({ ...body, email: "x@aqar.test", workPhone: "12345" });
    expect(badPhone.body.fields.workPhone).toBe("phone_invalid");
  });

  it("must_change_password: 403 everywhere except changing it; the change clears it and ends other sessions", async () => {
    const created = await request(app).post(base).set("Cookie", admin).send(body);
    const { id, oneTimePassword } = created.body as { id: number; oneTimePassword: string };
    await request(app).put(`${base}/${id}/scopes`).set("Cookie", admin).send({ areaIds: [await areaId("area", "عبدون")] });

    const cookie = await login(body.email, oneTimePassword);
    const other = await login(body.email, oneTimePassword);
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(me.body.user.mustChangePassword).toBe(true);
    for (const path of ["/api/v1/backoffice/supervisors", "/api/v1/backoffice/areas", "/api/v1/my/listings/1", "/api/v1/map/points?bbox=35,31,36,32"]) {
      const r = await request(app).get(path).set("Cookie", cookie);
      expect(r.status, path).toBe(403);
      expect(r.body.error).toBe("password_change_required");
    }

    const wrong = await request(app).post("/api/v1/auth/password").set("Cookie", cookie).send({ currentPassword: "nope", newPassword: "a-new-password", confirmPassword: "a-new-password" });
    expect(wrong.status).toBe(401);
    const mismatch = await request(app).post("/api/v1/auth/password").set("Cookie", cookie).send({ currentPassword: oneTimePassword, newPassword: "a-new-password", confirmPassword: "different" });
    expect(mismatch.body.fields.confirmPassword).toBe("password_mismatch");
    const same = await request(app).post("/api/v1/auth/password").set("Cookie", cookie).send({ currentPassword: oneTimePassword, newPassword: oneTimePassword, confirmPassword: oneTimePassword });
    expect(same.body.fields.newPassword).toBe("password_unchanged");

    const ok = await request(app).post("/api/v1/auth/password").set("Cookie", cookie).send({ currentPassword: oneTimePassword, newPassword: "a-new-password", confirmPassword: "a-new-password" });
    expect(ok.status).toBe(204);
    expect((await db("users").where({ id }).first("must_change_password")).must_change_password).toBe(false);
    // This session continues (not super_admin, so supervisor routes stay 403 — but no longer for the password).
    const after = await request(app).get("/api/v1/backoffice/supervisors").set("Cookie", cookie);
    expect(after.body.error).toBe("forbidden");
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", other)).status).toBe(401);
    const audit = await db("audit_log").where({ entity_type: "user", entity_id: id, action: "password_changed" }).first();
    expect(audit).toMatchObject({ actor_user_id: id, before: null, after: null });
    await expect(login(body.email, oneTimePassword)).rejects.toThrow();
  });

  it("resets the password: new one-time password, flag set, sessions ended, audited", async () => {
    const { id, oneTimePassword } = (await request(app).post(base).set("Cookie", admin).send(body)).body as { id: number; oneTimePassword: string };
    const cookie = await login(body.email, oneTimePassword);
    const res = await request(app).post(`${base}/${id}/password-reset`).set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.oneTimePassword).not.toBe(oneTimePassword);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
    await login(body.email, res.body.oneTimePassword);
    expect((await db("users").where({ id }).first("must_change_password")).must_change_password).toBe(true);
    expect(await db("audit_log").where({ entity_type: "user", entity_id: id, action: "password_issued" }).count({ n: "*" }).first()).toEqual({ n: "2" });
    expect(JSON.stringify(await db("audit_log").where({ entity_id: id }).select())).not.toContain(res.body.oneTimePassword);
    expect((await request(app).post(`${base}/${supAmman + 100000}/password-reset`).set("Cookie", admin)).status).toBe(404);
  });

  it("updates the profile (audited without personal values)", async () => {
    const { id } = (await request(app).post(base).set("Cookie", admin).send(body)).body as { id: number };
    const res = await request(app).patch(`${base}/${id}`).set("Cookie", admin).send({ ...body, name: "سلمى ح.", workPhone: "+962 79 000 0124", whatsapp: false });
    expect(res.status).toBe(200);
    expect(res.body.supervisor).toMatchObject({ name: "سلمى ح.", workPhone: "+962790000124", whatsapp: false });
    const entry = await db("audit_log").where({ entity_id: id, action: "supervisor_updated" }).first();
    expect(entry.before).toEqual({ name: CHANGED, work_phone: CHANGED, whatsapp: true });
    expect(entry.after).toEqual({ name: CHANGED, work_phone: CHANGED, whatsapp: false });
  });

  it("scopes: listings that leave the scope move on, queued listings inside it are picked up", async () => {
    const { id } = (await request(app).post(base).set("Cookie", admin).send(body)).body as { id: number };
    // A queued pending listing in the Amman governorate, outside Amman city.
    const ammanGov = (await db("admin_areas").where({ id: await areaId("city", "عمان") }).first("parent_id")).parent_id as number;
    const govListing = await db("properties").whereIn("status", ["published"]).whereNotNull("admin_area_id").first("id", "admin_area_id");
    const original = govListing.admin_area_id;
    await db("properties").where({ id: govListing.id }).update({ admin_area_id: ammanGov, assigned_supervisor_id: null, assigned_at: null });
    try {
      expect((await request(app).put(`${base}/${id}/scopes`).set("Cookie", admin).send({ areaIds: [999999] })).status).toBe(400);
      const set = await request(app).put(`${base}/${id}/scopes`).set("Cookie", admin).send({ areaIds: [ammanGov] });
      expect(set.status).toBe(200);
      expect(set.body.picked).toBeGreaterThanOrEqual(1);
      expect((await db("properties").where({ id: govListing.id }).first("assigned_supervisor_id")).assigned_supervisor_id).toBe(id);
      // Amman-city listings stay with the deeper Amman-city supervisor (already assigned elsewhere).
      expect(await db("properties").where({ assigned_supervisor_id: id }).count({ n: "*" }).first()).toEqual({ n: String(set.body.picked) });

      const entry = await db("audit_log").where({ entity_id: id, action: "supervisor_scopes_changed" }).orderBy("id", "desc").first();
      expect(entry).toMatchObject({ before: { admin_area_ids: [] }, after: { admin_area_ids: [ammanGov] } });

      // Removing the scope moves its listings to the next match (none for the governorate → the queue).
      const cleared = await request(app).put(`${base}/${id}/scopes`).set("Cookie", admin).send({ areaIds: [] });
      expect(cleared.body.moved).toBe(set.body.picked);
      expect((await db("properties").where({ id: govListing.id }).first("assigned_supervisor_id")).assigned_supervisor_id).toBeNull();
      const moved = await db("audit_log").where({ entity_type: "listing", entity_id: govListing.id, action: "listing_reassigned" }).orderBy("id", "desc").first();
      expect(moved.reason).toBe("scope_changed");
    } finally {
      await db("properties").where({ id: govListing.id }).update({ admin_area_id: original });
      const to = await findAssignee(db, { adminAreaId: original, ownerId: 0 });
      await db("properties").where({ id: govListing.id }).update({ assigned_supervisor_id: to, assigned_at: to ? db.fn.now() : null });
    }
  });

  it("deactivation needs a reason, moves open listings, ends sessions and blocks the back office; reactivation", async () => {
    const abdoun = await areaId("area", "عبدون");
    const { id, oneTimePassword } = (await request(app).post(base).set("Cookie", admin).send(body)).body as { id: number; oneTimePassword: string };
    await request(app).put(`${base}/${id}/scopes`).set("Cookie", admin).send({ areaIds: [abdoun] });
    const abdounListings = await db("properties").where({ admin_area_id: abdoun }).whereIn("status", [...OPEN_LISTING_STATUSES]).pluck("id");
    await db("properties").whereIn("id", abdounListings).update({ assigned_supervisor_id: id, assigned_at: db.fn.now() });
    const cookie = await login(body.email, oneTimePassword);

    const noReason = await request(app).post(`${base}/${id}/active`).set("Cookie", admin).send({ active: false });
    expect(noReason.status).toBe(400);
    expect(noReason.body.fields.reason).toBe("reason_required");
    expect((await request(app).post(`${base}/${id}/active`).set("Cookie", admin).send({ active: false, reason: "" })).status).toBe(400);

    const res = await request(app).post(`${base}/${id}/active`).set("Cookie", admin).send({ active: false, reason: "Left the company" });
    expect(res.status).toBe(200);
    expect(res.body.moved).toBe(abdounListings.length);
    // Back to the next match: the Amman-city supervisor.
    expect(new Set(await db("properties").whereIn("id", abdounListings).pluck("assigned_supervisor_id"))).toEqual(new Set([supAmman]));
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
    const entry = await db("audit_log").where({ entity_id: id, action: "supervisor_deactivated" }).first();
    expect(entry).toMatchObject({ reason: "Left the company", before: { is_active: true }, after: { is_active: false } });
    expect(await db("audit_log").where({ action: "listing_reassigned", reason: "supervisor_deactivated" }).whereIn("entity_id", abdounListings).count({ n: "*" }).first()).toEqual({
      n: String(abdounListings.length),
    });

    // An inactive supervisor with a fresh session still cannot use the back office.
    await db("users").where({ id }).update({ must_change_password: false });
    const fresh = await login(body.email, oneTimePassword);
    expect((await request(app).get("/api/v1/backoffice/areas").set("Cookie", fresh)).status).toBe(403);
    expect((await request(app).post(`${base}/${id}/active`).set("Cookie", admin).send({ active: false, reason: "again" })).status).toBe(409);
    const back = await request(app).post(`${base}/${id}/active`).set("Cookie", admin).send({ active: true, reason: "Rehired" });
    expect(back.status).toBe(200);
  });

  it("validates ids and returns the area tree", async () => {
    expect((await request(app).get(`${base}/abc`).set("Cookie", admin)).status).toBe(404);
    expect((await request(app).get(`${base}/${await userId("owner1@aqar.test")}`).set("Cookie", admin)).status).toBe(404);
    const areas = await request(app).get("/api/v1/backoffice/areas?country=JO").set("Cookie", admin);
    expect(areas.body.countries).toEqual(["JO"]);
    expect(areas.body.areas.length).toBeGreaterThan(100);
    expect(Object.keys(areas.body.areas[0]).sort()).toEqual(["id", "level", "nameAr", "nameEn", "parentId"]);
  });
});
