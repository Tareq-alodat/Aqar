import type { Knex } from "knex";

/** Admin phone search and per-phone listing limits look up properties by owner_phone_hash (SPEC §8). */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("properties", (t) => {
    t.index(["owner_phone_hash"], "properties_owner_phone_hash_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("properties", (t) => {
    t.dropIndex(["owner_phone_hash"], "properties_owner_phone_hash_index");
  });
}
