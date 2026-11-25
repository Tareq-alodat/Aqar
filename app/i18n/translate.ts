import type { Locale } from "~/shared/locales";

export type Dictionary = { [key: string]: string | Dictionary };
export type TranslateParams = Record<string, string | number>;
export type TFunction = (key: string, params?: TranslateParams) => string;

export const PLURAL_CATEGORIES: readonly Intl.LDMLPluralRule[] = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
];

const pluralRulesCache = new Map<Locale, Intl.PluralRules>();
const numberFormatCache = new Map<Locale, Intl.NumberFormat>();

function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

// Western (Latin) digits by default in both languages (SPEC §14).
function numberFormat(locale: Locale): Intl.NumberFormat {
  let format = numberFormatCache.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(`${locale}-u-nu-latn`);
    numberFormatCache.set(locale, format);
  }
  return format;
}

function lookup(dict: Dictionary, key: string): string | Dictionary | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(template: string, locale: Locale, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? numberFormat(locale).format(value) : value;
  });
}

/**
 * Translate `key` (dot path into the dictionary).
 *
 * Plurals: when the key resolves to an object of plural forms and `params.count`
 * is a number, the form is chosen with `Intl.PluralRules` for the locale
 * (Arabic: zero/one/two/few/many/other; English: one/other), falling back to `other`.
 * A missing key returns the key itself so it is visible during development.
 */
export function translate(
  dict: Dictionary,
  locale: Locale,
  key: string,
  params?: TranslateParams,
): string {
  const entry = lookup(dict, key);
  if (typeof entry === "string") return interpolate(entry, locale, params);

  if (entry && typeof params?.count === "number") {
    const category = pluralRules(locale).select(params.count);
    const form = entry[category] ?? entry.other;
    if (typeof form === "string") return interpolate(form, locale, params);
  }

  return key;
}

export function createT(dict: Dictionary, locale: Locale): TFunction {
  return (key, params) => translate(dict, locale, key, params);
}
