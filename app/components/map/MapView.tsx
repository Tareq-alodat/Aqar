import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "./mapSetup";
import { useEffect, useRef } from "react";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { BBox } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import type { LngLatPair } from "~/shared/polyline";
import { ATTRIBUTION, controlPosition, OWN, transformStyle, type BasemapTint } from "./mapStyle";
import { makePinImage, PIN_IMAGE_EXPRESSION, PIN_TIP_OFFSET_PX, pinTextColor, themeColor } from "./pins";
import type { AreaLevelInfo, MapPoints, ViewChange } from "./types";

export interface MapViewProps {
  locale: Locale;
  dir: "rtl" | "ltr";
  country: string;
  styleUrl: string;
  initialView: { lng: number; lat: number; zoom: number };
  levels: AreaLevelInfo[];
  points: MapPoints;
  polygon?: LngLatPair[];
  /** Pin to emphasise (hovered card or selected pin). */
  activeId: number | null;
  drawing: boolean;
  /** Fit the map to these bounds when `key` changes (jump-to, breadcrumb). */
  fit?: { bbox: BBox; key: number };
  /** MapLibre control labels in the page language. */
  controlLabels: Record<string, string>;
  onViewChange(view: ViewChange): void;
  onPinClick(id: number): void;
  onPinHover(id: number | null): void;
  onDrawFinish(ring: LngLatPair[]): void;
}

const SRC_POINTS = `${OWN}points`;
const SRC_POLY = `${OWN}poly`;
const areaSrc = (level: string) => `${OWN}area-${level}`;
const labelSrc = (level: string) => `${OWN}area-labels-${level}`;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const FONT = ["Noto Sans Bold"];

function viewOf(map: MapLibreMap): ViewChange {
  const b = map.getBounds();
  const c = map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] };
}

/** Basemap tint from the theme tokens (design v2): read when the style is (re)loaded, so it follows the theme. */
function basemapTint(): BasemapTint {
  return { water: themeColor("--color-map-water"), green: themeColor("--color-map-green") };
}

const hoverCase = (on: unknown, off: unknown) => ["case", ["boolean", ["feature-state", "hover"], false], on, off] as unknown as ExpressionSpecification;

/**
 * Paint of our layers from the current theme tokens (design v2). Applied when
 * the layers are added and again after a theme switch (style swaps carry the
 * layers over with the old theme's colours).
 */
function ownPaint(levels: AreaLevelInfo[]): Record<string, Record<string, unknown>> {
  const fg = themeColor("--color-foreground");
  const muted = themeColor("--color-muted");
  const primary = themeColor("--color-primary");
  const primaryHover = themeColor("--color-primary-hover");
  const white = themeColor("--color-on-primary");
  const bg = themeColor("--color-background");
  const paint: Record<string, Record<string, unknown>> = {};
  levels.forEach((lv, i) => {
    const last = i === levels.length - 1;
    // Hovered (selected) area: primary colour, 2 px outline, 8 % fill.
    paint[`${OWN}area-fill-${lv.level}`] = { "fill-color": primary, "fill-opacity": hoverCase(0.08, 0) };
    paint[`${OWN}area-line-${lv.level}`] = {
      "line-color": hoverCase(primary, last ? muted : fg),
      "line-opacity": hoverCase(1, 0.45),
      "line-width": hoverCase(2, Math.max(0.6, 2 - i * 0.6)),
    };
    paint[`${OWN}area-label-${lv.level}`] = { "text-color": fg, "text-halo-color": bg };
  });
  paint[`${OWN}poly-fill`] = { "fill-color": primary, "fill-opacity": 0.08 };
  paint[`${OWN}poly-line`] = { "line-color": primary, "line-width": 2 };
  // Clusters: primary colour, white count and halo, slightly darker on hover.
  paint[`${OWN}cluster-halo`] = { "circle-color": primary, "circle-opacity": 0.18 };
  paint[`${OWN}clusters`] = { "circle-color": hoverCase(primaryHover, primary), "circle-stroke-color": white };
  paint[`${OWN}cluster-count`] = { "text-color": white };
  paint[`${OWN}pins`] = { "text-color": pinTextColor() };
  paint[`${OWN}pin-active`] = { "text-color": pinTextColor() };
  return paint;
}

function applyOwnPaint(map: MapLibreMap, levels: AreaLevelInfo[]) {
  for (const [layer, props] of Object.entries(ownPaint(levels))) {
    if (!map.getLayer(layer)) continue;
    for (const [prop, value] of Object.entries(props)) map.setPaintProperty(layer, prop as never, value as never);
  }
}

/** Cluster size grows with the number of listings. */
const CLUSTER_RADIUS: ExpressionSpecification = ["step", ["get", "point_count"], 17, 10, 21, 50, 26, 200, 32];

/** Adds our sources/layers (once per style; style swaps carry them over via transformStyle). */
function addOwnLayers(map: MapLibreMap, levels: AreaLevelInfo[], locale: Locale) {
  if (map.getSource(SRC_POINTS)) return;
  const paint = ownPaint(levels);
  const name: ExpressionSpecification = locale === "ar" ? ["get", "name_ar"] : ["get", "name_en"];

  levels.forEach((lv, i) => {
    const next = levels[i + 1];
    map.addSource(areaSrc(lv.level), { type: "geojson", data: EMPTY, promoteId: "id" });
    map.addSource(labelSrc(lv.level), { type: "geojson", data: EMPTY });
    map.addLayer({
      id: `${OWN}area-fill-${lv.level}`,
      type: "fill",
      source: areaSrc(lv.level),
      minzoom: lv.minZoom,
      ...(next ? { maxzoom: next.minZoom } : {}),
      paint: paint[`${OWN}area-fill-${lv.level}`],
    });
    map.addLayer({
      id: `${OWN}area-line-${lv.level}`,
      type: "line",
      source: areaSrc(lv.level),
      minzoom: lv.minZoom,
      paint: { ...paint[`${OWN}area-line-${lv.level}`], ...(i === levels.length - 1 ? { "line-dasharray": [2, 2] } : {}) },
    });
  });

  map.addSource(SRC_POLY, { type: "geojson", data: EMPTY });
  map.addLayer({ id: `${OWN}poly-fill`, type: "fill", source: SRC_POLY, paint: paint[`${OWN}poly-fill`] });
  map.addLayer({ id: `${OWN}poly-line`, type: "line", source: SRC_POLY, paint: paint[`${OWN}poly-line`] });

  // Area names above outlines, below pins; a level's labels give way to the next level's.
  levels.forEach((lv, i) => {
    const next = levels[i + 1];
    map.addLayer({
      id: `${OWN}area-label-${lv.level}`,
      type: "symbol",
      source: labelSrc(lv.level),
      minzoom: lv.minZoom,
      ...(next ? { maxzoom: next.minZoom } : {}),
      layout: { "text-field": name, "text-font": FONT, "text-size": 13 - i, "text-padding": 4 },
      paint: { ...paint[`${OWN}area-label-${lv.level}`], "text-halo-width": 1.5, "text-opacity": 0.85 },
    });
  });

  map.addSource(SRC_POINTS, { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 48, clusterMaxZoom: 14 });
  map.addLayer({
    id: `${OWN}cluster-halo`,
    type: "circle",
    source: SRC_POINTS,
    filter: ["has", "point_count"],
    paint: { ...paint[`${OWN}cluster-halo`], "circle-radius": ["+", CLUSTER_RADIUS, 6] },
  });
  map.addLayer({
    id: `${OWN}clusters`,
    type: "circle",
    source: SRC_POINTS,
    filter: ["has", "point_count"],
    paint: { ...paint[`${OWN}clusters`], "circle-radius": CLUSTER_RADIUS, "circle-stroke-width": 2.5 },
  });
  map.addLayer({
    id: `${OWN}cluster-count`,
    type: "symbol",
    source: SRC_POINTS,
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT, "text-size": 13, "text-allow-overlap": true },
    paint: paint[`${OWN}cluster-count`],
  });
  // Callout pins: the text box sits inside the pill; lifting it by the tail's height puts the tail's tip on the listing.
  const pinLayout = (size: number) => ({
    "icon-image": PIN_IMAGE_EXPRESSION as unknown as ExpressionSpecification,
    "icon-text-fit": "both" as const,
    "icon-allow-overlap": true,
    "text-allow-overlap": true,
    "text-field": ["get", "label"] as ExpressionSpecification,
    "text-font": FONT,
    "text-size": size,
    "text-anchor": "bottom" as const,
    "text-offset": [0, -PIN_TIP_OFFSET_PX / size] as [number, number],
  });
  map.addLayer({
    id: `${OWN}pins`,
    type: "symbol",
    source: SRC_POINTS,
    filter: ["!", ["has", "point_count"]],
    layout: { ...pinLayout(13), "symbol-sort-key": ["case", ["get", "is_featured"], 1, 0] },
    paint: paint[`${OWN}pins`],
  });
  // The hovered/selected pin, drawn on top, slightly larger with a stronger shadow
  // (feature-state cannot change layout images or sizes).
  map.addLayer({
    id: `${OWN}pin-active`,
    type: "symbol",
    source: SRC_POINTS,
    filter: ["==", ["get", "id"], -1],
    layout: {
      ...pinLayout(14.5),
      "icon-image": ["concat", "aqar-pin-", ["get", "listing_type"], "-active"],
      "icon-text-fit-padding": [1, 2, 1, 2],
    },
    paint: paint[`${OWN}pin-active`],
  });
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const loadedLevels = useRef(new Set<string>());
  // Latest props for map event handlers registered once (synced before the effects below run).
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const { locale, dir, initialView, styleUrl, controlLabels } = latest.current;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      center: [initialView.lng, initialView.lat],
      zoom: initialView.zoom,
      attributionControl: false,
      locale: controlLabels,
      transformStyle: transformStyle(locale, basemapTint()),
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 18,
      minZoom: 5,
    });
    mapRef.current = map;
    // Development only: lets browser tests inspect what the map renders.
    if (import.meta.env.DEV) (window as unknown as { __aqarMap?: MapLibreMap }).__aqarMap = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), controlPosition("top-end", dir));
    map.addControl(new AttributionControl({ compact: false, customAttribution: ATTRIBUTION }), controlPosition("bottom-end", dir));

    // Pin images are drawn on demand; MapLibre awaits the resolver for every tile that needs one
    // (the older `styleimagemissing` event only served the first tile).
    map.setMissingStyleImageResolver((id) => {
      const pin = makePinImage(id);
      if (pin && !map.hasImage(id)) map.addImage(id, pin.data, pin.options);
    });

    const loadOutlines = () => {
      const zoom = map.getZoom();
      for (const lv of latest.current.levels) {
        if (zoom < lv.minZoom - 1 || loadedLevels.current.has(lv.level)) continue;
        loadedLevels.current.add(lv.level);
        fetch(`/api/v1/areas/outlines?country=${latest.current.country}&level=${encodeURIComponent(lv.level)}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((fc: { features: Array<{ properties: { label: [number, number] } & Record<string, unknown> }> }) => {
            (map.getSource(areaSrc(lv.level)) as GeoJSONSource | undefined)?.setData(fc as never);
            (map.getSource(labelSrc(lv.level)) as GeoJSONSource | undefined)?.setData({
              type: "FeatureCollection",
              features: fc.features.map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: f.properties.label }, properties: f.properties })),
            } as never);
          })
          .catch(() => loadedLevels.current.delete(lv.level));
      }
    };

    map.on("load", () => {
      addOwnLayers(map, latest.current.levels, latest.current.locale);
      syncData(map, latest.current);
      loadOutlines();
      latest.current.onViewChange(viewOf(map));
    });
    // After a theme swap our layers come back through transformStyle; refill outline data if it was lost.
    map.on("style.load", () => {
      if (!map.getSource(SRC_POINTS)) {
        addOwnLayers(map, latest.current.levels, latest.current.locale);
        loadedLevels.current.clear();
      } else {
        // Carried over from the previous theme: recolour for the current one.
        applyOwnPaint(map, latest.current.levels);
      }
      syncData(map, latest.current);
      loadOutlines();
    });
    map.on("moveend", () => {
      loadOutlines();
      latest.current.onViewChange(viewOf(map));
    });

    // Pins and clusters.
    map.on("click", `${OWN}clusters`, async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const id = f?.properties?.cluster_id as number | undefined;
      if (id === undefined || f?.geometry.type !== "Point") return;
      const zoom = await (map.getSource(SRC_POINTS) as GeoJSONSource).getClusterExpansionZoom(id);
      map.easeTo({ center: f.geometry.coordinates as [number, number], zoom });
    });
    const pinId = (e: MapLayerMouseEvent) => Number(e.features?.[0]?.properties?.id);
    for (const layer of [`${OWN}pins`, `${OWN}pin-active`]) {
      map.on("click", layer, (e) => latest.current.onPinClick(pinId(e)));
      map.on("mouseenter", layer, (e) => {
        map.getCanvas().style.cursor = "pointer";
        latest.current.onPinHover(pinId(e));
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
        latest.current.onPinHover(null);
      });
    }
    // Clusters: pointer cursor and a slightly darker colour on hover.
    let hoveredCluster: number | null = null;
    const clusterHover = (id: number | null) => {
      if (hoveredCluster !== null) map.setFeatureState({ source: SRC_POINTS, id: hoveredCluster }, { hover: false });
      hoveredCluster = id;
      if (id !== null) map.setFeatureState({ source: SRC_POINTS, id }, { hover: true });
    };
    map.on("mousemove", `${OWN}clusters`, (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      const id = e.features?.[0]?.id;
      if (typeof id === "number" && id !== hoveredCluster) clusterHover(id);
    });
    map.on("mouseleave", `${OWN}clusters`, () => {
      map.getCanvas().style.cursor = "";
      clusterHover(null);
    });

    // Areas: hover highlight; click zooms to the area (unless a pin or cluster was hit).
    let hovered: { source: string; id: number } | null = null;
    const clearHover = () => {
      if (hovered) map.setFeatureState(hovered, { hover: false });
      hovered = null;
    };
    for (const lv of latest.current.levels) {
      const layer = `${OWN}area-fill-${lv.level}`;
      map.on("mousemove", layer, (e) => {
        const id = e.features?.[0]?.id;
        if (typeof id !== "number") return;
        if (hovered?.id === id && hovered.source === areaSrc(lv.level)) return;
        clearHover();
        hovered = { source: areaSrc(lv.level), id };
        map.setFeatureState(hovered, { hover: true });
      });
      map.on("mouseleave", layer, clearHover);
      map.on("click", layer, (e) => {
        if (latest.current.drawing) return;
        const onPin = map.queryRenderedFeatures(e.point, { layers: [`${OWN}pins`, `${OWN}pin-active`, `${OWN}clusters`] });
        if (onPin.length) return;
        const raw = e.features?.[0]?.properties?.bbox;
        const bbox = typeof raw === "string" ? (JSON.parse(raw) as BBox) : (raw as BBox | undefined);
        if (bbox) map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 48, maxZoom: 16 });
      });
    }

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Data updates.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded() && map.getSource(SRC_POINTS)) syncData(map, props);
  }, [props.points, props.polygon, props.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme change: swap the basemap; our layers are carried over by transformStyle.
  const firstStyle = useRef(props.styleUrl);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || props.styleUrl === firstStyle.current) return;
    firstStyle.current = props.styleUrl;
    map.setStyle(props.styleUrl, { transformStyle: transformStyle(props.locale, basemapTint()) });
  }, [props.styleUrl, props.locale]);

  // Jump-to / breadcrumb.
  useEffect(() => {
    const b = props.fit?.bbox;
    if (b) mapRef.current?.fitBounds([b[0], b[1], b[2], b[3]], { padding: 48, maxZoom: 15 });
  }, [props.fit?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw to search (terra-draw polygon mode).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.drawing) {
      drawRef.current?.stop();
      drawRef.current = null;
      return;
    }
    const start = () => {
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode()],
      });
      draw.start();
      draw.setMode("polygon");
      draw.on("finish", (id) => {
        const feature = draw.getSnapshotFeature(id);
        if (feature?.geometry.type === "Polygon") {
          latest.current.onDrawFinish(feature.geometry.coordinates[0] as LngLatPair[]);
        }
      });
      drawRef.current = draw;
    };
    if (map.isStyleLoaded()) start();
    else map.once("idle", start);
  }, [props.drawing]);

  // MapLibre's CSS makes its container `position: relative`, so it needs a sized wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
    </div>
  );
}

function syncData(map: MapLibreMap, p: MapViewProps) {
  (map.getSource(SRC_POINTS) as GeoJSONSource | undefined)?.setData(p.points as never);
  (map.getSource(SRC_POLY) as GeoJSONSource | undefined)?.setData(
    (p.polygon ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [p.polygon] } } : EMPTY) as never,
  );
  const filter: FilterSpecification = ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], p.activeId ?? -1]];
  if (map.getLayer(`${OWN}pin-active`)) map.setFilter(`${OWN}pin-active`, filter);
}
