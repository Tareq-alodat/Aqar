import type { Knex } from "knex";

/**
 * Session lifetime (SPEC §13): every token of a login family carries the
 * family's start time, so the absolute cap (90 days, 7 for admins) is checked
 * against the user's current role on each rotation.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("refresh_tokens", (t) => {
    t.timestamp("family_started_at", { useTz: true });
  });
  await knex("refresh_tokens").update({ family_started_at: knex.ref("created_at") });
  await knex.schema.alterTable("refresh_tokens", (t) => {
    t.timestamp("family_started_at", { useTz: true }).notNullable().alter();
    t.check("family_started_at <= created_at", [], "refresh_tokens_family_start");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("refresh_tokens", (t) => {
    t.dropChecks(["refresh_tokens_family_start"]);
    t.dropColumn("family_started_at");
  });
}
