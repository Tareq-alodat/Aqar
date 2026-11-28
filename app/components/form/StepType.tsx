import { useState } from "react";
import { useT } from "~/i18n/useT";
import { CATEGORIES, LISTING_TYPES, RENT_PERIODS, type Category, type ListingType, type RentPeriod } from "~/shared/constants";
import type { TypeStep } from "~/shared/schemas/listingForm";

/**
 * Step 1 (SPEC §7): category, listing type and rent period. Radio inputs with
 * names, so the "new listing" page works as a plain form; `onChange` lets the
 * wizard autosave instead.
 */
export function TypeChoices({ value, onChange }: { value?: Partial<TypeStep>; onChange?: (v: TypeStep) => void }) {
  const t = useT();
  const [category, setCategory] = useState<Category | undefined>(value?.category);
  const [listingType, setListingType] = useState<ListingType | undefined>(value?.listingType);
  const [rentPeriod, setRentPeriod] = useState<RentPeriod>(value?.rentPeriod ?? "monthly");

  const emit = (next: { category?: Category; listingType?: ListingType; rentPeriod?: RentPeriod }) => {
    const c = next.category ?? category;
    const l = next.listingType ?? listingType;
    const r = next.rentPeriod ?? rentPeriod;
    if (c && l) onChange?.({ category: c, listingType: l, rentPeriod: l === "rent" ? r : null });
  };

  const option = (checked: boolean) =>
    `flex cursor-pointer items-center justify-center rounded-xl border px-3 py-3 text-center text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-text ${
      checked ? "border-primary bg-primary text-on-primary" : "border-muted/60 bg-background hover:border-foreground"
    }`;

  return (
    <div className="flex flex-col gap-6">
      <fieldset>
        <legend className="mb-2 font-semibold">{t("wizard.type.category")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CATEGORIES.map((c) => (
            <label key={c} className={option(category === c)}>
              <input
                type="radio"
                name="category"
                value={c}
                required
                checked={category === c}
                onChange={() => {
                  setCategory(c);
                  emit({ category: c });
                }}
                className="sr-only"
              />
              {t(`listing.categories.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-semibold">{t("wizard.type.listingType")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {LISTING_TYPES.map((l) => (
            <label key={l} className={option(listingType === l)}>
              <input
                type="radio"
                name="listingType"
                value={l}
                required
                checked={listingType === l}
                onChange={() => {
                  setListingType(l);
                  emit({ listingType: l });
                }}
                className="sr-only"
              />
              {t(`listing.types.${l}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {listingType === "rent" && (
        <fieldset>
          <legend className="mb-2 font-semibold">{t("wizard.type.rentPeriod")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            {RENT_PERIODS.map((r) => (
              <label key={r} className={option(rentPeriod === r)}>
                <input
                  type="radio"
                  name="rentPeriod"
                  value={r}
                  checked={rentPeriod === r}
                  onChange={() => {
                    setRentPeriod(r);
                    emit({ rentPeriod: r });
                  }}
                  className="sr-only"
                />
                {t(`wizard.type.rentPeriods.${r}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
