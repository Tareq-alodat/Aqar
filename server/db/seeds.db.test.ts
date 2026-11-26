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

  it("creates 1 admin, 2 agents in a verified company and 3 owners", async () => {
    expect(await db("users").orderBy("role").pluck("role")).toEqual(["admin", "agent", "agent", "owner", "owner", "owner"]);
    expect(await count(db("users").where({ role: "agent" }).whereNotNull("company_id"))).toBe(2);
    expect((await db("companies").first()).is_verified).toBe(true);
    const admin = await db("users").where({ role: "admin" }).first();
    expect(await verifyPassword(DEV_PASSWORD, admin.password_hash)).toBe(true);
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

  it("keeps every owner within the 5 active listing limit", async () => {
    const rows = await db("properties as p")
      .join("users as u", "u.id", "p.owner_id")
      .where("u.role", "owner")
      .whereIn("p.status", ["pending", "published", "reserved"])
      .groupBy("p.owner_id")
      .select("p.owner_id")
      .count({ n: "*" });
    for (const r of rows) expect(Number(r.n)).toBeLessThanOrEqual(5);
  });

  it("covers the six seed neighbourhoods and both precisions", async () => {
    const names = await db("properties as p").join("admin_areas as a", "a.id", "p.admin_area_id").distinct("a.name_ar").pluck("a.name_ar");
    for (const n of ["عبدون", "خلدا", "الصويفية", "الجبيهة", "دابوق", "تلاع العلي"]) expect(names).toContain(n);
    expect(await count(db("properties").where({ location_precision: "approximate" }))).toBeGreaterThan(0);
  });

  it("stores approximate display points 150–300 m from the true point, exact ones equal", async () => {
    const r = await db.raw<{ rows: Array<{ location_precision: string; d: number }> }>(
      "SELECT location_precision, ST_Distance(point, display_point) AS d FROM properties",
    );
    for (const row of r.rows) {
      if (row.location_precision === "exact") expect(row.d).toBe(0);
      else {
        expect(row.d).toBeGreaterThanOrEqual(149);
        expect(row.d).toBeLessThanOrEqual(301);
      }
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
