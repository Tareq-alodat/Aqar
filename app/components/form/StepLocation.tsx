import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import type { AreaSummary } from "~/components/map/types";
import { useTheme } from "~/hooks/useTheme";
import { useLocale, useT } from "~/i18n/useT";
import type { BBox } from "~/shared/geo";
import { dirFor } from "~/shared/locales";
import type { DraftView, LngLat, LocationStep } from "~/shared/schemas/listingForm";
import type { FieldErrors } from "./api";
import { card, field, type WizardData, type WizardField, type WizardIdentifier } from "./types";

const PinMap = lazy(() => import("./PinMap"));
const noSubscribe = () => () => {};

type IdentifierValues = Record<string, string | Record<string, string>>;

/**
 * Step 2 (SPEC §7): jump to governorate/city, place the pin (area path looked
 * up by the server on save), see the public preview (approximate area), and
 * fill the country's typed address fields and identifiers with their visibility.
 */
export function StepLocation({
  data,
  draft,
  errors,
  onSave,
}: {
  data: WizardData;
  draft: DraftView;
  errors: FieldErrors;
  onSave: (v: LocationStep, immediate?: boolean) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [fit, setFit] = useState<{ bbox: BBox } | null>(null);
  const [pin, setPin] = useState<LngLat | null>(draft.location.point);
  const [address, setAddress] = useState<Record<string, string>>(draft.address);
  const [identifiers, setIdentifiers] = useState<IdentifierValues>(draft.identifiers);

  const controlLabels = useMemo(
    () => ({
      "NavigationControl.ZoomIn": t("map.controls.zoomIn"),
      "NavigationControl.ZoomOut": t("map.controls.zoomOut"),
      "AttributionControl.ToggleAttribution": t("map.controls.attribution"),
      "Map.Title": t("wizard.location.mapLabel"),
    }),
    [t],
  );

  const pick = (p: LngLat) => {
    setPin(p);
    onSave({ point: p }, true);
  };
  // Shown pin: the one just placed, or the saved one if the server refused it (out of area).
  const shownPin = errors.point ? draft.location.point : pin;
  const name = (a: { nameAr: string; nameEn: string }) => (locale === "ar" ? a.nameAr : a.nameEn);

  const changeAddress = (key: string, value: string) => {
    const next = { ...address, [key]: value };
    setAddress(next);
    onSave({ address: next });
  };
  const changeIdentifier = (key: string, value: string | Record<string, string>) => {
    const next = { ...identifiers, [key]: value };
    setIdentifiers(next);
    onSave({ identifiers: { [key]: value } });
  };

  return (
    <div className="flex flex-col gap-5">
      <section className={card} aria-labelledby="loc-map">
        <h2 id="loc-map" className="mb-1 text-lg font-semibold">
          {t("wizard.location.heading")}
        </h2>
        <p className="mb-3 text-sm text-muted">{t("wizard.location.hint")}</p>
        <JumpSelects areas={data.jumpAreas} onFit={(bbox) => setFit({ bbox })} name={name} />
        <div className="relative mt-3 h-80 overflow-hidden rounded-xl bg-card sm:h-96">
          {mounted ? (
            <Suspense fallback={<p className="p-4 text-sm text-muted">{t("wizard.location.loadingMap")}</p>}>
              <PinMap
                center={data.country.center}
                zoom={data.country.zoom}
                point={shownPin}
                displayPoint={draft.location.displayPoint}
                fit={fit}
                styleUrl={data.styles[theme]}
                locale={locale}
                dir={dirFor(locale)}
                controlLabels={controlLabels}
                onPick={pick}
              />
            </Suspense>
          ) : (
            <p className="p-4 text-sm text-muted">{t("wizard.location.loadingMap")}</p>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-1 text-sm" aria-live="polite">
          {errors.point === "out_of_area" && <p className="font-medium text-error-text">{t("wizard.location.outOfArea")}</p>}
          {draft.location.point ? (
            <>
              <p>
                <span className="text-muted">{t("wizard.location.area")}: </span>
                <span className="font-medium">{draft.location.areaPath.map(name).join(" › ") || "—"}</span>
              </p>
              {draft.location.needsReview && <p className="text-muted">{t("wizard.location.needsReview")}</p>}
              <p className="text-muted">{t("wizard.location.yourPin")}</p>
              <p className="text-muted">{t("wizard.location.publicPreview")}</p>
            </>
          ) : (
            <p className="text-muted">{t("wizard.location.noPin")}</p>
          )}
        </div>
      </section>

      {data.address.length > 0 && (
        <section className={card} aria-labelledby="loc-address">
          <h2 id="loc-address" className="mb-3 text-lg font-semibold">
            {t("wizard.location.address")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {data.address.map((f) => (
              <AddressInput key={f.key} f={f} value={address[f.key] ?? ""} error={errors[`address.${f.key}`]} onChange={(v) => changeAddress(f.key, v)} />
            ))}
          </div>
        </section>
      )}

      {data.identifiers.map((s) => (
        <IdentifierInputs
          key={s.key}
          scheme={s}
          category={draft.category}
          value={identifiers[s.key]}
          errors={errors}
          onChange={(v) => changeIdentifier(s.key, v)}
        />
      ))}
    </div>
  );
}

function JumpSelects({ areas, onFit, name }: { areas: AreaSummary[]; onFit: (b: BBox) => void; name: (a: AreaSummary) => string }) {
  const t = useT();
  const locale = useLocale();
  const [gov, setGov] = useState<number | null>(null);
  const top = areas[0]?.level;
  const byName = (a: AreaSummary, b: AreaSummary) => name(a).localeCompare(name(b), locale);
  const governorates = areas.filter((a) => a.level === top).sort(byName);
  const cities = areas.filter((a) => a.level !== top && a.parentId === gov).sort(byName);
  const go = (id: string) => {
    const a = areas.find((x) => String(x.id) === id);
    if (a) onFit(a.bbox);
    return a;
  };
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("map.jumpTo")}>
      <select aria-label={t("map.governorate")} defaultValue="" onChange={(e) => setGov(go(e.target.value)?.id ?? null)} className={`${field} w-auto`}>
        <option value="" disabled>
          {t("map.allGovernorates")}
        </option>
        {governorates.map((a) => (
          <option key={a.id} value={a.id}>
            {name(a)}
          </option>
        ))}
      </select>
      {cities.length > 0 && (
        <select key={gov} aria-label={t("map.city")} defaultValue="" onChange={(e) => go(e.target.value)} className={`${field} w-auto`}>
          <option value="" disabled>
            {t("map.allCities")}
          </option>
          {cities.map((a) => (
            <option key={a.id} value={a.id}>
              {name(a)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Visibility({ v }: { v: WizardField["visibility"] }) {
  const t = useT();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${v === "public" ? "bg-card text-muted" : "bg-secondary text-on-secondary"}`}>
      {t(`wizard.location.visibility.${v}`)}
    </span>
  );
}

function AddressInput({ f, value, error, onChange }: { f: WizardField; value: string; error?: string; onChange: (v: string) => void }) {
  const t = useT();
  const id = `address-${f.key}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {f.label}
        <span className="text-xs font-normal text-muted">{f.required ? t("wizard.location.required") : t("wizard.location.optional")}</span>
        <Visibility v={f.visibility} />
      </label>
      <input
        id={id}
        value={value}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${field} ${error ? "border-error-text" : ""}`}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-error-text">
          {t(`wizard.location.fieldErrors.${error}`)}
        </p>
      )}
    </div>
  );
}

function IdentifierInputs({
  scheme,
  category,
  value,
  errors,
  onChange,
}: {
  scheme: WizardIdentifier;
  category: DraftView["category"];
  value: string | Record<string, string> | undefined;
  errors: FieldErrors;
  onChange: (v: string | Record<string, string>) => void;
}) {
  const t = useT();
  const parts = scheme.parts?.filter((p) => p.key !== "apartment" || category === "apartment") ?? null;
  const values = typeof value === "object" ? value : {};
  const schemeError = Object.entries(errors).find(([k]) => k === `identifiers.${scheme.key}` || k.startsWith(`identifiers.${scheme.key}.`));
  const partError = (key: string) => errors[`identifiers.${scheme.key}.${key}`];
  return (
    <section className={card} aria-labelledby={`ident-${scheme.key}`}>
      <h2 id={`ident-${scheme.key}`} className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        {scheme.label}
        <span className="text-xs font-normal text-muted">{scheme.required ? t("wizard.location.required") : t("wizard.location.optional")}</span>
        <Visibility v="admin_only" />
      </h2>
      <p className="mb-3 text-sm text-muted">{t("wizard.location.identifierNote")}</p>
      {parts ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {parts.map((p) => {
            const id = `ident-${scheme.key}-${p.key}`;
            return (
              <div key={p.key} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-sm font-medium">
                  {p.label}
                </label>
                <input
                  id={id}
                  value={values[p.key] ?? ""}
                  inputMode={p.numeric ? "numeric" : undefined}
                  maxLength={100}
                  onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}
                  aria-invalid={partError(p.key) ? true : undefined}
                  className={`${field} ${partError(p.key) ? "border-error-text" : ""}`}
                />
                {partError(p.key) && <p className="text-xs text-error-text">{t(`wizard.location.fieldErrors.${partError(p.key)}`)}</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <input
          aria-label={scheme.label}
          value={typeof value === "string" ? value : ""}
          maxLength={100}
          onChange={(e) => onChange(e.target.value)}
          className={field}
        />
      )}
      {/* Incomplete multi-part details are not saved until every required part is filled. */}
      {schemeError?.[1] === "required" && <p className="mt-2 text-xs text-error-text">{t("wizard.location.partsRequired")}</p>}
    </section>
  );
}
