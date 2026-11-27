/**
 * Encoded polyline (precision 5, the common "Google" format) for polygons in
 * the map URL (`poly=`): compact and URL-safe once encoded with
 * encodeURIComponent. Coordinates are [lng, lat] pairs.
 */

export type LngLatPair = [number, number];

const FACTOR = 1e5;

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: readonly LngLatPair[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const [lng, lat] of points) {
    const la = Math.round(lat * FACTOR);
    const ln = Math.round(lng * FACTOR);
    out += encodeValue(la - lastLat) + encodeValue(ln - lastLng);
    lastLat = la;
    lastLng = ln;
  }
  return out;
}

/** Decodes; returns null for malformed input (never throws). */
export function decodePolyline(encoded: string): LngLatPair[] | null {
  if (!/^[\x3f-\x7e]*$/.test(encoded)) return null;
  const points: LngLatPair[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length || shift > 30) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) return null;
    lat += dLat;
    lng += dLng;
    points.push([lng / FACTOR, lat / FACTOR]);
  }
  return points;
}
