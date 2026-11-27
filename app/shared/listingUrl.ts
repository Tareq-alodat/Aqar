import type { Locale } from "./locales";

/** Listing detail URLs (SPEC §6): `/ar/property/{id}-{slug}`. */

export function listingPath(locale: Locale, id: number, slug: string | null | undefined): string {
  return `/${locale}/property/${id}${slug ? `-${slug}` : ""}`;
}

/** `42-apartment-sale-abdoun` → { id: 42, slug: "apartment-sale-abdoun" }; null if not a listing reference. */
export function parseListingParam(param: string | undefined): { id: number; slug: string | null } | null {
  const m = /^([1-9]\d{0,9})(?:-([a-z0-9-]{1,200}))?$/.exec(param ?? "");
  if (!m) return null;
  const id = Number(m[1]);
  if (id > 2_147_483_647) return null;
  return { id, slug: m[2] ?? null };
}
