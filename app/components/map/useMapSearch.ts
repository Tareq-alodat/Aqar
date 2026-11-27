import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "~/i18n";
import type { BBox } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import { encodePolygon, toSearchParams, type MapSearchState } from "~/shared/schemas/mapSearch";
import { useMapUi } from "~/store/mapUiStore";
import { shortPrice } from "~/utils/format";
import {
  fetchListings,
  fetchPathAt,
  fetchPointsInBBox,
  fetchPointsInPolygon,
  HttpError,
  RateLimitedError,
  type PointsResponse,
} from "./api";
import { canReuse, countInView, padBBox, type PointsCacheEntry } from "./pointsCache";
import type { AreaSummary, ListingsPage, MapPoints, ViewChange } from "./types";

const DEBOUNCE_MS = 300;

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
 * Data for the map page (SPEC §5.2): points, result cards and the address
 * path for the current view, refreshed 300 ms after the map stops moving.
 * Outdated requests are aborted; a 429 shows a gentle notice and retries
 * after Retry-After.
 */
export function useMapSearch({ country, locale, t, state, initialListings, initialPath, onInvalidPolygon }: Options) {
  const searchAsMove = useMapUi((s) => s.searchAsMove);
  const setNotice = useMapUi((s) => s.setNotice);
  // Latest values for callbacks created once.
  const onInvalidPolygonRef = useRef(onInvalidPolygon);
  const searchAsMoveRef = useRef(searchAsMove);
  useEffect(() => {
    onInvalidPolygonRef.current = onInvalidPolygon;
    searchAsMoveRef.current = searchAsMove;
  });

  const [view, setView] = useState<ViewChange | null>(null);
  /** Bounds the results are for (follows the view while "search as I move" is on). */
  const [searchBBox, setSearchBBox] = useState<BBox | null>(null);
  const [pendingMove, setPendingMove] = useState(false);
  const [cache, setCache] = useState<PointsCacheEntry | null>(null);
  /** Result cards and the request they answer (loading = the current request is not that one). */
  const [listingsState, setListingsState] = useState<{ key: string; page: ListingsPage }>({ key: "", page: initialListings });
  const [path, setPath] = useState<AreaSummary[]>(initialPath);
  const [retryTick, setRetryTick] = useState(0);

  const filtersKey = useMemo(() => toSearchParams({ filters: state.filters }).toString(), [state.filters]);
  const polyKey = state.poly ? encodePolygon(state.poly) : "";
  const listingsKey =
    polyKey || searchBBox ? [filtersKey, polyKey, searchBBox?.join(","), state.sort, state.page, locale, retryTick].join("|") : "";
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

  const searchThisArea = useCallback(() => {
    if (view) setSearchBBox(view.bbox);
    setPendingMove(false);
  }, [view]);

  // Points: reuse the cache while the view stays inside it with the same filters.
  useEffect(() => {
    if (!polyKey && !searchBBox) return;
    const key = `${filtersKey}|${polyKey}`;
    if (!polyKey && searchBBox && canReuse(cache, key, searchBBox)) return;
    if (polyKey && cache?.filtersKey === key) return;

    const controller = new AbortController();
    const request: Promise<PointsResponse> = state.poly
      ? fetchPointsInPolygon(country, state.poly, state.filters, controller.signal)
      : fetchPointsInBBox(country, padBBox(searchBBox!), state.filters, controller.signal);
    const bbox: BBox = state.poly ? [-180, -85, 180, 85] : padBBox(searchBBox!);
    request
      .then((res) => {
        setCache({ filtersKey: key, bbox, truncated: res.truncated, features: res.features });
        setNotice(null);
      })
      .catch(handleError);
    return () => controller.abort();
    // `cache` is read, not a trigger: a cache update must not refetch.
  }, [country, filtersKey, polyKey, searchBBox, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Result cards for the same area, filters, sort and page (the server-rendered page covers the first paint).
  useEffect(() => {
    if (!listingsKey) return;
    const controller = new AbortController();
    fetchListings(
      country,
      state.poly ? { poly: state.poly } : { bbox: searchBBox! },
      state.filters,
      state.sort,
      state.page,
      locale,
      controller.signal,
    )
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

  const visibleCount = cache && searchBBox && !state.poly ? countInView(cache.features, searchBBox) : (cache?.features.length ?? null);

  return {
    view,
    onViewChange,
    points,
    truncated: cache?.truncated ?? false,
    listings,
    listingsLoading,
    /** Total for the current search (list total; the cached point count while the list loads). */
    total: listingsLoading && visibleCount !== null ? visibleCount : listings.total,
    path,
    pendingMove,
    searchThisArea,
  };
}
