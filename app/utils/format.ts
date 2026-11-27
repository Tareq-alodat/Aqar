import type { RentPeriod } from "~/shared/constants";
import type { Locale } from "~/shared/locales";

/**
 * Price formatting (SPEC §5.2, CLAUDE.md rule 5): the country's currency and
 * decimal count, Western digits in both languages (SPEC §14).
 */

const numberLocale = (locale: Locale) => (locale === "ar" ? "ar-u-nu-latn" : "en");
const cache = new Map<string, Intl.NumberFormat>();
function fmt(key: string, make: () => Intl.NumberFormat) {
  let f = cache.get(key);
  if (!f) {
    f = make();
    cache.set(key, f);
  }
  return f;
}

/** Full price, e.g. "85,000 JOD" / "85,000 د.أ.". Trailing zero decimals are dropped (85,000 not 85,000.000). */
export function formatPrice(value: number, currency: string, decimals: number, locale: Locale): string {
  return fmt(`p:${locale}:${currency}:${decimals}`, () =>
    new Intl.NumberFormat(numberLocale(locale), {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }),
  ).format(value);
}

export function formatNumber(value: number, locale: Locale, maxFractionDigits = 0): string {
  return fmt(`n:${locale}:${maxFractionDigits}`, () =>
    new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: maxFractionDigits }),
  ).format(value);
}

/** Compact pin label: 850 → "850", 85,000 → "85K", 1,250,000 → "1.25M" (at most 3 significant digits). */
export function shortNumber(value: number): string {
  const abs = Math.abs(value);
  const scaled = (n: number, suffix: string) => {
    const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
    return `${Number(n.toFixed(digits))}${suffix}`;
  };
  if (abs >= 1e9) return scaled(value / 1e9, "B");
  if (abs >= 1e6) return scaled(value / 1e6, "M");
  if (abs >= 1e3) return scaled(value / 1e3, "K");
  return String(Math.round(value));
}

/**
 * Pin label: "85K", "1.2M", rentals "450/mo" (suffix translated: `map.perMonth` / `map.perYear`).
 * Exchange listings without a price get the translated "exchange" word.
 */
export function shortPrice(
  price: number | null,
  rentPeriod: RentPeriod | null,
  t: (key: string) => string,
): string {
  if (price === null) return t("listing.types.exchange");
  const base = shortNumber(price);
  if (rentPeriod === "monthly") return `${base}${t("map.perMonth")}`;
  if (rentPeriod === "yearly") return `${base}${t("map.perYear")}`;
  return base;
}
