/**
 * Imports administrative boundaries for one country (SPEC §2.2):
 *
 *   npm run db:import-boundaries -- JO
 *
 * Reads data/boundaries/{COUNTRY}/manifest.json. Safe to re-run; runs in one
 * transaction. Needed in every environment (production included), unlike seeds.
 */
import { z } from "zod";
import { importBoundaries } from "../server/db/boundaries/importBoundaries";
import { getDb } from "../server/db/knex";

const country = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "Usage: npm run db:import-boundaries -- <COUNTRY CODE>")
  .transform((c) => c.toUpperCase())
  .parse(process.argv[2] ?? "");

const db = getDb();
try {
  const report = await importBoundaries(db, country, { log: (m) => console.log(m) });
  console.log(
    `\n${report.country}: ${report.inserted} inserted, ${report.updated} updated, ${report.deactivated} deactivated, ` +
      `${report.skippedManual} manual kept`,
  );
  console.log("By level:", report.byLevel);
  console.log(`English names awaiting review: ${report.unreviewedNames}`);
  if (report.warnings.length) {
    console.log(`\nWarnings (${report.warnings.length}):`);
    for (const w of report.warnings) console.log(`  - ${w}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
