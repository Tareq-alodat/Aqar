import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { parseMapSearch, toSearchParams, type MapSearchState } from "~/shared/schemas/mapSearch";

/**
 * Map position, filters, sort, page and drawn polygon live in the URL
 * (SPEC §5.2, CLAUDE.md convention), so every view is shareable.
 * Map moves replace the history entry; filter changes push one (Back undoes them).
 *
 * Updates build on the latest URL this hook has asked for, not only on the
 * last rendered one: React Router passes the functional `setSearchParams` the
 * params of the last render, so a map move right after a filter change (e.g.
 * choosing an area fits the map) would otherwise drop that filter.
 */
export function useMapUrlState() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseMapSearch(params).state, [params]);
  const pending = useRef<string | null>(null);

  // Once the router has caught up with what we asked for, read from it again.
  useEffect(() => {
    if (pending.current === params.toString()) pending.current = null;
  }, [params]);

  const update = useCallback(
    (patch: Partial<MapSearchState>, options: { push?: boolean } = {}) => {
      setParams(
        (prev) => {
          const base = pending.current !== null ? new URLSearchParams(pending.current) : prev;
          const next = toSearchParams({ ...parseMapSearch(base).state, ...patch });
          pending.current = next.toString();
          return next;
        },
        { replace: !options.push, preventScrollReset: true },
      );
    },
    [setParams],
  );

  return { state, update };
}
