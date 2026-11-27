import type { Knex } from "knex";

/** Design refresh: light is the default theme (SPEC §14), so the column default follows `DEFAULT_THEME`. */
export async function up(knex: Knex): Promise<void> {
  await knex.raw("ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'light'");
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'dark'");
}
