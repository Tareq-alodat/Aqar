import { data, type AppLoadContext } from "react-router";
import type { ActiveCountry } from "~/shared/countries";
import { toCountryCode } from "~/shared/countries";
import { bboxAround, viewForBBox } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import { parseMapSearch, searchScope } from "~/shared/schemas/mapSearch";
import { env } from "../../server/env";
import { getAreaTree, getAreaWithPath, getPathAt } from "../../server/services/areaService";
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
  // The selected-area filter (`area=`): its ancestors for the chip, outline and dropdowns.
  const selectedAreaPath = state.filters.area !== undefined ? await getAreaWithPath(db, code, state.filters.area) : null;
  // A link with an area but no map position opens on that area.
  const selected = selectedAreaPath?.at(-1);
  const view =
    state.view ??
    (selected ? viewForBBox(selected.bbox, SSR_MAP_WIDTH, SSR_MAP_HEIGHT) : { lat: info.center.lat, lng: info.center.lng, z: info.zoom });

  let poly = state.poly;
  if (poly) {
    try {
      await assertValidPolygon(db, poly);
    } catch (error) {
      if (!(error instanceof InvalidPolygonError)) throw error;
      poly = undefined;
    }
  }
  // Same scope as the browser and the API (SPEC §5.6): polygon, near me, whole country (text) or the view.
  const scope = searchScope({ ...state, poly });
  const area: SearchArea =
    scope === "polygon"
      ? { kind: "polygon", ring: poly! }
      : scope === "near"
        ? { kind: "near", center: state.near!, radiusM: state.radius * 1000 }
        : scope === "country"
          ? { kind: "country" }
          : { kind: "bbox", bbox: bboxAround(view.lng, view.lat, view.z, SSR_MAP_WIDTH, SSR_MAP_HEIGHT) };

  const [tree, listings, path] = await Promise.all([
    getAreaTree(db, code),
    searchListings(db, code, area, state.filters, state.sort, state.page, locale, state.q),
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
    selectedAreaPath,
    styles: { dark: env.MAP_STYLE_URL_DARK, light: env.MAP_STYLE_URL_LIGHT },
  };
}
