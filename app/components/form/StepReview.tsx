import { useState } from "react";
import { Link } from "react-router";
import { useLocale, useT } from "~/i18n/useT";
import { OFFERS_VISIBILITIES, type OffersVisibility } from "~/shared/constants";
import { ltrIsolate } from "~/shared/digits";
import type { DraftView, MissingField, WizardStep } from "~/shared/schemas/listingForm";
import { formatPrice } from "~/utils/format";
import { ApiError, submitDraft } from "./api";
import { card, field, primaryButton, type WizardData } from "./types";

/**
 * Step 5 (SPEC §7): what is still missing, a summary, offers visibility, the
 * phone (masked profile number or a new one — never sent back to the page),
 * the required commission-terms checkbox (§19), and submit → `pending`.
 */
export function StepReview({
  data,
  draft,
  missing,
  onGo,
  onOffers,
  beforeSubmit,
  onSubmitted,
}: {
  data: WizardData;
  draft: DraftView;
  missing: MissingField[];
  onGo: (step: WizardStep) => void;
  onOffers: (v: OffersVisibility) => void;
  beforeSubmit: () => Promise<void>;
  onSubmitted: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [useOther, setUseOther] = useState(!data.maskedPhone);
  const [phone, setPhone] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<MissingField[] | null>(null);

  const label = (m: MissingField) => {
    if (m.field.startsWith("address.")) return data.address.find((f) => `address.${f.key}` === m.field)?.label ?? m.field;
    if (m.field.startsWith("identifiers.")) return data.identifiers.find((s) => `identifiers.${s.key}` === m.field)?.label ?? m.field;
    return t(`wizard.review.missingFields.${m.field}`);
  };
  const shownMissing = serverMissing ?? missing;
  const blocked = shownMissing.length > 0 || data.limits.atSubmissionLimit;

  const submit = async () => {
    setError(null);
    if (!accepted) return setError(t("wizard.review.errors.terms_required"));
    if (useOther && !phone.trim()) return setError(t("wizard.review.errors.phone_required"));
    setBusy(true);
    try {
      await beforeSubmit();
      await submitDraft(draft.id, { acceptTerms: true, termsVersion: data.terms.version, ...(useOther ? { phone: phone.trim() } : {}) });
      // The number typed here is not kept in the page after submitting.
      setPhone("");
      onSubmitted();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "generic";
      if (e instanceof ApiError && e.missing) setServerMissing(e.missing);
      const known = ["terms_required", "phone_required", "phone_invalid", "incomplete", "submission_rate_limited", "terms_outdated"];
      setError(t(`wizard.review.errors.${known.includes(code) ? code : "generic"}`, { max: data.limits.submissionsPerDay }));
    } finally {
      setBusy(false);
    }
  };

  const d = draft.details;
  const title = (locale === "ar" ? d.titleAr || d.titleEn : d.titleEn || d.titleAr) || "—";
  const area = draft.location.areaPath.map((a) => (locale === "ar" ? a.nameAr : a.nameEn)).join(" › ") || "—";

  return (
    <div className="flex flex-col gap-5">
      {shownMissing.length > 0 && (
        <section className={`${card} border-error-text`} aria-labelledby="review-missing" role="status">
          <h2 id="review-missing" className="mb-2 font-semibold">
            {t("wizard.review.missing")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {shownMissing.map((m) => (
              <li key={m.field} className="flex items-center justify-between gap-2 text-sm">
                <span>{label(m)}</span>
                <button type="button" onClick={() => onGo(m.step)} className="rounded-md px-2 py-1 font-medium text-primary-text hover:bg-card">
                  {t("wizard.review.fix")} — {t(`wizard.steps.${m.step}`)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card} aria-labelledby="review-summary">
        <h2 id="review-summary" className="mb-3 text-lg font-semibold">
          {t("wizard.review.summary")}
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row k={t("wizard.type.category")} v={`${t(`listing.categories.${draft.category}`)} · ${t(`listing.types.${draft.listingType}`)}`} />
          <Row k={t("wizard.details.price")} v={d.price === null ? "—" : formatPrice(d.price, data.country.currency, data.country.currencyDecimals, locale)} ltr />
          <Row k={t("wizard.details.title")} v={title} />
          <Row k={t("wizard.location.area")} v={area} />
          <Row k={t("wizard.photos.heading")} v={String(draft.images.length)} />
        </dl>
      </section>

      <section className={card} aria-labelledby="review-offers">
        <label id="review-offers" htmlFor="review-offers-select" className="mb-1 block font-semibold">
          {t("wizard.review.offers")}
        </label>
        <p className="mb-2 text-sm text-muted">{t("wizard.review.offersLater")}</p>
        <select id="review-offers-select" defaultValue={draft.offersVisibility} onChange={(e) => onOffers(e.target.value as OffersVisibility)} className={`${field} sm:max-w-xs`}>
          {OFFERS_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {t(`wizard.review.offerOptions.${v}`)}
            </option>
          ))}
        </select>
      </section>

      <section className={card} aria-labelledby="review-phone">
        <h2 id="review-phone" className="mb-1 font-semibold">
          {t("wizard.review.phone")}
        </h2>
        <p className="mb-3 text-sm text-muted">{t("wizard.review.phoneNote")}</p>
        {data.maskedPhone ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t("wizard.review.phone")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="phone-choice" checked={!useOther} onChange={() => setUseOther(false)} className="accent-primary" />
              {/* Masked: the number itself never reaches the page (CLAUDE.md rule 1). */}
              <span>
                {t("wizard.review.useProfilePhone", { masked: "" })}
                <bdi dir="ltr" className="font-medium">
                  {data.maskedPhone}
                </bdi>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="phone-choice" checked={useOther} onChange={() => setUseOther(true)} className="accent-primary" />
              {t("wizard.review.useOtherPhone")}
            </label>
          </fieldset>
        ) : (
          <p className="text-sm">{t("wizard.review.noProfilePhone")}</p>
        )}
        {useOther && (
          <div className="mt-3 flex flex-col gap-1.5 sm:max-w-xs">
            <label htmlFor="review-phone-input" className="text-sm font-medium">
              {t("wizard.review.newPhone")}
            </label>
            <input id="review-phone-input" type="tel" dir="ltr" autoComplete="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} className={`${field} text-start`} />
          </div>
        )}
      </section>

      <section className={card}>
        <p className="mb-3 text-sm">{t("wizard.review.commissionRate", { rate: formatRate(data.terms.rate, locale) })}</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1 accent-primary" />
          <span>
            {t("wizard.review.termsBefore")}{" "}
            <Link to={`/${locale}/terms/commission`} target="_blank" className="font-medium text-primary-text underline">
              {t("wizard.review.termsLink")}
            </Link>{" "}
            {t("wizard.review.termsAfter", { version: ltrIsolate(data.terms.version) })}
            {data.terms.draft && <span className="ms-1 text-muted">{t("wizard.review.termsDraft")}</span>}
          </span>
        </label>

        {data.limits.atSubmissionLimit && (
          <p className="mt-3 text-sm text-error-text">{t("wizard.limits.submissionLimit", { max: data.limits.submissionsPerDay })}</p>
        )}
        <div aria-live="assertive" className="mt-3 min-h-5 text-sm text-error-text">
          {error}
        </div>
        <button type="button" onClick={() => void submit()} disabled={busy || blocked} className={`${primaryButton} mt-2 w-full sm:w-auto`}>
          {busy ? t("wizard.review.submitting") : t("wizard.review.submit")}
        </button>
      </section>
    </div>
  );
}

function Row({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 sm:block sm:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium">{ltr ? <bdi>{v}</bdi> : v}</dd>
    </div>
  );
}

/** The rate as a percentage with Western digits in both languages (SPEC §14). */
function formatRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { style: "percent", maximumFractionDigits: 2 }).format(rate);
}
