import { Link, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { useLocale, useT } from "~/i18n/useT";
import { listingPath } from "~/shared/listingUrl";
import { missingForSubmit, WIZARD_STEPS, wizardStepSchema, type DraftView, type WizardStep } from "~/shared/schemas/listingForm";
import { deleteDraft } from "./api";
import { StepDetails } from "./StepDetails";
import { StepLocation } from "./StepLocation";
import { StepPhotos } from "./StepPhotos";
import { StepReview } from "./StepReview";
import { TypeChoices } from "./StepType";
import { card, primaryButton, secondaryButton, type WizardData } from "./types";
import { useDraftSaver, type SaveStatus } from "./useDraftSaver";

/**
 * Submit wizard (SPEC §7): five steps, the current one in the URL (`?step=`),
 * autosaved as the lister types. Drafts can be left at any point and resumed.
 */
export function Wizard({ data }: { data: WizardData }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [params, setParams] = useSearchParams();
  const step = wizardStepSchema.safeParse(params.get("step")).data ?? data.step;
  const saver = useDraftSaver(data.draft);
  const { draft } = saver;
  const missing = missingForSubmit(draft, data.requirements);
  const index = WIZARD_STEPS.indexOf(step);

  const go = async (next: WizardStep) => {
    await saver.flush();
    setParams({ step: next }, { preventScrollReset: false });
    window.scrollTo({ top: 0 });
  };

  const remove = async () => {
    if (!window.confirm(t("wizard.deleteConfirm"))) return;
    await deleteDraft(draft.id);
    navigate(`/${locale}/listings/new`);
  };

  // Fresh loader data after submitting (the autosave copy still says "draft").
  if (data.draft.status !== "draft") return <Submitted draft={data.draft} />;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("wizard.editTitle")}</h1>
          <p className="text-sm text-muted">{t("wizard.stepOf", { n: index + 1, total: WIZARD_STEPS.length })}</p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator status={saver.status} />
          <button type="button" onClick={() => void remove()} className="rounded-lg px-3 py-1.5 text-sm text-error-text hover:bg-card">
            {t("wizard.deleteDraft")}
          </button>
        </div>
      </header>

      <nav aria-label={t("wizard.stepsLabel")}>
        <ol className="grid grid-cols-5 gap-1.5">
          {WIZARD_STEPS.map((s, i) => {
            const done = s !== "review" && !missing.some((m) => m.step === s);
            const current = s === step;
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => void go(s)}
                  aria-current={current ? "step" : undefined}
                  className={`flex w-full flex-col items-center gap-1 rounded-lg border px-1 py-2 text-xs sm:text-sm ${
                    current ? "border-primary-text bg-card font-semibold" : "border-border hover:bg-card"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-6 items-center justify-center rounded-full text-xs ${done ? "bg-success text-on-primary" : current ? "bg-primary text-on-primary" : "bg-card text-muted"}`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="truncate">{t(`wizard.steps.${s}`)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === "type" && (
        <section className={card}>
          <h2 className="mb-4 text-lg font-semibold">{t("wizard.type.heading")}</h2>
          <TypeChoices value={draft} onChange={(v) => saver.schedule("type", v, true)} />
        </section>
      )}
      {step === "location" && <StepLocation data={data} draft={draft} errors={saver.fieldErrors.location ?? {}} onSave={(v, now) => saver.schedule("location", v, now)} />}
      {step === "details" && (
        <StepDetails
          key={draft.category}
          draft={draft}
          currency={data.country.currency}
          decimals={data.country.currencyDecimals}
          errors={saver.fieldErrors.details ?? {}}
          onSave={(v) => saver.schedule("details", v)}
        />
      )}
      {step === "photos" && <StepPhotos draft={draft} onImages={(images) => saver.setDraft((d) => ({ ...d, images }))} />}
      {step === "review" && (
        <StepReview
          data={data}
          draft={draft}
          missing={missing}
          onGo={(s) => void go(s)}
          onOffers={(v) => saver.schedule("review", { offersVisibility: v }, true)}
          beforeSubmit={saver.flush}
          onSubmitted={() => void revalidator.revalidate()}
        />
      )}

      <div className="flex justify-between gap-3">
        {index > 0 ? (
          <button type="button" onClick={() => void go(WIZARD_STEPS[index - 1]!)} className={secondaryButton}>
            {t("wizard.back")}
          </button>
        ) : (
          <span />
        )}
        {index < WIZARD_STEPS.length - 1 && (
          <button type="button" onClick={() => void go(WIZARD_STEPS[index + 1]!)} className={primaryButton}>
            {t("wizard.next")}
          </button>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const t = useT();
  if (status === "idle") return <span aria-live="polite" className="text-sm" />;
  return (
    <span aria-live="polite" className={`text-sm ${status === "error" ? "text-error-text" : "text-muted"}`}>
      {t(`wizard.save.${status}`)}
    </span>
  );
}

function Submitted({ draft }: { draft: DraftView }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <section className={card} role="status">
        <h1 className="mb-2 text-2xl font-bold">{draft.status === "pending" ? t("wizard.review.submitted.heading") : t("wizard.notEditable")}</h1>
        {draft.status === "pending" && <p className="mb-4 text-muted">{t("wizard.review.submitted.body")}</p>}
        <div className="flex flex-wrap gap-3">
          <Link to={listingPath(locale, draft.id, draft.slug)} className={primaryButton}>
            {t("wizard.review.submitted.preview")}
          </Link>
          <Link to={`/${locale}/listings/new`} className={secondaryButton}>
            {t("wizard.review.submitted.another")}
          </Link>
        </div>
      </section>
    </div>
  );
}
