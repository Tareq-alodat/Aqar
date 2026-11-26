import type { Knex } from "knex";

/** Refresh-token rotation with server-side revocation (SPEC §13). Used from milestone 3. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("refresh_tokens", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    // All tokens from one login share a family; reuse of a rotated token revokes the family.
    t.uuid("family_id").notNullable();
    // SHA-256 of the token; the token itself is never stored.
    t.text("token_hash").notNullable().unique();
    t.timestamp("expires_at", { useTz: true }).notNullable();
    t.timestamp("revoked_at", { useTz: true });
    t.uuid("replaced_by").references("id").inTable("refresh_tokens").onDelete("SET NULL");
    t.text("user_agent");
    t.text("ip_hash");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["user_id"]);
    t.index(["family_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("refresh_tokens");
}
