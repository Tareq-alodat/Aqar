import type { Knex } from "knex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as C from "../../app/shared/constants";
import { createTestDb } from "./test/testDb";

let db: Knex;
beforeAll(() => {
  db = createTestDb();
});
afterAll(async () => {
  await db.destroy();
});

/** Allowed values of a `col IN (...)` CHECK constraint, read from the catalog. */
async function checkValues(table: string, column: string): Promise<string[]> {
  const r = await db.raw<{ rows: Array<{ def: string }> }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = ? AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE ?`,
    [table, `%(${column} = ANY%`],
  );
  expect(r.rows, `${table}.${column} CHECK`).toHaveLength(1);
  return [...r.rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!).sort();
}

describe("migrations", () => {
  it("roll all the way back to PostGIS and up again", async () => {
    const [, pending0] = (await db.migrate.list()) as [unknown[], unknown[]];
    expect(pending0).toHaveLength(0);
    // Down to just after enable_postgis (its own down can't drop extensions other images add).
    for (;;) {
      const [done] = (await db.migrate.list()) as [Array<{ name: string }>, unknown[]];
      if (done.length <= 1) break;
      await db.migrate.down();
    }
    expect(await db.schema.hasTable("properties")).toBe(false);
    expect(await db.schema.hasTable("countries")).toBe(false);
    await db.migrate.latest();
    expect(await db.schema.hasTable("property_identifiers")).toBe(true);
  });

  it("insert the reference data", async () => {
    expect(await db("countries").orderBy("code").pluck("code")).toEqual(["AE", "JO", "KW", "SA"]);
    expect(await db("countries").where({ is_active: true }).pluck("code")).toEqual(["JO"]);
    const jordan = await db("country_address_fields").where({ country_code: "JO" }).orderBy("position").pluck("field_key");
    expect(jordan).toEqual(["governorate", "city", "area", "street", "building_number", "apartment_number", "jo_land_parcel"]);
    expect(jordan).not.toContain("floor");
  });
});

describe("CHECK constraints match app/shared/constants.ts", () => {
  it.each([
    ["properties", "status", C.LISTING_STATUSES],
    ["properties", "category", C.CATEGORIES],
    ["properties", "listing_type", C.LISTING_TYPES],
    ["properties", "rent_period", C.RENT_PERIODS],
    ["properties", "furnished", C.FURNISHED_OPTIONS],
    ["properties", "location_precision", C.LOCATION_PRECISIONS],
    ["properties", "offers_visibility", C.OFFERS_VISIBILITIES],
    ["users", "role", C.ROLES],
    ["users", "status", C.USER_STATUSES],
    ["address_fields", "kind", C.ADDRESS_FIELD_KINDS],
    ["country_address_fields", "visibility", C.ADDRESS_VISIBILITIES],
    ["admin_areas", "source", C.BOUNDARY_SOURCES],
    ["contact_numbers", "scope", C.CONTACT_SCOPES],
  ] as const)("%s.%s", async (table, column, values) => {
    expect(await checkValues(table, column)).toEqual([...values].sort());
  });
});

describe("properties constraints", () => {
  let owner: number;
  beforeAll(async () => {
    const [u] = await db("users").insert({ email: "constraints@aqar.test", password_hash: "x", name: "T" }).returning("id");
    owner = u.id;
  });

  const draft = (extra: Record<string, unknown> = {}) => ({
    owner_id: owner,
    country_code: "JO",
    category: "land",
    listing_type: "sale",
    ...extra,
  });

  it("sets currency from the country, ignoring input", async () => {
    const [row] = await db("properties").insert(draft({ currency: "USD" })).returning("currency");
    expect(row.currency).toBe("JOD");
  });

  it.each([
    ["rent without rent_period", { listing_type: "rent" }],
    ["rent_period on a sale", { rent_period: "monthly" }],
    ["unknown status", { status: "deleted" }],
    ["published without location, price or phone", { status: "published", title_ar: "x", published_at: new Date() }],
    ["negative price", { price: -1 }],
    // EWKT, not db.raw(): it.each tables are built before beforeAll creates db.
    ["point without display_point", { point: "SRID=4326;POINT(35.9 31.9)" }],
    ["address that is not an object", { address: JSON.stringify(["x"]) }],
    ["rejected without a reason", { status: "rejected" }],
  ])("rejects %s", async (_, extra) => {
    await expect(db("properties").insert(draft(extra))).rejects.toThrow(/violates/);
  });

  it("accepts an exchange listing without a price", async () => {
    await expect(
      db("properties").insert(
        draft({
          listing_type: "exchange",
          status: "pending",
          title_ar: "أرض للبدل",
          point: db.raw("ST_SetSRID(ST_MakePoint(35.9, 31.9), 4326)::geography"),
          display_point: db.raw("ST_SetSRID(ST_MakePoint(35.9, 31.9), 4326)::geography"),
          owner_phone_encrypted: "v1:x:y:z",
          owner_phone_hash: "h",
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("enforces one identifier per scheme per listing", async () => {
    const [p] = await db("properties").insert(draft()).returning("id");
    const row = { property_id: p.id, country_code: "JO", scheme: "jo_land_parcel", value: "a/b/c/1", value_normalized: "A/B/C/1" };
    await db("property_identifiers").insert(row);
    await expect(db("property_identifiers").insert(row)).rejects.toThrow(/unique/);
  });

  it("checks contact number scope targets", async () => {
    await expect(db("contact_numbers").insert({ phone_number: "+96265000009", scope: "country" })).rejects.toThrow(/violates/);
    await expect(
      db("contact_numbers").insert({ phone_number: "+96265000009", scope: "global", country_code: "JO" }),
    ).rejects.toThrow(/violates/);
    await expect(db("contact_numbers").insert({ phone_number: "+96265000009", scope: "global" })).resolves.toBeDefined();
  });

  it("treats emails case-insensitively", async () => {
    await expect(db("users").insert({ email: "CONSTRAINTS@aqar.test", password_hash: "x", name: "T" })).rejects.toThrow(/unique/);
  });

  afterAll(async () => {
    await db.raw("TRUNCATE contact_numbers, property_identifiers, properties, users RESTART IDENTITY CASCADE");
  });
});
