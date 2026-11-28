import type { BBox } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import type { LngLatPair } from "~/shared/polyline";
import { toSearchParams, type LngLat, type RadiusKm, type SearchFilters, type Sort } from "~/shared/schemas/mapSearch";
import type { AreaSuggestion, AreaSummary, ListingsPage, MapPoints } from "./types";

/** Browser client for /api/v1 map endpoints. */

export class RateLimitedError extends Error {
  constructor(readonly retryAfterS: number) {
    super("rate_limited");
  }
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  if (res.status === 429) throw new RateLimitedError(Number(res.headers.get("Retry-After")) || 10);
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as T;
}

/**
 * The area a request covers (SPEC §5.6): the map view, a drawn polygon,
 * "near me" (rounded location + radius) or the whole country (text search).
 */
export type RequestArea = { bbox: BBox } | { poly: LngLatPair[] } | { near: LngLat; radius: RadiusKm } | { country: true };

/** Filters, text and area as query parameters (`toSearchParams` rounds `near` to 3 decimals). */
function query(country: string, filters: SearchFilters, q: string | undefined, area: RequestArea, extra: Record<string, string> = {}) {
  const p = toSearchParams({
    filters,
    q,
    ...("poly" in area ? { poly: area.poly } : {}),
    ...("near" in area ? { near: area.near, radius: area.radius } : {}),
  });
  p.set("country", country);
  if ("bbox" in area) p.set("bbox", area.bbox.map((n) => n.toFixed(5)).join(","));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

export type PointsResponse = MapPoints & { truncated: boolean; bbox?: BBox | null };

export function fetchPoints(country: string, area: RequestArea, filters: SearchFilters, q: string | undefined, signal: AbortSignal) {
  if ("poly" in area) {
    // Draw to search: the polygon goes in the body (it can be long).
    const asStrings = Object.fromEntries(toSearchParams({ filters, q }).entries());
    return getJson<PointsResponse>("/api/v1/map/points", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country, polygon: { type: "Polygon", coordinates: [area.poly] }, filters: asStrings }),
    });
  }
  return getJson<PointsResponse>(`/api/v1/map/points?${query(country, filters, q, area)}`, { signal });
}

export function fetchListings(
  country: string,
  area: RequestArea,
  filters: SearchFilters,
  q: string | undefined,
  sort: Sort,
  page: number,
  locale: Locale,
  signal: AbortSignal,
) {
  return getJson<ListingsPage>(`/api/v1/listings?${query(country, filters, q, area, { lang: locale, sort, page: String(page) })}`, { signal });
}

/** Location autocomplete (SPEC §5.6). */
export function fetchSuggestions(country: string, q: string, signal: AbortSignal) {
  return getJson<{ items: AreaSuggestion[] }>(`/api/v1/areas/suggest?${new URLSearchParams({ country, q })}`, { signal });
}

export function fetchPathAt(country: string, lng: number, lat: number, zoom: number, signal: AbortSignal) {
  const p = new URLSearchParams({ country, lng: lng.toFixed(5), lat: lat.toFixed(5), z: zoom.toFixed(2) });
  return getJson<{ path: AreaSummary[] }>(`/api/v1/areas/at?${p}`, { signal });
}

/** One area with its ancestors, root first (selected-area filter). Null when the area does not exist in the country. */
export async function fetchAreaPath(country: string, id: number, signal: AbortSignal): Promise<AreaSummary[] | null> {
  try {
    return (await getJson<{ path: AreaSummary[] }>(`/api/v1/areas/${id}?${new URLSearchParams({ country })}`, { signal })).path;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}
