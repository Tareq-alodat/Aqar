import type { Knex } from "knex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectContacts, stripContactsForIndex } from "../../app/shared/contactDetails";
import { CLEAN_TEXTS, CONTACT_FIXTURES } from "../../app/shared/contactDetails.fixtures";
import { normalizeSearchText } from "../../app/shared/normalizeText";
import { seed } from "./seeds/01_dev_data";
import { createTestDb } from "./test/testDb";

/** The SQL side of text search (SPEC §5.6) and contact stripping (§8.1), checked against the TypeScript twins. */

let db: Knex;

beforeAll(async () => {
  db = createTestDb();
  await seed(db);
});
afterAll(async () => {
  await db.destroy();
});

const sql = async (fn: string, input: string): Promise<string> => (await db.raw(`SELECT ${fn}(?) AS v`, [input])).rows[0].v;
/** The words of a text (the SQL function also drops the punctuation around a detail). */
const squash = (s: string) => s.split(/[^\p{L}\p{N}_]+/u).filter(Boolean).join(" ");

describe("aqar_normalize_ar", () => {
  it("matches normalizeSearchText", async () => {
    const samples = ["شَقَّة", "أإآ ى ة", "عـــبدون", "ٱلرَّحمٰن", "٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹", "ABDOUN Villa", ...CLEAN_TEXTS, ...CONTACT_FIXTURES.map((f) => f.text)];
    for (const s of samples) expect(await sql("aqar_normalize_ar", s)).toBe(normalizeSearchText(s));
  });
});

describe("aqar_strip_contacts", () => {
  it("removes every fixture's contact detail, like stripContactsForIndex", async () => {
    for (const { text } of CONTACT_FIXTURES) {
      const stripped = await sql("aqar_strip_contacts", normalizeSearchText(text));
      expect(detectContacts(stripped), text).toEqual([]);
      expect(squash(stripped), text).toBe(squash(stripContactsForIndex(text)));
    }
  });

  it("keeps clean listing text", async () => {
    for (const text of CLEAN_TEXTS) {
      const n = normalizeSearchText(text);
      expect(await sql("aqar_strip_contacts", n)).toBe(n);
    }
  });
});

describe("listing search columns", () => {
  const listing = async () =>
    (await db("properties").where({ status: "published" }).whereNotNull("admin_area_id").orderBy("id").first("id", "admin_area_id", "updated_at")) as {
      id: number;
      admin_area_id: number;
      updated_at: Date;
    };
  const columns = async (id: number) =>
    (await db("properties").where({ id }).first("search_norm", db.raw("search_tsv::text AS tsv"))) as { search_norm: string; tsv: string };

  it("index titles and the area path, normalized, without contact details", async () => {
    const { id } = await listing();
    await db("properties")
      .where({ id })
      .update({ title_ar: "شَقّة مميزة للتواصل 0791234567", description_ar: "راسلنا واتساب أو ahmad@mail.com", title_en: "Nice flat www.example.com" });
    const c = await columns(id);
    expect(c.search_norm).toContain("شقه مميزه");
    expect(c.search_norm).toContain("nice flat");
    expect(c.search_norm).toMatch(/عمان/);
    for (const leaked of ["0791234567", "واتساب", "ahmad", "example"]) {
      expect(c.search_norm).not.toContain(leaked);
      expect(c.tsv).not.toContain(leaked);
    }
  });

  it("are refreshed when an area on the path is renamed", async () => {
    const { id, admin_area_id } = await listing();
    const parent = (await db("admin_areas").where({ id: admin_area_id }).first("parent_id")).parent_id as number;
    const before = await db("admin_areas").where({ id: parent }).first("name_en");
    try {
      await db("admin_areas").where({ id: parent }).update({ name_en: "Renamedcity" });
      expect((await columns(id)).search_norm).toContain("renamedcity");
    } finally {
      await db("admin_areas").where({ id: parent }).update({ name_en: before.name_en });
    }
    expect((await columns(id)).search_norm).not.toContain("renamedcity");
  });

  it("give areas a normalized name for autocomplete", async () => {
    const a = await db("admin_areas").where({ name_en: "Abdoun" }).first("search_norm");
    expect(a.search_norm).toBe("عبدون abdoun");
  });
});
