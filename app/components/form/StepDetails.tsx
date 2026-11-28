import { useState } from "react";
import { useT } from "~/i18n/useT";
import { AMENITY_TAGS, FURNISHED_OPTIONS, type AmenityTag, type Furnished } from "~/shared/constants";
import { toWesternDigits } from "~/shared/digits";
import { hasAtMostDecimals, type DetailsStep, type DraftView } from "~/shared/schemas/listingForm";
import type { FieldErrors } from "./api";
import { card, choice, field } from "./types";

type NumKey = "price" | "areaSqm" | "bedrooms" | "bathrooms" | "floors" | "floorNumber" | "ageYears";
const BOOL_KEYS = ["parking", "garden", "pool", "elevator"] as const;

/** "1,250.5" / "١٢٥٠" → 1250.5; "" → null; anything else → NaN. */
function parseNumber(raw: string): number | null {
  const s = toWesternDigits(raw).replace(/[,\s٬]/g, "").replace("٫", ".");
  if (!s) return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

/**
 * Step 3 (SPEC §7): price, features (land hides rooms and floors), amenities,
 * titles and descriptions in Arabic and English (at least one language).
 */
export function StepDetails({
  draft,
  currency,
  decimals,
  errors,
  onSave,
}: {
  draft: DraftView;
  currency: string;
  decimals: number;
  errors: FieldErrors;
  onSave: (v: DetailsStep) => void;
}) {
  const t = useT();
  const d = draft.details;
  const isLand = draft.category === "land";
  const [nums, setNums] = useState<Record<NumKey, string>>({
    price: d.price?.toString() ?? "",
    areaSqm: d.areaSqm?.toString() ?? "",
    bedrooms: d.bedrooms?.toString() ?? "",
    bathrooms: d.bathrooms?.toString() ?? "",
    floors: d.floors?.toString() ?? "",
    floorNumber: d.floorNumber?.toString() ?? "",
    ageYears: d.ageYears?.toString() ?? "",
  });
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [text, setText] = useState({ titleAr: d.titleAr ?? "", titleEn: d.titleEn ?? "", descriptionAr: d.descriptionAr ?? "", descriptionEn: d.descriptionEn ?? "" });

  const numError = (key: NumKey): string | null => {
    const v = parseNumber(nums[key]);
    if (v === null) return null;
    if (Number.isNaN(v) || v < (key === "floorNumber" ? -5 : 0)) return t("wizard.location.fieldErrors.invalid");
    if (key === "price" && !hasAtMostDecimals(v, decimals)) return t("wizard.details.priceDecimals", { decimals });
    if (key !== "price" && key !== "areaSqm" && !Number.isInteger(v)) return t("wizard.location.fieldErrors.invalid");
    return null;
  };

  const setNum = (key: NumKey, raw: string) => {
    setNums((prev) => ({ ...prev, [key]: raw }));
    const v = parseNumber(raw);
    // Only valid values are saved; the error is shown until the value is fixed.
    if (v === null || (!Number.isNaN(v) && v >= (key === "floorNumber" ? -5 : 0))) {
      if (key === "price" && v !== null && !hasAtMostDecimals(v, decimals)) return;
      if (key !== "price" && key !== "areaSqm" && v !== null && !Number.isInteger(v)) return;
      if (key === "areaSqm" && v === 0) return;
      onSave({ [key]: v } as DetailsStep);
    }
  };

  const priceLabel =
    draft.listingType === "rent" && draft.rentPeriod
      ? t(`wizard.details.rentPrice.${draft.rentPeriod}`)
      : draft.listingType === "exchange"
        ? t("wizard.details.exchangePrice")
        : t("wizard.details.price");

  const numInput = (key: NumKey, label: string, hint?: string) => {
    const id = `details-${key}`;
    const err = numError(key) ?? (errors[key] ? t("wizard.details.priceDecimals", { decimals }) : null);
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <input
          id={id}
          dir="ltr"
          inputMode={key === "price" || key === "areaSqm" ? "decimal" : "numeric"}
          value={nums[key]}
          onChange={(e) => setNum(key, e.target.value)}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${field} text-start ${err ? "border-error-text" : ""}`}
        />
        {hint && !err && (
          <p id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </p>
        )}
        {err && (
          <p id={`${id}-error`} className="text-xs text-error-text">
            {err}
          </p>
        )}
      </div>
    );
  };

  const setTextField = (key: keyof typeof text, value: string) => {
    setText((prev) => ({ ...prev, [key]: value }));
    onSave({ [key]: value.trim() ? value : null } as DetailsStep);
  };
  const titleKey = lang === "ar" ? "titleAr" : "titleEn";
  const descKey = lang === "ar" ? "descriptionAr" : "descriptionEn";

  return (
    <div className="flex flex-col gap-5">
      <section className={card} aria-labelledby="details-price-heading">
        <h2 id="details-price-heading" className="mb-3 text-lg font-semibold">
          {t("wizard.details.heading")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {numInput("price", priceLabel, t("wizard.details.priceHint", { currency, decimals }))}
          {numInput("areaSqm", t("filters.area"))}
        </div>
      </section>

      {!isLand && (
        <section className={card} aria-labelledby="details-features-heading">
          <h2 id="details-features-heading" className="mb-3 text-lg font-semibold">
            {t("wizard.details.features")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {numInput("bedrooms", t("detail.features.bedrooms"))}
            {numInput("bathrooms", t("detail.features.bathrooms"))}
            {numInput("floors", t("detail.features.floors"))}
            {numInput("floorNumber", t("detail.features.floorNumber"))}
            {numInput("ageYears", t("detail.features.age"))}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="details-furnished" className="text-sm font-medium">
                {t("detail.features.furnished")}
              </label>
              <select
                id="details-furnished"
                defaultValue={d.furnished ?? ""}
                onChange={(e) => onSave({ furnished: (e.target.value || null) as Furnished | null })}
                className={field}
              >
                <option value="">{t("wizard.details.notSet")}</option>
                {FURNISHED_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {t(`detail.furnished.${f}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Amenities draft={draft} onSave={onSave} />
        </section>
      )}

      <section className={card} aria-labelledby="details-text-heading">
        <h2 id="details-text-heading" className="mb-1 text-lg font-semibold">
          {t("wizard.details.text")}
        </h2>
        <p className="mb-3 text-sm text-muted">{t("wizard.details.textHint")}</p>
        <div role="tablist" aria-label={t("wizard.details.text")} className="mb-3 flex gap-2">
          {(["ar", "en"] as const).map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)} className={choice(lang === l)} lang={l}>
              {t(`wizard.details.languages.${l}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-4" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`details-${titleKey}`} className="text-sm font-medium">
              {t("wizard.details.title")}
            </label>
            <input id={`details-${titleKey}`} key={titleKey} value={text[titleKey]} maxLength={120} onChange={(e) => setTextField(titleKey, e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`details-${descKey}`} className="text-sm font-medium">
              {t("wizard.details.description")}
            </label>
            <textarea
              id={`details-${descKey}`}
              key={descKey}
              value={text[descKey]}
              maxLength={5000}
              rows={6}
              onChange={(e) => setTextField(descKey, e.target.value)}
              className={field}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function Amenities({ draft, onSave }: { draft: DraftView; onSave: (v: DetailsStep) => void }) {
  const t = useT();
  const [bools, setBools] = useState({
    parking: draft.details.parking,
    garden: draft.details.garden,
    pool: draft.details.pool,
    elevator: draft.details.elevator,
  });
  const [tags, setTags] = useState<AmenityTag[]>(draft.details.amenities);
  return (
    <fieldset className="mt-5">
      <legend className="mb-2 text-sm font-medium">{t("wizard.details.amenities")}</legend>
      <div className="flex flex-wrap gap-2">
        {BOOL_KEYS.map((k) => (
          <label key={k} className={`${choice(bools[k])} cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-text`}>
            <input
              type="checkbox"
              className="sr-only"
              checked={bools[k]}
              onChange={(e) => {
                setBools((b) => ({ ...b, [k]: e.target.checked }));
                onSave({ [k]: e.target.checked });
              }}
            />
            {t(`filters.amen.${k}`)}
          </label>
        ))}
        {AMENITY_TAGS.map((tag) => {
          const on = tags.includes(tag);
          return (
            <label key={tag} className={`${choice(on)} cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-text`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={(e) => {
                  const next = e.target.checked ? [...tags, tag] : tags.filter((x) => x !== tag);
                  setTags(next);
                  onSave({ amenities: next });
                }}
              />
              {t(`listing.amenityTags.${tag}`)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
