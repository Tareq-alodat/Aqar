import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { parseMapSearch, toSearchParams, type MapSearchState } from "~/shared/schemas/mapSearch";

/**
 * Map position, filters, sort, page and drawn polygon live in the URL
 * (SPEC §5.2, CLAUDE.md convention), so every view is shareable.
 * Map moves replace the history entry; filter changes push one (Back undoes them).
 */
export function useMapUrlState() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseMapSearch(params).state, [params]);

  const update = useCallback(
    (patch: Partial<MapSearchState>, options: { push?: boolean } = {}) => {
      setParams((prev) => toSearchParams({ ...parseMapSearch(prev).state, ...patch }), {
        replace: !options.push,
        preventScrollReset: true,
      });
    },
    [setParams],
  );

  return { state, update };
}
