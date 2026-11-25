import knexFactory, { type Knex } from "knex";
import config from "../../knexfile";

let instance: Knex | undefined;

/** Lazily created shared Knex instance (no connection is opened until first query). */
export function getDb(): Knex {
  instance ??= knexFactory(config);
  return instance;
}
