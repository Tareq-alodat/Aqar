import { data, Form, Link, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { deleteDraft } from "~/components/form/api";
import { TypeChoices } from "~/components/form/StepType";
import { card, primaryButton } from "~/components/form/types";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { createListingAction, loadNewListing } from "~/utils/submission.server";
import type { Route } from "./+types/listing-new";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) throw data(null, { status: 404 });
  return loadNewListing(context, request);
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) throw data(null, { status: 404 });
  return createListingAction(context, request, lang.data.lang);
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ params }: Route.MetaArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) return [];
  const t = getT(lang.data.lang);
  return [{ title: `${t("wizard.title")} | ${t("app.name")}` }, { name: "robots", content: "noindex" }];
}

/** /:lang/listings/new — step 1 (creates the draft), plus the lister's drafts to continue. */
export default function NewListingPage() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const t = useT();
  const locale = useLocale();

  if (loaded.forbidden) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className={card}>{t("wizard.forbidden")}</p>
      </div>
    );
  }
  const { drafts, limits } = loaded;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { dateStyle: "medium" }).format(new Date(iso));
  const remove = async (id: number) => {
    if (!window.confirm(t("wizard.deleteConfirm"))) return;
    await deleteDraft(id);
    void revalidator.revalidate();
  };
  const left = Math.max(0, limits.submissionsPerDay - limits.submittedToday);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("wizard.title")}</h1>
      <p className="text-sm text-muted">
        {limits.atSubmissionLimit ? t("wizard.limits.submissionLimit", { max: limits.submissionsPerDay }) : t("wizard.limits.submissionsLeft", { count: left })}
      </p>

      {limits.atDraftLimit || result?.error === "draft_limit" ? (
        <p className={`${card} text-error-text`} role="status">
          {t("wizard.limits.draftLimit", { max: limits.draftLimit })}
        </p>
      ) : (
        <Form method="post" className={card}>
          <h2 className="mb-4 text-lg font-semibold">{t("wizard.type.heading")}</h2>
          <TypeChoices />
          {result?.error === "invalid_input" && <p className="mt-3 text-sm text-error-text">{t("wizard.location.fieldErrors.required")}</p>}
          <button type="submit" disabled={navigation.state !== "idle"} className={`${primaryButton} mt-5`}>
            {t("wizard.type.start")}
          </button>
        </Form>
      )}

      {drafts.length > 0 && (
        <section className={card} aria-labelledby="drafts-title">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="drafts-title" className="text-lg font-semibold">
              {t("wizard.drafts.heading")}
            </h2>
            <span className="text-sm text-muted">{t("wizard.limits.drafts", { count: limits.drafts, max: limits.draftLimit })}</span>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {drafts.map((d) => {
              const title = (locale === "ar" ? d.titleAr || d.titleEn : d.titleEn || d.titleAr) || t("wizard.drafts.untitled");
              return (
                <li key={d.id} className="flex items-center gap-3 py-3">
                  <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-card">
                    {d.thumbnailUrl && <img src={d.thumbnailUrl} alt="" className="size-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{title}</p>
                    <p className="text-xs text-muted">
                      {t(`listing.categories.${d.category}`)} · {t(`listing.types.${d.listingType}`)} · {t("wizard.drafts.updated", { date: date(d.updatedAt) })}
                    </p>
                  </div>
                  <Link to={`/${locale}/listings/${d.id}/edit?step=location`} className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary-text hover:bg-card">
                    {t("wizard.drafts.continue")}
                  </Link>
                  <button type="button" onClick={() => void remove(d.id)} className="rounded-lg px-3 py-1.5 text-sm text-error-text hover:bg-card">
                    {t("wizard.deleteDraft")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
