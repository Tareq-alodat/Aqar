import { parseCookie } from "cookie";
import { data, redirect, type AppLoadContext } from "react-router";
import { listingPath, parseListingParam } from "~/shared/listingUrl";
import type { Locale } from "~/shared/locales";
import { env } from "../../server/env";
import { getListingDetail, isSaved, similarListings, type Viewer } from "../../server/services/listingService";
import { looksLikeVisitorId, newVisitorId, VISITOR_COOKIE, visitorCookie } from "../../server/services/viewService";

/**
 * Listing detail page data (SPEC §10). Public serializer only; 404 for
 * listings the viewer may not see; a 301 to the canonical `{id}-{slug}` URL.
 * Sets the first-party visitor cookie used for view counting if missing;
 * previews get `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.
 */
export async function loadListingPage(context: AppLoadContext, request: Request, locale: Locale, param: string | undefined) {
  const ref = parseListingParam(param);
  if (!ref) throw data(null, { status: 404 });

  const { db, views } = context.services;
  const session = context.session;
  const viewer: Viewer | null = session ? { userId: session.user.id, role: session.user.role } : null;
  const result = await getListingDetail(db, ref.id, viewer, locale);
  if (!result) throw data(null, { status: 404 });
  const { listing, access } = result;

  if (listing.slug && ref.slug !== listing.slug) {
    const url = new URL(request.url);
    throw redirect(listingPath(locale, listing.id, listing.slug) + url.search, 301);
  }

  const [similar, saved] = await Promise.all([
    access === "public" ? similarListings(db, listing.id, locale) : Promise.resolve([]),
    viewer ? isSaved(db, viewer.userId, listing.id) : Promise.resolve(false),
  ]);

  const headers = new Headers();
  // Owner/admin previews of non-public listings: never cached or indexed (milestone 5 decision).
  if (access === "preview") {
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Robots-Tag", "noindex");
  }
  const cookieHeader = request.headers.get("Cookie");
  const existing = cookieHeader ? parseCookie(cookieHeader)[VISITOR_COOKIE] : undefined;
  if (!looksLikeVisitorId(existing)) headers.append("Set-Cookie", visitorCookie(newVisitorId(), views.secure));

  return data(
    {
      listing,
      access,
      similar,
      saved,
      canonical: `${context.services.publicOrigin}${listingPath(locale, listing.id, listing.slug)}`,
      styles: { dark: env.MAP_STYLE_URL_DARK, light: env.MAP_STYLE_URL_LIGHT },
    },
    { headers },
  );
}
