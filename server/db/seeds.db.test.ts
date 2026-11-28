import type { Knex } from "knex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSecrets } from "../env";
import { decrypt } from "../services/cryptoService";
import { findIdentifierMatches, getIdentifierScheme } from "../services/identifierService";
import { verifyPassword } from "../services/passwordService";
import { createTestDb } from "./test/testDb";
import { DEV_PASSWORD, seed } from "./seeds/01_dev_data";

let db: Knex;

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
});
afterAll(async () => {
  await db.destroy();
});

const count = async (q: Knex.QueryBuilder) => Number((await q.count({ n: "*" }).first())?.n);

describe("dev seed (SPEC §17)", () => {
  it("refuses to run in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(seed(db)).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("creates 1 super_admin, 2 supervisors, 2 agents in a verified company and 3 owners", async () => {
    expect(await db("users").orderBy("role").pluck("role")).toEqual(["agent", "agent", "owner", "owner", "owner", "super_admin", "supervisor", "supervisor"]);
    expect(await count(db("users").where({ role: "agent" }).whereNotNull("company_id"))).toBe(2);
    expect((await db("companies").first()).is_verified).toBe(true);
    const admin = await db("users").where({ role: "super_admin" }).first();
    expect(await verifyPassword(DEV_PASSWORD, admin.password_hash)).toBe(true);
    expect(await count(db("users").where({ must_change_password: true }))).toBe(0);
  });

  it("gives the supervisors work mobiles and scopes: Amman city, and the other governorates", async () => {
    const sups = await db("supervisor_profiles as sp").join("users as u", "u.id", "sp.user_id").orderBy("u.email").select("u.id", "u.email", "sp.work_phone_e164", "sp.is_active");
    expect(sups.map((s) => s.email)).toEqual(["sup.amman@aqar.test", "sup.regions@aqar.test"]);
    for (const s of sups) {
      expect(s.work_phone_e164).toMatch(/^\+9627\d{8}$/);
      expect(s.is_active).toBe(true);
    }
    const scope = (id: number) => db("supervisor_scopes as s").join("admin_areas as a", "a.id", "s.admin_area_id").where("s.supervisor_id", id).select("a.level", "a.name_ar", "a.id", "a.parent_id");
    const amman = await scope(sups[0].id);
    expect(amman.map((a) => [a.level, a.name_ar])).toEqual([["city", "عمان"]]);
    const regions = await scope(sups[1].id);
    const governorates = await db("admin_areas").where({ country_code: "JO", level: "governorate" }).pluck("id");
    expect(regions.every((a) => a.level === "governorate")).toBe(true);
    expect(regions).toHaveLength(governorates.length - 1);
    expect(regions.map((a) => a.id)).not.toContain(amman[0].parent_id);
  });

  it("assigns every seeded listing to the supervisor of its area, else the super_admin's queue", async () => {
    const rows = await db("properties as p")
      .leftJoin("admin_areas as a", "a.id", "p.admin_area_id")
      .select("p.id", "p.admin_area_id", "p.assigned_supervisor_id", "p.assigned_at");
    const [ammanSup] = await db("users").where({ email: "sup.amman@aqar.test" }).pluck("id");
    let amman = 0;
    for (const r of rows) {
      if (r.admin_area_id === null) {
        expect(r.assigned_supervisor_id).toBeNull();
        continue;
      }
      expect(r.assigned_supervisor_id === null).toBe(r.assigned_at === null);
      if (r.assigned_supervisor_id === ammanSup) amman++;
    }
    // The six seed neighbourhoods are in Amman city.
    expect(amman).toBeGreaterThanOrEqual(30);
    expect(await count(db("properties").whereNotNull("admin_area_id").whereNull("assigned_supervisor_id"))).toBeLessThan(rows.length);
  });

  it("creates 40 published, 3 pending and 2 sold listings", async () => {
    const byStatus = Object.fromEntries(
      (await db.raw<{ rows: Array<{ status: string; n: number }> }>("SELECT status, count(*)::int AS n FROM properties GROUP BY status")).rows.map(
        (r) => [r.status, r.n],
      ),
    );
    expect(byStatus).toEqual({ published: 40, pending: 3, sold: 2 });
  });

  it("flags one pending listing for location review", async () => {
    const flagged = await db("properties").where({ needs_location_review: true }).select("status", "admin_area_id");
    expect(flagged).toEqual([{ status: "pending", admin_area_id: null }]);
  });

  it("records accepted commission terms on every submitted listing, dated outside today's submission window", async () => {
    const rows = await db("properties")
      .whereNot({ status: "draft" })
      .select("commission_payer_type", "commission_terms_version", db.raw("commission_terms_accepted_at < now() - interval '1 day' AS old"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["agent", "owner"]).toContain(r.commission_payer_type);
      expect(r.commission_terms_version).toBeTruthy();
      expect(r.old).toBe(true);
    }
  });

  it("covers the six seed neighbourhoods; every listing is approximate", async () => {
    const names = await db("properties as p").join("admin_areas as a", "a.id", "p.admin_area_id").distinct("a.name_ar").pluck("a.name_ar");
    for (const n of ["عبدون", "خلدا", "الصويفية", "الجبيهة", "دابوق", "تلاع العلي"]) expect(names).toContain(n);
    expect(await count(db("properties").whereNot({ location_precision: "approximate" }))).toBe(0);
  });

  it("stores every display point 150–300 m from the true point", async () => {
    const r = await db.raw<{ rows: Array<{ location_precision: string; d: number }> }>(
      "SELECT location_precision, ST_Distance(point, display_point) AS d FROM properties",
    );
    for (const row of r.rows) {
      expect(row.location_precision).toBe("approximate");
      expect(row.d).toBeGreaterThanOrEqual(149);
      expect(row.d).toBeLessThanOrEqual(301);
    }
  });

  it("prices in JOD with no plaintext phones stored", async () => {
    expect(await db("properties").distinct("currency").pluck("currency")).toEqual(["JOD"]);
    const { encryptionKey } = requireSecrets();
    const rows = await db("properties").select("owner_phone_encrypted");
    for (const r of rows) {
      expect(r.owner_phone_encrypted).not.toMatch(/\+962/);
      expect(decrypt(r.owner_phone_encrypted, encryptionKey)).toMatch(/^\+9627\d{8}$/);
    }
  });

  it("creates the five contact number scopes", async () => {
    expect((await db("contact_numbers").orderBy("scope").pluck("scope")).sort()).toEqual(
      ["admin_area", "admin_area", "country", "global", "property"].sort(),
    );
  });

  describe("property identifiers", () => {
    it("has one verified identifier", async () => {
      expect(await count(db("property_identifiers").whereNotNull("verified_at"))).toBe(1);
    });

    it("detects the duplicate typed with different digits and letters", async () => {
      const scheme = (await getIdentifierScheme(db, "jo_land_parcel"))!;
      const rows = await db("property_identifiers").orderBy("property_id").select("property_id", "value", "value_normalized");
      const [, dupA, dupB] = rows;
      expect(dupA.value).not.toBe(dupB.value);
      expect(dupA.value_normalized).toBe(dupB.value_normalized);
      const matches = await findIdentifierMatches(db, {
        countryCode: "JO",
        scheme,
        valueNormalized: dupA.value_normalized,
        excludePropertyId: dupA.property_id,
      });
      expect(matches.duplicates.map((m) => m.property_id)).toEqual([dupB.property_id]);
      expect(matches.sameBuilding).toEqual([]);
    });

    it("reports apartments in the same parcel as same-building, not duplicates", async () => {
      const scheme = (await getIdentifierScheme(db, "jo_land_parcel"))!;
      const rows = await db("property_identifiers").orderBy("property_id").select("property_id", "value_normalized");
      const [, , , aptA, aptB] = rows;
      const matches = await findIdentifierMatches(db, {
        countryCode: "JO",
        scheme,
        valueNormalized: aptA.value_normalized,
        excludePropertyId: aptA.property_id,
      });
      expect(matches.duplicates).toEqual([]);
      expect(matches.sameBuilding.map((m) => m.property_id)).toEqual([aptB.property_id]);
    });
  });
});
