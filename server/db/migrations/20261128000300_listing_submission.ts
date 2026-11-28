import type { Knex } from "knex";

/**
 * Milestone 6 — listing submission (SPEC §7, §19, §4.3).
 * - Every listing is public as an approximate area (milestone 6 decision): existing
 *   `exact` listings get a public point 150–300 m from the pin in a random direction,
 *   computed once here and stored (never per request), and the column only accepts
 *   `approximate` from now on. The true pin is unchanged.
 * - Commission terms accepted at submission, and who pays (from the submitter's role).
 * - Per-country commission rate (default 1 %), shown on the terms page and copied into
 *   each commission record later (milestone 7/8). The payment period comes with milestone 7.
 * No CHECK ties terms acceptance to the status: listings created before this milestone
 * (dev data) have none, and acceptance must not be made up; submission enforces it.
 */
export async function up(knex: Knex): Promise<void> {
  // ST_Project(geography, metres, azimuth in radians): same 150–300 m range as computeDisplayPoint.
  await knex.raw(`
    UPDATE properties
       SET location_precision = 'approximate',
           display_point = ST_Project(point, 150 + random() * 150, random() * 2 * pi())
     WHERE location_precision = 'exact' AND point IS NOT NULL
  `);
  // Drafts without a pin.
  await knex.raw("UPDATE properties SET location_precision = 'approximate' WHERE location_precision = 'exact'");
  await knex.raw("ALTER TABLE properties ALTER COLUMN location_precision SET DEFAULT 'approximate'");
  await knex.raw("ALTER TABLE properties ADD CONSTRAINT properties_location_approximate CHECK (location_precision = 'approximate')");

  await knex.schema.alterTable("properties", (t) => {
    t.enu("commission_payer_type", ["agent", "owner"]);
    t.text("commission_terms_version");
    t.timestamp("commission_terms_accepted_at", { useTz: true });
    t.check("(commission_terms_version IS NULL) = (commission_terms_accepted_at IS NULL)", [], "properties_terms_pair");
  });
  // Per-lister draft counts and submissions in the last 24 h (limits, SPEC §7).
  await knex.raw("CREATE INDEX properties_owner_status ON properties (owner_id, status)");

  await knex.schema.alterTable("countries", (t) => {
    t.decimal("commission_rate", 6, 4).notNullable().defaultTo(0.01);
    t.check("commission_rate >= 0 AND commission_rate < 1", [], "countries_commission_rate");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("countries", (t) => {
    t.dropChecks(["countries_commission_rate"]);
    t.dropColumn("commission_rate");
  });
  await knex.raw("DROP INDEX IF EXISTS properties_owner_status");
  // Public points stay approximate: the old exact display points are not restored.
  await knex.raw("ALTER TABLE properties DROP CONSTRAINT properties_location_approximate");
  await knex.raw("ALTER TABLE properties ALTER COLUMN location_precision SET DEFAULT 'exact'");
  await knex.schema.alterTable("properties", (t) => {
    t.dropChecks(["properties_terms_pair"]);
    t.dropColumn("commission_terms_accepted_at");
    t.dropColumn("commission_terms_version");
    t.dropColumn("commission_payer_type");
  });
}
