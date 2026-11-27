import { useEffect } from "react";
import { ListingCard } from "~/components/listing/ListingCard";
import { useT } from "~/i18n/useT";
import { SORTS, type Sort } from "~/shared/schemas/mapSearch";
import { useMapUi } from "~/store/mapUiStore";
import type { ListingsPage } from "./types";

interface ResultsListProps {
  listings: ListingsPage;
  total: number;
  loading: boolean;
  truncated: boolean;
  sort: Sort;
  currencyDecimals: number;
  onSort(sort: Sort): void;
  onPage(page: number): void;
}

/** Result list (desktop side panel and mobile bottom sheet). */
export function ResultsList({ listings, total, loading, truncated, sort, currencyDecimals, onSort, onPage }: ResultsListProps) {
  const t = useT();
  const hoveredId = useMapUi((s) => s.hoveredId);
  const selectedId = useMapUi((s) => s.selectedId);
  const setHovered = useMapUi((s) => s.setHovered);
  const pages = Math.max(1, Math.ceil(listings.total / listings.pageSize));

  // A pin was clicked: bring its card into view.
  useEffect(() => {
    if (selectedId === null) return;
    document.querySelector(`[data-listing-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <section aria-labelledby="results-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card px-4 py-3">
        <div>
          <h1 id="results-heading" className="text-base font-semibold">
            {t("map.listHeading")}
          </h1>
          <p className="text-sm text-muted" aria-live="polite">
            {t("map.resultsCount", { count: total })}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t("list.sort")}</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as Sort)}
            className="rounded-lg border border-card bg-background px-2 py-1.5 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`list.sorts.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {truncated && <p className="mx-4 mt-3 rounded-lg bg-card px-3 py-2 text-xs text-muted">{t("map.truncated")}</p>}

      <div className={`flex-1 overflow-y-auto px-4 py-3 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading || undefined}>
        {loading && <p className="sr-only">{t("list.loading")}</p>}
        {listings.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{t("list.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {listings.items.map((item) => (
              <li key={item.id}>
                <ListingCard
                  item={item}
                  currencyDecimals={currencyDecimals}
                  active={item.id === hoveredId || item.id === selectedId}
                  onHover={setHovered}
                />
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav className="mt-4 flex items-center justify-between gap-2 text-sm" aria-label={t("list.pageOf", { page: listings.page, pages })}>
            <button
              type="button"
              disabled={listings.page <= 1}
              onClick={() => onPage(listings.page - 1)}
              className="rounded-lg border border-card px-3 py-1.5 hover:bg-card disabled:opacity-40"
            >
              {t("list.previous")}
            </button>
            <span className="text-muted">{t("list.pageOf", { page: listings.page, pages })}</span>
            <button
              type="button"
              disabled={listings.page >= pages}
              onClick={() => onPage(listings.page + 1)}
              className="rounded-lg border border-card px-3 py-1.5 hover:bg-card disabled:opacity-40"
            >
              {t("list.next")}
            </button>
          </nav>
        )}
      </div>
    </section>
  );
}
