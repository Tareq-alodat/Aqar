import knexFactory from "knex";
import { createTestDb, testDatabaseUrl } from "./testDb";

/** Recreates the test database from scratch and runs all migrations once per `npm run test:db`. */
export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.replace(/^\//, "");
  const admin = new URL(url);
  admin.pathname = "/postgres";

  const server = knexFactory({ client: "pg", connection: admin.toString(), pool: { min: 0, max: 1 } });
  try {
    // Identifier, not a value: validated by testDatabaseUrl() and quoted here.
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unexpected test database name "${name}"`);
    await server.raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.raw(`CREATE DATABASE "${name}"`);
  } finally {
    await server.destroy();
  }

  const db = createTestDb();
  try {
    await db.migrate.latest();
  } finally {
    await db.destroy();
  }
}
