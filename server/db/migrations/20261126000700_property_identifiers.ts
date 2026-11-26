import type { Knex } from "knex";

/**
 * Property/unit identifiers (SPEC §2.4). Never public; personal civil IDs are
 * never stored. The (country_code, scheme, value_normalized) index serves both
 * exact duplicate lookups and "same building" prefix lookups (text_pattern_ops).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("property_identifiers", (t) => {
    t.increments("id");
    t.integer("property_id").notNullable().references("id").inTable("properties").onDelete("CASCADE");
    t.specificType("country_code", "char(2)").notNullable().references("code").inTable("countries").onDelete("RESTRICT");
    t.text("scheme").notNullable().references("key").inTable("address_fields").onDelete("RESTRICT");
    t.text("value").notNullable();
    t.text("value_normalized").notNullable();
    t.integer("verified_by").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("verified_at", { useTz: true });
    t.timestamps(true, true);
    t.unique(["property_id", "scheme"]);
    t.check("value_normalized <> ''", [], "property_identifiers_normalized_nonempty");
    t.check("verified_by IS NULL OR verified_at IS NOT NULL", [], "property_identifiers_verified_pair");
  });
  await knex.raw(
    "CREATE INDEX property_identifiers_lookup ON property_identifiers (country_code, scheme, value_normalized text_pattern_ops)",
  );
  await knex.raw(
    "CREATE TRIGGER property_identifiers_updated_at BEFORE UPDATE ON property_identifiers FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("property_identifiers");
}
