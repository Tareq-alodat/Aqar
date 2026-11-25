import "dotenv/config";
import type { Knex } from "knex";

const config: Knex.Config = {
  client: "pg",
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 10 },
  migrations: {
    directory: "./server/db/migrations",
    extension: "ts",
    loadExtensions: [".ts"],
  },
  seeds: {
    directory: "./server/db/seeds",
    extension: "ts",
    loadExtensions: [".ts"],
  },
};

export default config;
