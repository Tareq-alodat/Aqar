/**
 * Countries that are live on the site, as lowercase URL segments.
 * Phase 1: Jordan only. From milestone 2 this mirrors `countries.is_active` in the DB
 * (where codes are uppercase ISO 3166-1 alpha-2, e.g. "JO").
 */
export const ACTIVE_COUNTRIES = ["jo"] as const;
export type ActiveCountry = (typeof ACTIVE_COUNTRIES)[number];
export const DEFAULT_COUNTRY: ActiveCountry = "jo";

/** URL segment ("jo") → DB country code ("JO"). */
export function toCountryCode(country: ActiveCountry): string {
  return country.toUpperCase();
}
