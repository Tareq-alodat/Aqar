import type { BBox } from "~/shared/geo";
import type { Locale } from "~/shared/locales";
import type { LngLatPair } from "~/shared/polyline";
import { encodePolygon, toSearchParams, type SearchFilters, type Sort } from "~/shared/schemas/mapSearch";
import type { AreaSummary, ListingsPage, MapPoints } from "./types";

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

const query = (country: string, filters: SearchFilters, extra: Record<string, string>) => {
  const p = toSearchParams({ filters });
  p.set("country", country);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
};

export type PointsResponse = MapPoints & { truncated: boolean };

export function fetchPointsInBBox(country: string, bbox: BBox, filters: SearchFilters, signal: AbortSignal) {
  return getJson<PointsResponse>(`/api/v1/map/points?${query(country, filters, { bbox: bbox.map((n) => n.toFixed(5)).join(",") })}`, { signal });
}

export function fetchPointsInPolygon(country: string, ring: LngLatPair[], filters: SearchFilters, signal: AbortSignal) {
  const asStrings = Object.fromEntries(toSearchParams({ filters }).entries());
  return getJson<PointsResponse>("/api/v1/map/points", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country, polygon: { type: "Polygon", coordinates: [ring] }, filters: asStrings }),
  });
}

export function fetchListings(
  country: string,
  area: { bbox: BBox } | { poly: LngLatPair[] },
  filters: SearchFilters,
  sort: Sort,
  page: number,
  locale: Locale,
  signal: AbortSignal,
) {
  const extra: Record<string, string> = { lang: locale, sort, page: String(page) };
  if ("bbox" in area) extra.bbox = area.bbox.map((n) => n.toFixed(5)).join(",");
  else extra.poly = encodePolygon(area.poly);
  return getJson<ListingsPage>(`/api/v1/listings?${query(country, filters, extra)}`, { signal });
}

export function fetchPathAt(country: string, lng: number, lat: number, zoom: number, signal: AbortSignal) {
  const p = new URLSearchParams({ country, lng: lng.toFixed(5), lat: lat.toFixed(5), z: zoom.toFixed(2) });
  return getJson<{ path: AreaSummary[] }>(`/api/v1/areas/at?${p}`, { signal });
}
