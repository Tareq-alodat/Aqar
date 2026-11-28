import type { ControlPosition, ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import type { Locale } from "~/shared/locales";

/**
 * Basemap (SPEC §1, §5): OpenFreeMap styles (no API key). Labels are rewritten
 * per page language; MapLibre 6 shapes Arabic and orders RTL text itself (the
 * RTL text plugin is deprecated there and not loaded).
 */

export const DEFAULT_STYLE_URLS = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
} as const;

/**
 * Required credit, always visible (also on mobile, where MapLibre would collapse it).
 * OpenFreeMap's tiles add their own "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";
 * the wording "© OpenStreetMap contributors" is ours (it also covers our OSM-derived boundaries).
 */
export const ATTRIBUTION = [
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
];

/** Label in the page language, falling back to the local name. */
export function nameExpression(locale: Locale): ExpressionSpecification {
  return locale === "ar"
    ? ["coalesce", ["get", "name:ar"], ["get", "name"]]
    : ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
}

const usesName = (v: unknown) => JSON.stringify(v ?? null).includes('"name');

/** Prefix of our own sources/layers, carried over when the basemap style is swapped (theme change). */
export const OWN = "aqar-";

/** Basemap tint (design v2): water and parks/green areas, from the theme tokens. */
export interface BasemapTint {
  water: string;
  green: string;
}

/** OpenFreeMap layer ids (positron and dark) that draw water and green areas. */
const WATER_FILL = new Set(["water"]);
const WATER_LINE = new Set(["waterway"]);
const GREEN_FILL = new Set(["park", "landcover_wood", "landuse_park"]);

/**
 * Basemap labels in one language (OpenFreeMap shows Latin + local names
 * together), water and green areas tinted (design v2), and our own
 * sources/layers kept across style swaps.
 */
export function transformStyle(locale: Locale, tint?: BasemapTint) {
  return (previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification => {
    const layers = next.layers.map((layer) => {
      if (tint && layer.type === "fill" && WATER_FILL.has(layer.id)) return { ...layer, paint: { ...layer.paint, "fill-color": tint.water } };
      if (tint && layer.type === "line" && WATER_LINE.has(layer.id)) return { ...layer, paint: { ...layer.paint, "line-color": tint.water } };
      if (tint && layer.type === "fill" && GREEN_FILL.has(layer.id)) return { ...layer, paint: { ...layer.paint, "fill-color": tint.green } };
      if (layer.type !== "symbol" || !usesName(layer.layout?.["text-field"])) return layer;
      return { ...layer, layout: { ...layer.layout, "text-field": nameExpression(locale) } };
    });
    if (!previous) return { ...next, layers };
    const ownSources = Object.fromEntries(Object.entries(previous.sources).filter(([id]) => id.startsWith(OWN)));
    const ownLayers = previous.layers.filter((l) => l.id.startsWith(OWN));
    return { ...next, sources: { ...next.sources, ...ownSources }, layers: [...layers, ...ownLayers] };
  };
}

export type LogicalPosition = "top-start" | "top-end" | "bottom-start" | "bottom-end";

/** MapLibre control corners are physical; map them from logical ones so controls mirror in RTL. */
export function controlPosition(position: LogicalPosition, dir: "rtl" | "ltr"): ControlPosition {
  const [vertical, side] = position.split("-") as ["top" | "bottom", "start" | "end"];
  const physical = (side === "start") === (dir === "ltr") ? "left" : "right";
  return `${vertical}-${physical}` as ControlPosition;
}
