import { data, useLoaderData } from "react-router";
import { LegalDocument } from "~/components/legal/LegalDocument";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { ltrIsolate } from "~/shared/digits";
import { commissionTermsDocument } from "~/shared/legal/commissionTerms";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { loadCommissionTerms } from "~/utils/submission.server";
import type { Route } from "./+types/terms-commission";

export function loader({ params }: Route.LoaderArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) throw data(null, { status: 404 });
  return loadCommissionTerms();
}

export function meta({ params, data: d }: Route.MetaArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) return [];
  const t = getT(lang.data.lang);
  // Draft terms are not indexed.
  return [{ title: `${t("terms.commission.title")} | ${t("app.name")}` }, ...(d?.draft ? [{ name: "robots", content: "noindex" }] : [])];
}

/**
 * /:lang/terms/commission (SPEC §19): the reviewed text from
 * `docs/legal/commission-terms.md`. The Arabic text prevails; the English is a
 * translation. Each page shows its own language first and the other below.
 */
export default function CommissionTermsPage() {
  const { version, draft } = useLoaderData<typeof loader>();
  const t = useT();
  const locale = useLocale();
  const sections =
    locale === "ar"
      ? [
          { lang: "ar" as const, blocks: commissionTermsDocument.ar, label: null },
          { lang: "en" as const, blocks: commissionTermsDocument.en, label: t("terms.commission.englishTranslation") },
        ]
      : [
          { lang: "en" as const, blocks: commissionTermsDocument.en, label: null },
          { lang: "ar" as const, blocks: commissionTermsDocument.ar, label: t("terms.commission.arabicOriginal") },
        ];
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t("terms.commission.title")}</h1>
      <p className="text-sm text-muted">
        {t("terms.commission.version", { version: ltrIsolate(version) })} · {t("terms.commission.operator", { company: t("brand.company") })}
      </p>
      <p role="note" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium">
        {t("terms.commission.arabicPrevails")}
      </p>
      {draft && (
        <p role="note" className="rounded-xl border border-warning bg-warning px-4 py-3 text-sm font-medium text-on-accent">
          {t("terms.commission.draftBanner")}
        </p>
      )}
      {sections.map((s) => (
        <section key={s.lang} aria-label={s.label ?? undefined} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          {s.label && <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</p>}
          <LegalDocument blocks={s.blocks} lang={s.lang} />
        </section>
      ))}
    </article>
  );
}
