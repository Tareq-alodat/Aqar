import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAreaPath } from "./api";
import type { AreaSummary } from "./types";

type Known = ReadonlyMap<number, AreaSummary[]>;

const withPath = (known: Known, path: AreaSummary[]): Known => {
  const id = path.at(-1)!.id;
  if (known.get(id) === path) return known;
  return new Map(known).set(id, path);
};

/**
 * The selected-area filter (`area=` in the URL, SPEC §5.2): the area and its
 * ancestors (root first) for the chip, the outline and the jump dropdowns.
 * The URL stays the only source of truth; this only resolves the id. Paths
 * already known (loader, dropdown choices) are kept; others are fetched.
 * An id that does not exist in the country resolves to `null` and `onMissing`
 * is called, so the page can drop it from the URL.
 */
export function useSelectedArea(country: string, areaId: number | undefined, initial: AreaSummary[] | null, onMissing: () => void) {
  const [known, setKnown] = useState<Known>(() => (initial?.length ? withPath(new Map(), initial) : new Map()));
  const missing = useRef(onMissing);
  useEffect(() => {
    missing.current = onMissing;
  });

  /** Remembers a path the page already knows (e.g. a dropdown choice), so it shows at once. */
  const remember = useCallback((path: AreaSummary[]) => {
    if (path.length) setKnown((k) => withPath(k, path));
  }, []);

  const resolved = areaId !== undefined && known.has(areaId);
  useEffect(() => {
    if (areaId === undefined || resolved) return;
    const controller = new AbortController();
    fetchAreaPath(country, areaId, controller.signal)
      .then((path) => {
        if (path) setKnown((k) => withPath(k, path));
        else missing.current();
      })
      .catch(() => {
        // Network errors: the filter still applies; the chip appears once the area resolves.
      });
    return () => controller.abort();
  }, [country, areaId, resolved]);

  const path = areaId === undefined ? null : (known.get(areaId) ?? null);
  return { path, area: path?.at(-1) ?? null, remember };
}
