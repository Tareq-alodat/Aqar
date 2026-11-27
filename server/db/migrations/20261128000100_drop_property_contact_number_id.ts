import type { Knex } from "knex";

/**
 * Milestone 5 decision: a listing's own proxy number is a `contact_numbers`
 * row with `scope = 'property'` (SPEC §8). The duplicate path,
 * `properties.contact_number_id` (§4.1), is dropped; any values are carried
 * over as property-scoped rows first.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    INSERT INTO contact_numbers (phone_number, whatsapp, label, scope, property_id, is_active, created_by)
    SELECT c.phone_number, c.whatsapp, c.label, 'property', p.id, c.is_active, c.created_by
      FROM properties p JOIN contact_numbers c ON c.id = p.contact_number_id
     WHERE NOT EXISTS (SELECT 1 FROM contact_numbers x WHERE x.scope = 'property' AND x.property_id = p.id)
  `);
  await knex.schema.alterTable("properties", (t) => {
    t.dropColumn("contact_number_id");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("properties", (t) => {
    t.integer("contact_number_id").references("id").inTable("contact_numbers").onDelete("SET NULL");
  });
}
