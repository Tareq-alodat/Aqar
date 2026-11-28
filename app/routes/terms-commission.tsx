import { data, useLoaderData } from "react-router";
import { card } from "~/components/form/types";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { ltrIsolate } from "~/shared/digits";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { loadCommissionTerms } from "~/utils/submission.server";
import type { Route } from "./+types/terms-commission";

export async function loader({ params, context }: Route.LoaderArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) throw data(null, { status: 404 });
  return loadCommissionTerms(context);
}

export function meta({ params, data: d }: Route.MetaArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) return [];
  const t = getT(lang.data.lang);
  // Draft terms are not indexed.
  return [{ title: `${t("terms.commission.title")} | ${t("app.name")}` }, ...(d?.draft ? [{ name: "robots", content: "noindex" }] : [])];
}

/** /:lang/terms/commission (SPEC §19). Placeholder text, marked as a draft pending legal review. */
export default function CommissionTermsPage() {
  const { rate, version, draft } = useLoaderData<typeof loader>();
  const t = useT();
  const locale = useLocale();
  const percent = new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { style: "percent", maximumFractionDigits: 2 }).format(rate);
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t("terms.commission.title")}</h1>
      <p className="text-sm text-muted">{t("terms.commission.version", { version: ltrIsolate(version) })}</p>
      <p className="text-sm text-muted">{t("terms.commission.operator", { company: t("brand.company") })}</p>
      {draft && (
        <p role="note" className="rounded-xl border border-warning bg-warning px-4 py-3 text-sm font-medium text-on-accent">
          {t("terms.commission.draftBanner")}
        </p>
      )}
      <div className={`${card} flex flex-col gap-3 leading-relaxed`}>
        <p>{t("terms.commission.p1", { company: t("brand.company") })}</p>
        <p>{t("terms.commission.p2", { rate: percent })}</p>
        <p>{t("terms.commission.p3")}</p>
        <p>{t("terms.commission.p4")}</p>
        <p>{t("terms.commission.p5")}</p>
        <p>{t("terms.commission.p6")}</p>
      </div>
    </article>
  );
}
