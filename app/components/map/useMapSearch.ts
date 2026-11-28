import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "~/i18n";
import { circleRing, type BBox } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import { encodePolygon, searchScope, toSearchParams, type MapSearchState } from "~/shared/schemas/mapSearch";
import { useMapUi } from "~/store/mapUiStore";
import { shortPrice } from "~/utils/format";
import { fetchListings, fetchPathAt, fetchPoints, HttpError, RateLimitedError, type PointsResponse, type RequestArea } from "./api";
import { canReuse, countInView, padBBox, type PointsCacheEntry } from "./pointsCache";
import type { AreaSummary, ListingsPage, MapPoints, ViewChange } from "./types";

const DEBOUNCE_MS = 300;
const WORLD: BBox = [-180, -85, 180, 85];
/** Smallest box the map fits to (≈ 1 km), so a single result does not zoom in all the way. */
const MIN_FIT_DEG = 0.005;

/** Bounds of a ring of [lng, lat]. */
export function ringBBox(ring: ReadonlyArray<readonly [number, number]>): BBox {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/** `b` grown to at least MIN_FIT_DEG on each axis, around its centre. */
export function atLeast(b: BBox): BBox {
  const grow = (lo: number, hi: number): [number, number] => {
    const pad = Math.max(0, (MIN_FIT_DEG - (hi - lo)) / 2);
    return [lo - pad, hi + pad];
  };
  const [minLng, maxLng] = grow(b[0], b[2]);
  const [minLat, maxLat] = grow(b[1], b[3]);
  return [minLng, minLat, maxLng, maxLat];
}

interface Options {
  country: string;
  locale: Locale;
  t: TFunction;
  state: MapSearchState;
  initialListings: ListingsPage;
  initialPath: AreaSummary[];
  /** The server refused the drawn polygon (e.g. it crosses itself). */
  onInvalidPolygon(): void;
}

/**
 * Data for the map page (SPEC §5.2, §5.6): points, result cards and the
 * address path. The search covers the map view (refreshed 300 ms after the
 * map stops moving), a drawn polygon, a radius around the visitor ("near
 * me") or — for a text search — the whole country, and then the map fits to
 * the results. Outdated requests are aborted; a 429 shows a gentle notice and
 * retries after Retry-After.
 */
export function useMapSearch({ country, locale, t, state, initialListings, initialPath, onInvalidPolygon }: Options) {
  const searchAsMove = useMapUi((s) => s.searchAsMove);
  const setNotice = useMapUi((s) => s.setNotice);
  const fitTo = useMapUi((s) => s.fitTo);
  // Latest values for callbacks created once.
  const onInvalidPolygonRef = useRef(onInvalidPolygon);
  const searchAsMoveRef = useRef(searchAsMove);
  useEffect(() => {
    onInvalidPolygonRef.current = onInvalidPolygon;
    searchAsMoveRef.current = searchAsMove;
  });

  const [view, setView] = useState<ViewChange | null>(null);
  /** Bounds the results are for in the "view" scope (follows the view while "search as I move" is on). */
  const [searchBBox, setSearchBBox] = useState<BBox | null>(null);
  const [pendingMove, setPendingMove] = useState(false);
  const [cache, setCache] = useState<PointsCacheEntry | null>(null);
  const [path, setPath] = useState<AreaSummary[]>(initialPath);
  const [retryTick, setRetryTick] = useState(0);

  const scope = searchScope(state);
  /** Filters + text: what is searched for. */
  const searchKey = useMemo(() => toSearchParams({ filters: state.filters, q: state.q }).toString(), [state.filters, state.q]);
  const nearKey = state.near ? `${state.near.lng},${state.near.lat},${state.radius}` : "";
  const polyKey = state.poly ? encodePolygon(state.poly) : "";
  /** Where it is searched: stable for polygon/near/country, the bbox for the view. */
  const areaKey =
    scope === "polygon" ? polyKey : scope === "near" ? nearKey : scope === "country" ? "country" : (searchBBox?.join(",") ?? "");

  const requestArea: RequestArea | null =
    scope === "polygon"
      ? { poly: state.poly! }
      : scope === "near"
        ? { near: state.near!, radius: state.radius }
        : scope === "country"
          ? { country: true }
          : searchBBox
            ? { bbox: searchBBox }
            : null;

  const listingsKey = requestArea ? [searchKey, scope, areaKey, state.sort, state.page, locale, retryTick].join("|") : "";
  /** Result cards and the request they answer (loading = the current request is not that one). The server-rendered
   *  page already answers a polygon/near/country search, so it is not fetched again on load. */
  const [listingsState, setListingsState] = useState<{ key: string; page: ListingsPage }>(() => ({
    key: scope === "view" ? "" : listingsKey,
    page: initialListings,
  }));
  const listings = listingsState.page;
  const listingsLoading = listingsKey !== "" && listingsKey !== listingsState.key;

  const handleError = useCallback(
    (error: unknown) => {
      if ((error as Error).name === "AbortError") return;
      if (error instanceof RateLimitedError) {
        setNotice("rate_limited");
        window.setTimeout(() => {
          setNotice(null);
          setRetryTick((n) => n + 1);
        }, error.retryAfterS * 1000);
        return;
      }
      if (error instanceof HttpError && error.status === 400) {
        setNotice("draw_invalid");
        onInvalidPolygonRef.current();
        return;
      }
      setNotice("load_error");
    },
    [setNotice],
  );

  // Map moved: debounce, then follow it (or offer "Search this area").
  const moveTimer = useRef<number | undefined>(undefined);
  const onViewChange = useCallback((v: ViewChange) => {
    window.clearTimeout(moveTimer.current);
    moveTimer.current = window.setTimeout(() => {
      setView(v);
      if (searchAsMoveRef.current) {
        setSearchBBox(v.bbox);
        setPendingMove(false);
      } else {
        setPendingMove(true);
      }
    }, DEBOUNCE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(moveTimer.current), []);

  /** "Search this area": search the current view (the page also sets `in=view` for a text search). */
  const searchThisArea = useCallback(() => {
    if (view) setSearchBBox(view.bbox);
    setPendingMove(false);
  }, [view]);

  // "Near me": show the whole circle.
  useEffect(() => {
    if (!state.near) return;
    fitTo(ringBBox(circleRing(state.near.lng, state.near.lat, state.radius * 1000, 32)));
  }, [nearKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Points: in the view, reuse the cache while the view stays inside it with the same search.
  useEffect(() => {
    if (!requestArea) return;
    const key = `${searchKey}|${scope}|${scope === "view" ? "" : areaKey}`;
    if (scope === "view" ? canReuse(cache, key, searchBBox!) : cache?.filtersKey === key) return;

    const controller = new AbortController();
    const padded = scope === "view" ? padBBox(searchBBox!) : null;
    const request: Promise<PointsResponse> = fetchPoints(country, padded ? { bbox: padded } : requestArea, state.filters, state.q, controller.signal);
    request
      .then((res) => {
        setCache({ filtersKey: key, bbox: padded ?? WORLD, truncated: res.truncated, features: res.features });
        setNotice(null);
        // A text search over the whole country: fit the map to its results.
        if (scope === "country" && res.bbox) fitTo(atLeast(res.bbox));
      })
      .catch(handleError);
    return () => controller.abort();
    // `cache` is read, not a trigger: a cache update must not refetch.
  }, [country, searchKey, scope, areaKey, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Result cards for the same area, search, sort and page.
  useEffect(() => {
    if (!listingsKey || !requestArea) return;
    const controller = new AbortController();
    fetchListings(country, requestArea, state.filters, state.q, state.sort, state.page, locale, controller.signal)
      .then((page) => setListingsState({ key: listingsKey, page }))
      .catch((error) => {
        // Keep the previous cards, but stop showing them as loading.
        if ((error as Error).name !== "AbortError") setListingsState((s) => ({ ...s, key: listingsKey }));
        handleError(error);
      });
    return () => controller.abort();
  }, [country, listingsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Address path for the map centre.
  useEffect(() => {
    if (!view) return;
    const controller = new AbortController();
    fetchPathAt(country, view.lng, view.lat, view.zoom, controller.signal)
      .then((r) => setPath(r.path))
      .catch((error) => {
        if (!(error instanceof RateLimitedError)) handleError(error);
      });
    return () => controller.abort();
  }, [country, view, handleError]);

  // Pins with their labels in the page language.
  const points: MapPoints = useMemo(
    () => ({
      type: "FeatureCollection",
      features: (cache?.features ?? []).map((f) => ({
        ...f,
        properties: { ...f.properties, label: shortPrice(f.properties.price, f.properties.rent_period, t) },
      })),
    }),
    [cache, t],
  );

  const visibleCount = cache && searchBBox && scope === "view" ? countInView(cache.features, searchBBox) : (cache?.features.length ?? null);

  return {
    scope,
    view,
    onViewChange,
    points,
    truncated: cache?.truncated ?? false,
    listings,
    listingsLoading,
    /** Total for the current search (list total; the cached point count while the list loads). */
    total: listingsLoading && visibleCount !== null ? visibleCount : listings.total,
    path,
    /** The view moved while "search as I move" is off (view scope only). */
    pendingMove: pendingMove && scope === "view",
    searchThisArea,
  };
}
