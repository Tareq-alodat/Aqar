import type { Knex } from "knex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findAdminAreaForPoint, getAreaPath } from "../../services/locationService";
import { createTestDb } from "../test/testDb";
import { importBoundaries, type ImportReport } from "./importBoundaries";

let db: Knex;
let first: ImportReport;

beforeAll(async () => {
  db = createTestDb();
  await db.raw("TRUNCATE admin_areas RESTART IDENTITY CASCADE");
  first = await importBoundaries(db, "JO");
});
afterAll(async () => {
  // Undo the "re-running" edits (renamed manual area) so later files start from clean boundaries.
  await db.raw("TRUNCATE admin_areas RESTART IDENTITY CASCADE");
  await db.destroy();
});

const area = (level: string, nameAr: string) =>
  db("admin_areas").where({ country_code: "JO", level, name_ar: nameAr, is_active: true }).first();

describe("Jordan boundary import", () => {
  it("imports 12 governorates, 4 cities and the Amman neighbourhoods", async () => {
    expect(first.byLevel.governorate).toBe(12);
    expect(first.byLevel.city).toBe(4);
    expect(first.byLevel.area).toBeGreaterThanOrEqual(140);
    expect(first.inserted).toBe(first.byLevel.governorate! + first.byLevel.city! + first.byLevel.area!);
  });

  it("produces valid shapes with no overlapping neighbours", async () => {
    expect(first.warnings.filter((w) => w.startsWith("invalid geometry") || w.startsWith("overlap"))).toEqual([]);
  });

  it.each(["عبدون", "خلدا", "الصويفية", "الجبيهة", "دابوق", "تلاع العلي"])("has seed area %s under Amman city", async (name) => {
    const row = await area("area", name);
    expect(row, name).toBeDefined();
    const path = await getAreaPath(db, row.id);
    expect(path.map((p) => p.level)).toEqual(["governorate", "city", "area"]);
    expect(path[0]!.name_en).toBe("Amman");
    expect(path[1]!.slug).toBe("amman");
  });

  it("keeps Dabouq's drawn OSM outline and marks generated cells", async () => {
    expect((await area("area", "دابوق")).source).toBe("osm");
    expect((await area("area", "عبدون")).source).toBe("generated");
    expect((await area("city", "عمان")).source).toBe("generated");
    expect((await area("governorate", "إربد")).source).toBe("osm");
  });

  it("flags transliterated English names for review", async () => {
    expect(first.unreviewedNames).toBeGreaterThan(0);
    const unreviewed = await db("admin_areas").where({ name_en_reviewed: false }).select("name_en");
    for (const r of unreviewed) expect(r.name_en).toMatch(/^[A-Za-z' -]+$/);
  });

  it("finds the deepest area for a pin, then walks up", async () => {
    const abdoun = await area("area", "عبدون");
    const centroid = await db.raw("SELECT ST_X(centroid::geometry) AS lng, ST_Y(centroid::geometry) AS lat FROM admin_areas WHERE id = ?", [abdoun.id]);
    const match = await findAdminAreaForPoint(db, "JO", centroid.rows[0]);
    expect(match).toEqual({ areaId: abdoun.id, needsLocationReview: false });
  });

  it("resolves pins outside Amman to the city or governorate", async () => {
    const irbidCity = await area("city", "إربد");
    const irbidCentroid = await db.raw("SELECT ST_X(centroid::geometry) AS lng, ST_Y(centroid::geometry) AS lat FROM admin_areas WHERE id = ?", [irbidCity.id]);
    expect((await findAdminAreaForPoint(db, "JO", irbidCentroid.rows[0]))?.areaId).toBe(irbidCity.id);

    const wadiRum = { lng: 35.42, lat: 29.57 }; // Aqaba governorate, outside Aqaba city's districts? either is fine
    const rum = await findAdminAreaForPoint(db, "JO", wadiRum);
    const rumLevel = await db("admin_areas").where({ id: rum?.areaId }).first("level");
    expect(["governorate", "city"]).toContain(rumLevel.level);
  });

  it("returns null far outside Jordan", async () => {
    expect(await findAdminAreaForPoint(db, "JO", { lng: 36.29, lat: 33.51 })).toBeNull(); // Damascus
  });

  describe("re-running", () => {
    let ids: Record<string, number>;
    beforeAll(async () => {
      ids = Object.fromEntries((await db("admin_areas").select("id", "source_ref")).map((r) => [r.source_ref, r.id]));
      // An admin reviewed one name and drew one area by hand.
      await db("admin_areas").where({ name_ar: "عبدون", level: "area" }).update({ name_en: "Abdoun (reviewed)", name_en_reviewed: true });
      await db("admin_areas").where({ name_ar: "خلدا", level: "area" }).update({ source: "manual", name_ar: "خلدا (يدوي)" });
    });

    it("updates in place with the same ids and slugs", async () => {
      const second = await importBoundaries(db, "JO");
      expect(second.inserted).toBe(0);
      expect(second.deactivated).toBe(0);
      expect(second.skippedManual).toBe(1);
      const after = Object.fromEntries((await db("admin_areas").select("id", "source_ref")).map((r) => [r.source_ref, r.id]));
      expect(after).toEqual(ids);
    });

    it("keeps a reviewed English name and never touches manual areas", async () => {
      expect((await db("admin_areas").where({ name_ar: "عبدون", level: "area" }).first()).name_en).toBe("Abdoun (reviewed)");
      expect(await db("admin_areas").where({ name_ar: "خلدا (يدوي)" }).first()).toBeDefined();
    });
  });
});
