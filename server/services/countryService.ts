import type { Knex } from "knex";
import type { CountryAddressField } from "../../app/shared/schemas/address";

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

/** The country's active address settings (SPEC §2.3), in order: area levels, typed fields and identifier schemes. */
export async function getCountryAddressFields(db: Knex, countryCode: string): Promise<CountryAddressField[]> {
  return db("country_address_fields as c")
    .join("address_fields as f", "f.key", "c.field_key")
    .where({ "c.country_code": countryCode, "c.is_active": true })
    .orderBy("c.position")
    .select("c.field_key", "f.kind", "f.label_ar", "f.label_en", "f.pattern", "c.position", "c.is_required", "c.visibility");
}

/** What submitting a listing needs about its country: phone prefix (masking), currency decimals (prices), commission rate (terms). */
export interface CountrySubmissionInfo {
  code: string;
  phonePrefix: string;
  currency: string;
  currencyDecimals: number;
  commissionRate: number;
}

export async function getCountrySubmissionInfo(db: Knex, code: string): Promise<CountrySubmissionInfo | null> {
  const row = await db("countries")
    .where({ code, is_active: true })
    .first("code", "phone_prefix", "currency", "currency_decimals", "commission_rate");
  if (!row) return null;
  return {
    code: row.code.trim(),
    phonePrefix: row.phone_prefix,
    currency: row.currency.trim(),
    currencyDecimals: row.currency_decimals,
    commissionRate: Number(row.commission_rate),
  };
}
