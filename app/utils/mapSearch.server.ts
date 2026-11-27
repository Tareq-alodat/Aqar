import { data, type AppLoadContext } from "react-router";
import type { ActiveCountry } from "~/shared/countries";
import { toCountryCode } from "~/shared/countries";
import { bboxAround } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import { parseMapSearch } from "~/shared/schemas/mapSearch";
import { env } from "../../server/env";
import { getAreaTree, getPathAt } from "../../server/services/areaService";
import { getCountry } from "../../server/services/countryService";
import { assertValidPolygon, InvalidPolygonError, searchListings, type SearchArea } from "../../server/services/searchService";

/**
 * Server-rendered first paint of the map page (SPEC §5): results, count and
 * address path for the URL's view, before the map (client-only) loads.
 * The browser takes over through /api/v1 afterwards.
 */

/** Map area assumed before the browser reports its real size (desktop split view). */
const SSR_MAP_WIDTH = 860;
const SSR_MAP_HEIGHT = 760;

export async function loadMapPage(context: AppLoadContext, request: Request, country: ActiveCountry, locale: Locale) {
  const db = context.services.db;
  const code = toCountryCode(country);
  const info = await getCountry(db, code);
  if (!info) throw data(null, { status: 404 });

  const { state } = parseMapSearch(new URL(request.url).searchParams);
  const view = state.view ?? { lat: info.center.lat, lng: info.center.lng, z: info.zoom };

  let poly = state.poly;
  if (poly) {
    try {
      await assertValidPolygon(db, poly);
    } catch (error) {
      if (!(error instanceof InvalidPolygonError)) throw error;
      poly = undefined;
    }
  }
  const area: SearchArea = poly
    ? { kind: "polygon", ring: poly }
    : { kind: "bbox", bbox: bboxAround(view.lng, view.lat, view.z, SSR_MAP_WIDTH, SSR_MAP_HEIGHT) };

  const [tree, listings, path] = await Promise.all([
    getAreaTree(db, code),
    searchListings(db, code, area, state.filters, state.sort, state.page, locale),
    getPathAt(db, code, view, view.z),
  ]);

  return {
    countryCode: code,
    currency: info.currency,
    currencyDecimals: info.currencyDecimals,
    view,
    levels: tree.levels.map((l) => ({ level: l.level, minZoom: l.minZoom })),
    jumpAreas: tree.areas,
    listings,
    path,
    styles: { dark: env.MAP_STYLE_URL_DARK, light: env.MAP_STYLE_URL_LIGHT },
  };
}
