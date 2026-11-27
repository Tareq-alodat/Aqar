import { useEffect } from "react";
import { useLocale, useT } from "~/i18n/useT";
import type { ActiveCountry } from "~/shared/countries";
import type { BBox } from "~/shared/geo";
import { useMapUi } from "~/store/mapUiStore";
import type { AreaSummary } from "./types";

const panel = "rounded-xl border border-card bg-surface/95 shadow-lg backdrop-blur";

/**
 * Full address path of the area in view (SPEC §5.2 drill-down):
 * country › governorate › city › area. Each part zooms back out to it.
 */
export function AreaPath({ country, countryBBox, path }: { country: ActiveCountry; countryBBox: BBox | null; path: AreaSummary[] }) {
  const t = useT();
  const locale = useLocale();
  const fitTo = useMapUi((s) => s.fitTo);
  const crumbs: Array<{ key: string; label: string; bbox: BBox | null }> = [
    { key: "country", label: t(`countries.${country}`), bbox: countryBBox },
    ...path.map((a) => ({ key: String(a.id), label: locale === "ar" ? a.nameAr : a.nameEn, bbox: a.bbox })),
  ];
  return (
    <nav aria-label={t("map.path")} className={`${panel} max-w-full overflow-x-auto px-3 py-1.5`}>
      <ol className="flex items-center gap-1.5 whitespace-nowrap text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.key} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-muted">
                  ›
                </span>
              )}
              {last || !c.bbox ? (
                <span aria-current={last ? "location" : undefined} className={last ? "font-semibold" : "text-muted"}>
                  {c.label}
                </span>
              ) : (
                <button type="button" onClick={() => fitTo(c.bbox!)} className="text-muted hover:text-primary hover:underline">
                  {c.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Governorate/city dropdowns that fly the map there (no external geocoding, SPEC §5.2). */
export function JumpTo({ areas, path }: { areas: AreaSummary[]; path: AreaSummary[] }) {
  const t = useT();
  const locale = useLocale();
  const fitTo = useMapUi((s) => s.fitTo);
  const top = areas[0]?.level;
  const governorates = areas.filter((a) => a.level === top);
  const current = path.find((p) => p.level === top)?.id;
  const cities = areas.filter((a) => a.level !== top && (current === undefined || a.parentId === current));
  const name = (a: AreaSummary) => (locale === "ar" ? a.nameAr : a.nameEn);
  const byName = (a: AreaSummary, b: AreaSummary) => name(a).localeCompare(name(b), locale);
  const go = (id: string) => {
    const area = areas.find((a) => String(a.id) === id);
    if (area) fitTo(area.bbox);
  };
  const select = "max-w-40 rounded-lg border border-card bg-background px-2 py-1.5 text-sm";
  return (
    <div className={`${panel} flex items-center gap-2 px-2 py-1.5`} role="group" aria-label={t("map.jumpTo")}>
      <select aria-label={t("map.governorate")} value={current ?? ""} onChange={(e) => go(e.target.value)} className={select}>
        <option value="" disabled>
          {t("map.allGovernorates")}
        </option>
        {[...governorates].sort(byName).map((a) => (
          <option key={a.id} value={a.id}>
            {name(a)}
          </option>
        ))}
      </select>
      {cities.length > 0 && (
        <select
          aria-label={t("map.city")}
          value={path.find((p) => p.level !== top && cities.some((c) => c.id === p.id))?.id ?? ""}
          onChange={(e) => go(e.target.value)}
          className={select}
        >
          <option value="" disabled>
            {t("map.allCities")}
          </option>
          {[...cities].sort(byName).map((a) => (
            <option key={a.id} value={a.id}>
              {name(a)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Draw / clear area, "search as I move" toggle and "Search this area". */
export function MapToolbar({
  hasPolygon,
  pendingMove,
  onClearPolygon,
  onSearchThisArea,
}: {
  hasPolygon: boolean;
  pendingMove: boolean;
  onClearPolygon(): void;
  onSearchThisArea(): void;
}) {
  const t = useT();
  const drawing = useMapUi((s) => s.drawing);
  const setDrawing = useMapUi((s) => s.setDrawing);
  const searchAsMove = useMapUi((s) => s.searchAsMove);
  const setSearchAsMove = useMapUi((s) => s.setSearchAsMove);
  const button = "rounded-lg px-3 py-1.5 text-sm font-medium";

  return (
    <div className="flex flex-col items-start gap-2">
      <div className={`${panel} flex flex-wrap items-center gap-2 px-2 py-1.5`}>
        {hasPolygon ? (
          <button type="button" onClick={onClearPolygon} className={`${button} bg-primary text-on-accent`}>
            {t("map.clearArea")}
          </button>
        ) : drawing ? (
          <button type="button" onClick={() => setDrawing(false)} className={`${button} border border-card hover:bg-card`}>
            {t("map.cancelDraw")}
          </button>
        ) : (
          <button type="button" onClick={() => setDrawing(true)} className={`${button} border border-card hover:bg-card`}>
            {t("map.drawArea")}
          </button>
        )}
        {!hasPolygon && (
          <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
            <input type="checkbox" checked={searchAsMove} onChange={(e) => setSearchAsMove(e.target.checked)} className="accent-primary" />
            {t("map.searchAsMove")}
          </label>
        )}
      </div>
      {drawing && <p className={`${panel} max-w-72 px-3 py-2 text-xs text-muted`}>{t("map.drawHint")}</p>}
      {pendingMove && !hasPolygon && (
        <button type="button" onClick={onSearchThisArea} className={`${button} bg-primary text-on-accent shadow-lg`}>
          {t("map.searchThisArea")}
        </button>
      )}
    </div>
  );
}

/** Gentle status messages (429, load errors, invalid drawing); clears itself. */
export function Notice() {
  const t = useT();
  const notice = useMapUi((s) => s.notice);
  const setNotice = useMapUi((s) => s.setNotice);
  useEffect(() => {
    if (notice === "draw_invalid" || notice === "load_error") {
      const id = window.setTimeout(() => setNotice(null), 6000);
      return () => window.clearTimeout(id);
    }
  }, [notice, setNotice]);
  const text = notice === "rate_limited" ? t("map.rateLimited") : notice === "load_error" ? t("map.loadError") : notice === "draw_invalid" ? t("map.drawInvalid") : "";
  return (
    <div role="status" aria-live="polite" className="pointer-events-none flex justify-center">
      {text && <p className={`${panel} pointer-events-auto max-w-sm px-4 py-2 text-center text-sm`}>{text}</p>}
    </div>
  );
}
