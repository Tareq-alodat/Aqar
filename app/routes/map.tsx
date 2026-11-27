import { lazy, Suspense, useCallback, useMemo, useSyncExternalStore } from "react";
import { data, useLoaderData } from "react-router";
import { MobileNav } from "~/components/layout/MobileNav";
import { ListingCard } from "~/components/listing/ListingCard";
import { BottomSheet } from "~/components/map/BottomSheet";
import { FilterPanel } from "~/components/map/FilterPanel";
import { AreaPath, JumpTo, MapToolbar, Notice } from "~/components/map/MapChrome";
import { ResultsList } from "~/components/map/ResultsList";
import type { ListingCard as Card, ViewChange } from "~/components/map/types";
import { useMapSearch } from "~/components/map/useMapSearch";
import { useMapUrlState } from "~/hooks/useMapUrlState";
import { useTheme } from "~/hooks/useTheme";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import type { BBox } from "~/shared/geo";
import { dirFor } from "~/shared/locales";
import type { LngLatPair } from "~/shared/polyline";
import { countFilters, type SearchFilters, type Sort } from "~/shared/schemas/mapSearch";
import { mapParamsSchema } from "~/shared/schemas/routeParams";
import { useMapUi } from "~/store/mapUiStore";
import { loadMapPage } from "~/utils/mapSearch.server";
import { skipSearchOnlyRevalidation } from "~/utils/revalidate";
import type { Route } from "./+types/map";

// MapLibre needs the browser: load it only on the client.
const MapView = lazy(() => import("~/components/map/MapView"));

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const parsed = mapParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  return { country: parsed.data.country, ...(await loadMapPage(context, request, parsed.data.country, parsed.data.lang)) };
}

export const shouldRevalidate = skipSearchOnlyRevalidation;

export function meta({ params }: Route.MetaArgs) {
  const parsed = mapParamsSchema.safeParse(params);
  if (!parsed.success) return [];
  const t = getT(parsed.data.lang);
  return [
    { title: `${t("map.title")} | ${t("app.name")}` },
    { name: "description", content: t("app.tagline") },
  ];
}

const noSubscribe = () => () => {};

/** Bounds of all top-level areas (the country), for the first breadcrumb. */
function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
}

export default function MapPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const locale = useLocale();
  const dir = dirFor(locale);
  const theme = useTheme();
  const { state, update } = useMapUrlState();

  const hoveredId = useMapUi((s) => s.hoveredId);
  const selectedId = useMapUi((s) => s.selectedId);
  const drawing = useMapUi((s) => s.drawing);
  const fit = useMapUi((s) => s.fit);
  const filtersOpen = useMapUi((s) => s.filtersOpen);
  const { setHovered, select, setDrawing, setFiltersOpen } = useMapUi.getState();

  const clearPolygon = useCallback(() => update({ poly: undefined, page: 1 }, { push: true }), [update]);
  const search = useMapSearch({
    country: data.countryCode,
    locale,
    t,
    state,
    initialListings: data.listings,
    initialPath: data.path,
    onInvalidPolygon: clearPolygon,
  });

  // False during SSR and hydration, true afterwards: the map renders only in the browser.
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  const onViewChange = useCallback(
    (v: ViewChange) => {
      search.onViewChange(v);
      update({ view: { lat: v.lat, lng: v.lng, z: v.zoom } });
    },
    [search.onViewChange, update], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const onFilters = (filters: SearchFilters) => update({ filters, page: 1 }, { push: true });
  const onSort = (sort: Sort) => update({ sort, page: 1 }, { push: true });
  const onPage = (page: number) => update({ page }, { push: true });
  const onDrawFinish = (ring: LngLatPair[]) => {
    setDrawing(false);
    update({ poly: ring, page: 1 }, { push: true });
  };

  const countryBBox = useMemo(
    () => unionBBox(data.jumpAreas.filter((a) => a.level === data.levels[0]?.level).map((a) => a.bbox)),
    [data.jumpAreas, data.levels],
  );
  const controlLabels = useMemo(
    () => ({
      "NavigationControl.ZoomIn": t("map.controls.zoomIn"),
      "NavigationControl.ZoomOut": t("map.controls.zoomOut"),
      "AttributionControl.ToggleAttribution": t("map.controls.attribution"),
      "Map.Title": t("map.mapLabel"),
    }),
    [t],
  );

  // Mini card for a clicked pin (mobile): from the list if loaded, else from the pin's own data.
  const selected: Card | null = useMemo(() => {
    if (selectedId === null) return null;
    const fromList = search.listings.items.find((i) => i.id === selectedId);
    if (fromList) return fromList;
    const p = search.points.features.find((f) => f.id === selectedId)?.properties;
    if (!p) return null;
    return {
      id: p.id,
      title: t(`listing.categories.${p.category}`),
      price: p.price,
      currency: p.currency,
      listingType: p.listing_type,
      rentPeriod: p.rent_period,
      category: p.category,
      areaName: null,
      bedrooms: null,
      bathrooms: null,
      areaSqm: null,
      isFeatured: p.is_featured,
      thumbnailUrl: null,
    };
  }, [selectedId, search.listings.items, search.points.features, t]);

  const list = (
    <ResultsList
      listings={search.listings}
      total={search.total}
      loading={search.listingsLoading}
      truncated={search.truncated}
      sort={state.sort}
      currencyDecimals={data.currencyDecimals}
      onSort={onSort}
      onPage={onPage}
    />
  );
  const activeFilters = countFilters(state.filters);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* Filter bar above both panes (desktop). */}
      <div className="hidden border-b border-card bg-surface px-4 py-3 lg:block">
        <FilterPanel filters={state.filters} areas={data.jumpAreas} onChange={onFilters} layout="bar" />
      </div>

      <div className="relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[2fr_3fr]">
        {/* Results on the start side (right in Arabic, left in English). */}
        <aside className="hidden min-h-0 flex-col border-e border-card bg-background lg:flex">{list}</aside>

        <div className="relative min-h-0 overflow-hidden bg-card">
          {mounted ? (
            <Suspense fallback={<MapLoading label={t("map.loadingMap")} />}>
              <MapView
                locale={locale}
                dir={dir}
                country={data.countryCode}
                styleUrl={data.styles[theme]}
                initialView={{ lng: data.view.lng, lat: data.view.lat, zoom: data.view.z }}
                levels={data.levels}
                points={search.points}
                polygon={state.poly}
                activeId={hoveredId ?? selectedId}
                drawing={drawing}
                fit={fit}
                controlLabels={controlLabels}
                onViewChange={onViewChange}
                onPinClick={select}
                onPinHover={setHovered}
                onDrawFinish={onDrawFinish}
              />
            </Suspense>
          ) : (
            <MapLoading label={t("map.loadingMap")} />
          )}

          {/* Overlays: address path, jump-to and tools at the top start corner. */}
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-start gap-2">
            <div className="pointer-events-auto max-w-full">
              <AreaPath country={data.country} countryBBox={countryBBox} path={search.path} />
            </div>
            <div className="pointer-events-auto flex flex-wrap items-start gap-2">
              <JumpTo areas={data.jumpAreas} path={search.path} />
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="rounded-xl border border-card bg-surface/95 px-3 py-2 text-sm font-medium shadow-lg lg:hidden"
              >
                {t("filters.button", { count: activeFilters })}
              </button>
            </div>
            <div className="pointer-events-auto">
              <MapToolbar
                hasPolygon={Boolean(state.poly)}
                pendingMove={search.pendingMove}
                onClearPolygon={clearPolygon}
                onSearchThisArea={search.searchThisArea}
              />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-3 bottom-24 z-10 lg:bottom-10">
            <Notice />
          </div>

          {/* Mobile: mini card for a clicked pin, above the sheet. */}
          {selected && (
            <div className="absolute inset-x-3 bottom-24 z-30 lg:hidden">
              <div className="relative">
                <ListingCard item={selected} currencyDecimals={data.currencyDecimals} compact active />
                <button
                  type="button"
                  onClick={() => select(null)}
                  aria-label={t("map.closeCard")}
                  className="absolute -top-2 end-2 flex size-7 items-center justify-center rounded-full border border-card bg-surface text-muted shadow"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          <div className="lg:hidden">
            <BottomSheet summary={<span className="text-sm font-semibold">{t("map.resultsCount", { count: search.total })}</span>}>
              {list}
            </BottomSheet>
          </div>
        </div>
      </div>

      <MobileNav />

      {/* Mobile filters sheet. */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background lg:hidden" role="dialog" aria-modal="true" aria-labelledby="filters-title">
          <div className="flex items-center justify-between border-b border-card px-4 py-3">
            <h2 id="filters-title" className="text-lg font-semibold">
              {t("filters.title")}
            </h2>
            <button type="button" onClick={() => setFiltersOpen(false)} className="rounded-lg px-3 py-1.5 text-sm hover:bg-card">
              {t("filters.done")}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <FilterPanel
              filters={state.filters}
              areas={data.jumpAreas}
              onChange={onFilters}
              layout="sheet"
              onDone={() => setFiltersOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MapLoading({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted" aria-busy="true">
      {label}
    </div>
  );
}
