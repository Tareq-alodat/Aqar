import { getDb } from "../db/knex";

export type DbStatus = "ok" | "unreachable" | "not_configured";

/** Cheap connectivity probe; never throws and never exposes connection details. */
export async function checkDatabase(timeoutMs = 2000): Promise<DbStatus> {
  if (!process.env.DATABASE_URL) return "not_configured";
  try {
    await getDb().raw("select 1").timeout(timeoutMs, { cancel: true });
    return "ok";
  } catch {
    return "unreachable";
  }
}
