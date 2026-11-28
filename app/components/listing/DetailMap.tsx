import { AttributionControl, Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "~/components/map/mapSetup";
import { useEffect, useRef } from "react";
import { ATTRIBUTION, controlPosition, transformStyle } from "~/components/map/mapStyle";
import { themeColor } from "~/components/map/pins";
import { circleRing } from "~/shared/geo";
import type { Locale } from "~/shared/locales";

/** Radius of the approximate-location circle (SPEC §4.3: the display point is 150–300 m from the true pin). */
export const APPROXIMATE_CIRCLE_M = 300;

export interface DetailMapProps {
  lng: number;
  lat: number;
  styleUrl: string;
  locale: Locale;
  dir: "rtl" | "ltr";
  controlLabels: Record<string, string>;
}

/**
 * Listing location (SPEC §10): every listing is public as an approximate area
 * (milestone 6 decision), so this draws a ~300 m circle around the stored
 * display point and no pin. Uses the public display point only. Scroll-zoom is
 * off so the page scrolls normally.
 */
export default function DetailMap({ lng, lat, styleUrl, locale, dir, controlLabels }: DetailMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      transformStyle: transformStyle(locale),
      center: [lng, lat],
      zoom: 14,
      attributionControl: false,
      locale: controlLabels,
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), controlPosition("top-end", dir));
    map.addControl(new AttributionControl({ compact: false, customAttribution: ATTRIBUTION }), controlPosition("bottom-end", dir));

    map.on("load", () => {
      // Brand colour that stays visible on both basemaps (lighter tint in dark mode).
      const primary = themeColor("--color-primary-text");
      map.addSource("aqar-area", {
        type: "geojson",
        data: { type: "Polygon", coordinates: [circleRing(lng, lat, APPROXIMATE_CIRCLE_M)] },
      });
      map.addLayer({ id: "aqar-area-fill", type: "fill", source: "aqar-area", paint: { "fill-color": primary, "fill-opacity": 0.18 } });
      map.addLayer({ id: "aqar-area-line", type: "line", source: "aqar-area", paint: { "line-color": primary, "line-width": 2 } });
    });
    return () => map.remove();
  }, [lng, lat, styleUrl, locale, dir, controlLabels]);

  // MapLibre's CSS makes its container `position: relative`, so it needs a sized wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
    </div>
  );
}
