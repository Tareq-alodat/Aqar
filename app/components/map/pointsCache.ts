import { bboxContains, pointInBBox, type BBox } from "~/shared/geo";
import type { PointFeature } from "./types";

/**
 * Client cache for /map/points (milestone 4 decision): points are fetched for
 * a padded area around the view; while the view stays inside it (zooming in,
 * small pans) and the filters are unchanged, nothing is refetched. A
 * truncated response (over 3,000 points) is never reused, since zooming in
 * may reveal points it left out.
 */

export interface PointsCacheEntry {
  filtersKey: string;
  bbox: BBox;
  truncated: boolean;
  features: PointFeature[];
}

export function canReuse(entry: PointsCacheEntry | null, filtersKey: string, view: BBox): entry is PointsCacheEntry {
  return entry !== null && !entry.truncated && entry.filtersKey === filtersKey && bboxContains(entry.bbox, view);
}

/** The view grown by `ratio` of its size on each side, clamped to valid coordinates. */
export function padBBox([minLng, minLat, maxLng, maxLat]: BBox, ratio = 0.25): BBox {
  const dx = (maxLng - minLng) * ratio;
  const dy = (maxLat - minLat) * ratio;
  return [Math.max(-180, minLng - dx), Math.max(-85, minLat - dy), Math.min(180, maxLng + dx), Math.min(85, maxLat + dy)];
}

export function countInView(features: readonly PointFeature[], view: BBox): number {
  let n = 0;
  for (const f of features) if (pointInBBox(f.geometry.coordinates[0], f.geometry.coordinates[1], view)) n++;
  return n;
}
