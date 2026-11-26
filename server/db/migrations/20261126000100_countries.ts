import type { Knex } from "knex";

/**
 * Countries (SPEC §2.1) plus the shared `set_updated_at()` trigger function
 * used by later tables. Countries are reference data needed in every
 * environment (seeds don't run in production), so they are inserted here.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await knex.schema.createTable("countries", (t) => {
    t.specificType("code", "char(2)").primary();
    t.text("name_ar").notNullable();
    t.text("name_en").notNullable();
    t.specificType("currency", "char(3)").notNullable();
    t.smallint("currency_decimals").notNullable();
    t.text("phone_prefix").notNullable();
    t.specificType("default_center", "geography(Point,4326)").notNullable();
    t.smallint("default_zoom").notNullable();
    t.boolean("is_active").notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.check("code ~ '^[A-Z]{2}$'", [], "countries_code_format");
    t.check("currency ~ '^[A-Z]{3}$'", [], "countries_currency_format");
    t.check("currency_decimals BETWEEN 0 AND 3", [], "countries_currency_decimals");
    t.check("default_zoom BETWEEN 0 AND 22", [], "countries_default_zoom");
  });
  await knex.raw(
    "CREATE TRIGGER countries_updated_at BEFORE UPDATE ON countries FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
  );

  const countries = [
    { code: "JO", name_ar: "الأردن", name_en: "Jordan", currency: "JOD", decimals: 3, prefix: "+962", lng: 35.9106, lat: 31.9539, zoom: 8, active: true },
    { code: "SA", name_ar: "السعودية", name_en: "Saudi Arabia", currency: "SAR", decimals: 2, prefix: "+966", lng: 46.6753, lat: 24.7136, zoom: 5, active: false },
    { code: "KW", name_ar: "الكويت", name_en: "Kuwait", currency: "KWD", decimals: 3, prefix: "+965", lng: 47.9774, lat: 29.3759, zoom: 9, active: false },
    { code: "AE", name_ar: "الإمارات", name_en: "United Arab Emirates", currency: "AED", decimals: 2, prefix: "+971", lng: 54.3773, lat: 24.4539, zoom: 7, active: false },
  ];
  for (const c of countries) {
    await knex.raw(
      `INSERT INTO countries (code, name_ar, name_en, currency, currency_decimals, phone_prefix, default_center, default_zoom, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?, ?)`,
      [c.code, c.name_ar, c.name_en, c.currency, c.decimals, c.prefix, c.lng, c.lat, c.zoom, c.active],
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("countries");
  await knex.raw("DROP FUNCTION IF EXISTS set_updated_at()");
}
