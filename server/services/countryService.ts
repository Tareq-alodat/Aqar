import type { Knex } from "knex";

/** What the map page needs about a country (SPEC §2.1): currency for prices, default view. */
export interface CountryInfo {
  code: string;
  currency: string;
  currencyDecimals: number;
  center: { lng: number; lat: number };
  zoom: number;
}

export async function getCountry(db: Knex, code: string): Promise<CountryInfo | null> {
  const row = await db("countries")
    .where({ code, is_active: true })
    .first(
      "code",
      "currency",
      "currency_decimals",
      "default_zoom",
      db.raw("ST_X(default_center::geometry) AS lng"),
      db.raw("ST_Y(default_center::geometry) AS lat"),
    );
  if (!row) return null;
  return {
    code: row.code.trim(),
    currency: row.currency.trim(),
    currencyDecimals: row.currency_decimals,
    center: { lng: Number(row.lng), lat: Number(row.lat) },
    zoom: row.default_zoom,
  };
}
