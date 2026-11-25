import { z } from "zod";
import { ACTIVE_COUNTRIES } from "../countries";
import { LOCALES } from "../locales";

export const localeSchema = z.enum(LOCALES);
export const activeCountrySchema = z.enum(ACTIVE_COUNTRIES);

export const langParamsSchema = z.object({ lang: localeSchema });

export const mapParamsSchema = z.object({
  lang: localeSchema,
  country: activeCountrySchema,
});
