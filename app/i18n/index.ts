import type { Locale } from "~/shared/locales";
import ar from "./ar.json";
import en from "./en.json";
import { createT, type Dictionary, type TFunction } from "./translate";

export const dictionaries: Record<Locale, Dictionary> = { ar, en };

const tCache = new Map<Locale, TFunction>();

export function getT(locale: Locale): TFunction {
  let t = tCache.get(locale);
  if (!t) {
    t = createT(dictionaries[locale], locale);
    tCache.set(locale, t);
  }
  return t;
}

export type { TFunction } from "./translate";
