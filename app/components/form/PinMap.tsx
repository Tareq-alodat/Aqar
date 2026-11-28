import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl, type GeoJSONSource } from "maplibre-gl";
import "~/components/map/mapSetup";
import { useEffect, useRef } from "react";
import { APPROXIMATE_CIRCLE_M } from "~/components/listing/DetailMap";
import { ATTRIBUTION, controlPosition, transformStyle } from "~/components/map/mapStyle";
import { themeColor } from "~/components/map/pins";
import { circleRing, type BBox } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import type { LngLat } from "~/shared/schemas/listingForm";

export interface PinMapProps {
  center: LngLat;
  zoom: number;
  /** The lister's exact pin (owner-only editing view, CLAUDE.md rule 2 exception). */
  point: LngLat | null;
  /** The stored public point: the public sees an approximate area around it. */
  displayPoint: LngLat | null;
  /** Bounds to fly to (jump-to); a new object flies again. */
  fit: { bbox: BBox } | null;
  styleUrl: string;
  locale: Locale;
  dir: "rtl" | "ltr";
  controlLabels: Record<string, string>;
  onPick(point: LngLat): void;
}

const SRC = "aqar-public-area";
/** Zoom for placing and adjusting the pin (street level). */
const PLACE_ZOOM = 16;
const EMPTY = { type: "FeatureCollection" as const, features: [] };

/**
 * Pin placement for the submit wizard (SPEC §7 step 2): click to place the
 * pin, drag to move it. Also shows the public preview — the ~300 m area
 * around the stored display point — so the lister sees what the public sees.
 */
export default function PinMap(props: PinMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Create the map once (style changes recreate it).
  useEffect(() => {
    if (!containerRef.current) return;
    const { center, zoom, point, styleUrl, locale, dir, controlLabels } = latest.current;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      transformStyle: transformStyle(locale),
      center: point ? [point.lng, point.lat] : [center.lng, center.lat],
      zoom: point ? PLACE_ZOOM : zoom,
      attributionControl: false,
      locale: controlLabels,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), controlPosition("top-end", dir));
    map.addControl(new AttributionControl({ compact: false, customAttribution: ATTRIBUTION }), controlPosition("bottom-end", dir));
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", (e) => {
      latest.current.onPick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      // A pin placed from far out is imprecise: zoom in on it so it can be adjusted.
      if (map.getZoom() < PLACE_ZOOM - 1) map.easeTo({ center: e.lngLat, zoom: PLACE_ZOOM, duration: 600 });
    });
    map.on("load", () => {
      const color = themeColor("--color-primary-text");
      map.addSource(SRC, { type: "geojson", data: EMPTY });
      map.addLayer({ id: `${SRC}-fill`, type: "fill", source: SRC, paint: { "fill-color": color, "fill-opacity": 0.15 } });
      map.addLayer({ id: `${SRC}-line`, type: "line", source: SRC, paint: { "line-color": color, "line-width": 2, "line-dasharray": [2, 2] } });
      drawPublicArea(map, latest.current.displayPoint);
    });
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [props.styleUrl, props.locale, props.dir, props.controlLabels]);

  // The pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.point) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = new Marker({ draggable: true, color: themeColor("--color-sale") }).setLngLat([props.point.lng, props.point.lat]).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        latest.current.onPick({ lng: p.lng, lat: p.lat });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([props.point.lng, props.point.lat]);
    }
  }, [props.point, props.styleUrl]);

  // The public preview area.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) drawPublicArea(map, props.displayPoint);
  }, [props.displayPoint]);

  // Jump to an area.
  useEffect(() => {
    if (props.fit) mapRef.current?.fitBounds(props.fit.bbox, { padding: 24, duration: 600 });
  }, [props.fit]);

  // MapLibre's CSS makes its container `position: relative`, so it needs a sized wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
    </div>
  );
}

function drawPublicArea(map: MapLibreMap, displayPoint: LngLat | null) {
  const src = map.getSource(SRC) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(
    displayPoint
      ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(displayPoint.lng, displayPoint.lat, APPROXIMATE_CIRCLE_M)] } }
      : EMPTY,
  );
}
