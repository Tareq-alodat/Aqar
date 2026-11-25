import { useMemo } from "react";
import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";
import { DEFAULT_LOCALE, type Locale } from "~/shared/locales";
import { getT, type TFunction } from "./index";

export function useLocale(): Locale {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  return data?.locale ?? DEFAULT_LOCALE;
}

export function useT(): TFunction {
  const locale = useLocale();
  return useMemo(() => getT(locale), [locale]);
}
