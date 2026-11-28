import type { Knex } from "knex";

/**
 * Empties tables for the dev seed and the database tests only.
 *
 * `status_history` and `audit_log` are append-only: their triggers reject
 * UPDATE, DELETE and TRUNCATE, and `TRUNCATE … CASCADE` from `users` reaches
 * them. The schema has no bypass; instead this sets
 * `session_replication_role = replica` for one transaction, which skips
 * ordinary triggers and which PostgreSQL allows only to superusers (the dev
 * Docker and CI roles). The production application role is not a superuser
 * (SPEC §16), so this cannot work there — and it refuses to run in production
 * anyway.
 */
export async function truncateForDev(knex: Knex, tables: string[]): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to truncate tables: NODE_ENV=production.");
  for (const t of tables) if (!/^[a-z_]+$/.test(t)) throw new Error(`Unexpected table name "${t}"`);
  await knex.transaction(async (trx) => {
    await trx.raw("SET LOCAL session_replication_role = replica");
    await trx.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  });
}
