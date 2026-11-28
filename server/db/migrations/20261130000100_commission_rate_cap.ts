import type { Knex } from "knex";

/**
 * Legal & tax update (terms 2026-12-v1, SPEC §19):
 * - The commission rate is agreed per lister/listing, > 0 and at most a per-country
 *   cap (`countries.commission_rate_max`, Jordan 5 %); the country's `commission_rate`
 *   (1 %) is the default when no agreement exists.
 * - The rate a listing was submitted with is stored on it (`properties.commission_rate`),
 *   next to the accepted terms version, and changes only through a recorded agreement
 *   (milestone 11). Listings submitted before this get the country default they were shown.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("countries", (t) => {
    t.decimal("commission_rate_max", 6, 4).notNullable().defaultTo(0.05);
    t.dropChecks(["countries_commission_rate"]);
  });
  await knex.raw(`ALTER TABLE countries ADD CONSTRAINT countries_commission_rate
    CHECK (commission_rate > 0 AND commission_rate_max > 0 AND commission_rate_max < 1 AND commission_rate <= commission_rate_max)`);

  await knex.schema.alterTable("properties", (t) => {
    t.decimal("commission_rate", 6, 4);
  });
  await knex.raw(`UPDATE properties p SET commission_rate = c.commission_rate
                    FROM countries c WHERE c.code = p.country_code AND p.commission_terms_version IS NOT NULL`);
  await knex.raw(`ALTER TABLE properties ADD CONSTRAINT properties_commission_rate
    CHECK ((commission_rate IS NULL) = (commission_terms_version IS NULL) AND (commission_rate IS NULL OR (commission_rate > 0 AND commission_rate < 1)))`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("ALTER TABLE properties DROP CONSTRAINT properties_commission_rate");
  await knex.schema.alterTable("properties", (t) => {
    t.dropColumn("commission_rate");
  });
  await knex.raw("ALTER TABLE countries DROP CONSTRAINT countries_commission_rate");
  await knex.schema.alterTable("countries", (t) => {
    t.dropColumn("commission_rate_max");
  });
  await knex.raw("ALTER TABLE countries ADD CONSTRAINT countries_commission_rate CHECK (commission_rate >= 0 AND commission_rate < 1)");
}
