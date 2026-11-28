import { X } from "lucide-react";
import { useEffect } from "react";
import { useLocale, useT } from "~/i18n/useT";
import type { ActiveCountry } from "~/shared/countries";
import type { BBox } from "~/shared/geo";
import { useMapUi } from "~/store/mapUiStore";
import type { AreaSummary } from "./types";

const panel = "rounded-xl border border-border bg-surface/95 shadow-lg backdrop-blur";

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
                <button type="button" onClick={() => fitTo(c.bbox!)} className="text-muted hover:text-primary-text hover:underline">
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

/**
 * Governorate/city dropdowns (SPEC §5.2): choosing one filters results to that
 * area (`area=`) and fits the map to it. They show the selected area's
 * governorate and city (one source of truth with the chip and the filters);
 * "All governorates" clears the filter, "All cities" keeps only the governorate.
 */
export function JumpTo({ areas, selectedPath, onArea }: { areas: AreaSummary[]; selectedPath: AreaSummary[] | null; onArea(path: AreaSummary[] | null): void }) {
  const t = useT();
  const locale = useLocale();
  const top = areas[0]?.level;
  const governorates = areas.filter((a) => a.level === top);
  const governorate = selectedPath?.find((p) => p.level === top);
  const cities = governorate ? areas.filter((a) => a.level !== top && a.parentId === governorate.id) : [];
  const city = selectedPath?.find((p) => p.level !== top && cities.some((c) => c.id === p.id));
  const name = (a: AreaSummary) => (locale === "ar" ? a.nameAr : a.nameEn);
  const byName = (a: AreaSummary, b: AreaSummary) => name(a).localeCompare(name(b), locale);
  const chooseGovernorate = (id: string) => {
    const g = governorates.find((a) => String(a.id) === id);
    onArea(g ? [g] : null);
  };
  const chooseCity = (id: string) => {
    const c = cities.find((a) => String(a.id) === id);
    if (governorate) onArea(c ? [governorate, c] : [governorate]);
  };
  const select = "max-w-40 rounded-lg border border-muted bg-background px-2 py-1.5 text-sm";
  return (
    <div className={`${panel} flex items-center gap-2 px-2 py-1.5`} role="group" aria-label={t("map.jumpTo")}>
      <select aria-label={t("map.governorate")} value={governorate?.id ?? ""} onChange={(e) => chooseGovernorate(e.target.value)} className={select}>
        <option value="">{t("map.allGovernorates")}</option>
        {[...governorates].sort(byName).map((a) => (
          <option key={a.id} value={a.id}>
            {name(a)}
          </option>
        ))}
      </select>
      {cities.length > 0 && (
        <select aria-label={t("map.city")} value={city?.id ?? ""} onChange={(e) => chooseCity(e.target.value)} className={select}>
          <option value="">{t("map.allCities")}</option>
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

/** The selected-area filter as a removable chip ("الزرقاء ×"). */
export function AreaChip({ area, onRemove }: { area: AreaSummary; onRemove(): void }) {
  const t = useT();
  const locale = useLocale();
  const label = locale === "ar" ? area.nameAr : area.nameEn;
  return (
    <span className="inline-flex max-w-56 shrink-0 items-center gap-1 rounded-full border border-primary bg-primary/10 py-1 ps-3 pe-1 text-sm font-medium text-primary-text">
      <span className="truncate" title={t("map.areaChip", { area: label })}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("map.removeArea", { area: label })}
        className="flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:bg-primary/15"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </span>
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
          <button type="button" onClick={onClearPolygon} className={`${button} bg-primary text-on-primary hover:bg-primary-hover`}>
            {t("map.clearArea")}
          </button>
        ) : drawing ? (
          <button type="button" onClick={() => setDrawing(false)} className={`${button} border border-border hover:bg-card`}>
            {t("map.cancelDraw")}
          </button>
        ) : (
          <button type="button" onClick={() => setDrawing(true)} className={`${button} border border-border hover:bg-card`}>
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
        <button type="button" onClick={onSearchThisArea} className={`${button} bg-primary text-on-primary shadow-lg hover:bg-primary-hover`}>
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
    if (notice !== null && notice !== "rate_limited") {
      const id = window.setTimeout(() => setNotice(null), 6000);
      return () => window.clearTimeout(id);
    }
  }, [notice, setNotice]);
  const messages: Record<NonNullable<typeof notice>, string> = {
    rate_limited: t("map.rateLimited"),
    load_error: t("map.loadError"),
    draw_invalid: t("map.drawInvalid"),
    geo_denied: t("map.geoDenied"),
    geo_unavailable: t("map.geoUnavailable"),
  };
  const text = notice ? messages[notice] : "";
  return (
    <div role="status" aria-live="polite" className="pointer-events-none flex justify-center">
      {text && <p className={`${panel} pointer-events-auto max-w-sm px-4 py-2 text-center text-sm`}>{text}</p>}
    </div>
  );
}
