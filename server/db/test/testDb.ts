import "dotenv/config";
import knexFactory, { type Knex } from "knex";
import config from "../../../knexfile";

/**
 * Connection string for integration tests. Refuses anything that could be a
 * real database: the name must end in `_test` and differ from DATABASE_URL.
 */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to use "${name}" for tests: the database name must end in _test`);
  if (process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === new URL(url).pathname) {
    throw new Error("DATABASE_URL_TEST must not point at the same database as DATABASE_URL");
  }
  return url;
}

export function createTestDb(): Knex {
  return knexFactory({ ...config, connection: testDatabaseUrl(), pool: { min: 0, max: 4 } });
}
