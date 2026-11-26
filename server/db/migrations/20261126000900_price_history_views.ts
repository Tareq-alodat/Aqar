import type { Knex } from "knex";

/**
 * price_history: a [P2] feature whose data is written from phase 1 (SPEC §12).
 * property_views: one view per visitor per listing per day (§10). The day
 * bucket is the dedup key; visitor_hash is an HMAC of cookie id / IP, never raw.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("price_history", (t) => {
    t.increments("id");
    t.integer("property_id").notNullable().references("id").inTable("properties").onDelete("CASCADE");
    t.decimal("price", 14, 3);
    t.specificType("currency", "char(3)").notNullable();
    t.integer("changed_by").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("changed_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["property_id", "changed_at"]);
  });

  await knex.schema.createTable("property_views", (t) => {
    t.integer("property_id").notNullable().references("id").inTable("properties").onDelete("CASCADE");
    t.text("visitor_hash").notNullable();
    t.date("view_date").notNullable().defaultTo(knex.raw("CURRENT_DATE"));
    t.timestamp("viewed_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(["property_id", "visitor_hash", "view_date"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("property_views");
  await knex.schema.dropTable("price_history");
}
