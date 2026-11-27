import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 looks for its worker next to its own module, which bundling moves;
// serve the (self-contained) worker as an asset and point MapLibre at it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

/**
 * One-time MapLibre setup for every map on the site (search map, listing map).
 * Import this module before creating a map; client-only.
 */
setWorkerUrl(workerUrl);
