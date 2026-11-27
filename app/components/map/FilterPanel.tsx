import { useState, type ReactNode } from "react";
import { useLocale, useT } from "~/i18n/useT";
import { CATEGORIES, LISTING_TYPES, type Category, type ListingType } from "~/shared/constants";
import { AMENITIES, BED_OPTIONS, BEDS_OR_MORE, countFilters, type Amenity, type SearchFilters } from "~/shared/schemas/mapSearch";
import type { AreaSummary } from "./types";

interface FilterPanelProps {
  filters: SearchFilters;
  areas: AreaSummary[];
  onChange(filters: SearchFilters): void;
  /** "bar": compact row with a "More filters" toggle (desktop); "sheet": everything stacked (mobile). */
  layout: "bar" | "sheet";
  onDone?(): void;
}

const AGE_OPTIONS = [1, 5, 10, 20, 30];
const BATH_OPTIONS = [1, 2, 3, 4];

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary text-on-primary hover:bg-primary-hover" : "border-muted/60 bg-background hover:border-foreground"}`;
// Form fields: border in `muted` so the control boundary reaches 3:1 (WCAG 1.4.11).
const field = "rounded-lg border border-muted bg-background px-2.5 py-1.5 text-sm placeholder:text-muted";

/** Number box applied on blur or Enter (no request per keystroke). */
function NumberBox({ label, value, onCommit }: { label: string; value: number | undefined; onCommit(v: number | undefined): void }) {
  const commit = (raw: string) => {
    const v = raw.trim() === "" ? undefined : Number(raw);
    if (v === undefined || (Number.isFinite(v) && v >= 0)) onCommit(v);
  };
  return (
    <input
      key={value ?? "empty"}
      type="number"
      inputMode="numeric"
      min={0}
      dir="ltr"
      aria-label={label}
      placeholder={label}
      defaultValue={value ?? ""}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
      className={`${field} w-28`}
    />
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </fieldset>
  );
}

/** Filters of SPEC §5.3. Every change goes straight to the URL (and so to the search). */
export function FilterPanel({ filters, areas, onChange, layout, onDone }: FilterPanelProps) {
  const t = useT();
  const locale = useLocale();
  const [more, setMore] = useState(false);
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });
  const toggle = <T,>(list: T[] | undefined, v: T) => {
    const next = list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];
    return next.length ? next : undefined;
  };
  const name = (a: AreaSummary) => (locale === "ar" ? a.nameAr : a.nameEn);
  const governorates = areas.filter((a) => a.level === areas[0]?.level);
  const cities = areas.filter((a) => a.level !== governorates[0]?.level);

  const basic = (
    <>
      <Group label={t("filters.type")}>
        <button type="button" className={chip(!filters.type)} aria-pressed={!filters.type} onClick={() => set({ type: undefined })}>
          {t("filters.any")}
        </button>
        {LISTING_TYPES.map((type: ListingType) => (
          <button key={type} type="button" className={chip(filters.type === type)} aria-pressed={filters.type === type} onClick={() => set({ type })}>
            {t(`listing.types.${type}`)}
          </button>
        ))}
      </Group>
      <Group label={t("filters.category")}>
        <select
          aria-label={t("filters.category")}
          value={filters.cat ?? ""}
          onChange={(e) => set({ cat: (e.target.value || undefined) as Category | undefined })}
          className={field}
        >
          <option value="">{t("filters.any")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`listing.categories.${c}`)}
            </option>
          ))}
        </select>
      </Group>
      <Group label={t("filters.price")}>
        <NumberBox label={t("filters.minPrice")} value={filters.minPrice} onCommit={(minPrice) => set({ minPrice })} />
        <span className="text-muted">–</span>
        <NumberBox label={t("filters.maxPrice")} value={filters.maxPrice} onCommit={(maxPrice) => set({ maxPrice })} />
      </Group>
      <Group label={t("filters.beds")}>
        {BED_OPTIONS.map((b) => (
          <button
            key={b}
            type="button"
            className={chip(Boolean(filters.beds?.includes(b)))}
            aria-pressed={Boolean(filters.beds?.includes(b))}
            onClick={() => set({ beds: toggle(filters.beds, b) })}
          >
            {b === BEDS_OR_MORE ? t("filters.bedsOrMore") : b}
          </button>
        ))}
      </Group>
    </>
  );

  const extra = (
    <>
      <Group label={t("filters.baths")}>
        <select
          aria-label={t("filters.baths")}
          value={filters.baths ?? ""}
          onChange={(e) => set({ baths: e.target.value ? Number(e.target.value) : undefined })}
          className={field}
        >
          <option value="">{t("filters.any")}</option>
          {BATH_OPTIONS.map((b) => (
            <option key={b} value={b}>
              {t("filters.bathsMin", { count: b })}
            </option>
          ))}
        </select>
      </Group>
      <Group label={t("filters.area")}>
        <NumberBox label={t("filters.minArea")} value={filters.minArea} onCommit={(minArea) => set({ minArea })} />
        <span className="text-muted">–</span>
        <NumberBox label={t("filters.maxArea")} value={filters.maxArea} onCommit={(maxArea) => set({ maxArea })} />
      </Group>
      <Group label={t("filters.amenities")}>
        {AMENITIES.map((a: Amenity) => (
          <button
            key={a}
            type="button"
            className={chip(Boolean(filters.amen?.includes(a)))}
            aria-pressed={Boolean(filters.amen?.includes(a))}
            onClick={() => set({ amen: toggle(filters.amen, a) })}
          >
            {t(`filters.amen.${a}`)}
          </button>
        ))}
      </Group>
      <Group label={t("filters.maxAge")}>
        <select
          aria-label={t("filters.maxAge")}
          value={filters.maxAge ?? ""}
          onChange={(e) => set({ maxAge: e.target.value ? Number(e.target.value) : undefined })}
          className={field}
        >
          <option value="">{t("filters.any")}</option>
          {AGE_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {t("filters.maxAgeOption", { count: a })}
            </option>
          ))}
        </select>
      </Group>
      <Group label={t("filters.onlyIn")}>
        <select
          aria-label={t("filters.onlyIn")}
          value={filters.area ?? ""}
          onChange={(e) => set({ area: e.target.value ? Number(e.target.value) : undefined })}
          className={`${field} max-w-56`}
        >
          <option value="">{t("filters.any")}</option>
          <optgroup label={t("map.governorate")}>
            {governorates.map((a) => (
              <option key={a.id} value={a.id}>
                {name(a)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("map.city")}>
            {cities.map((a) => (
              <option key={a.id} value={a.id}>
                {name(a)}
              </option>
            ))}
          </optgroup>
        </select>
      </Group>
    </>
  );

  const active = countFilters(filters);
  const reset = active > 0 && (
    <button type="button" onClick={() => onChange({})} className="text-sm text-primary-text hover:underline">
      {t("filters.reset")}
    </button>
  );

  if (layout === "sheet") {
    return (
      <div className="flex flex-col gap-5">
        {basic}
        {extra}
        <div className="flex items-center justify-between gap-3 pt-2">
          {reset || <span />}
          <button type="button" onClick={onDone} className="rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover">
            {t("filters.done")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {basic}
        <div className="flex items-center gap-4 pb-1">
          <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="text-sm font-medium hover:text-primary-text">
            {more ? t("filters.fewer") : t("filters.more")}
          </button>
          {reset}
        </div>
      </div>
      {more && <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border pt-3">{extra}</div>}
    </div>
  );
}
