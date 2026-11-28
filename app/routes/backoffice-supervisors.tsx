import { Plus } from "lucide-react";
import { data, Link, useLoaderData } from "react-router";
import { useLocale, useT } from "~/i18n/useT";
import { BACKOFFICE_HEADERS, requireStaff } from "~/utils/backoffice.server";
import { listSupervisors } from "../../server/services/supervisorService";
import type { Route } from "./+types/backoffice-supervisors";

const SCOPE_PREVIEW = 3;

export function headers() {
  return BACKOFFICE_HEADERS;
}

/** Supervisors (super_admin only, SPEC §9). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const staff = await requireStaff(context, request, "super_admin");
  const supervisors = await listSupervisors(context.services.backoffice.db, staff);
  return data({ supervisors }, { headers: BACKOFFICE_HEADERS });
}

export default function SupervisorsPage() {
  const t = useT();
  const locale = useLocale();
  const { supervisors } = useLoaderData<typeof loader>();
  const base = `/${locale}/backoffice/supervisors`;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("backoffice.supervisors.heading")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("backoffice.supervisors.intro")}</p>
        </div>
        <Link
          to={`${base}/new`}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors duration-150 hover:bg-primary-hover"
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("backoffice.supervisors.add")}
        </Link>
      </div>

      {supervisors.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted">{t("backoffice.supervisors.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-start text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 text-start font-medium">{t("backoffice.supervisors.name")}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium">{t("backoffice.supervisors.workPhone")}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium">{t("backoffice.supervisors.scope")}</th>
                <th scope="col" className="px-4 py-3 text-end font-medium">{t("backoffice.supervisors.open")}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium">{t("backoffice.supervisors.status")}</th>
              </tr>
            </thead>
            <tbody>
              {supervisors.map((s) => {
                const names = s.scopes.map((a) => (locale === "ar" ? a.nameAr : a.nameEn));
                const extra = names.length - SCOPE_PREVIEW;
                return (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link to={`${base}/${s.id}`} className="font-semibold text-primary-text hover:underline">
                        {s.name}
                      </Link>
                      <div className="text-xs text-muted">
                        <bdi dir="ltr">{s.email}</bdi>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <bdi dir="ltr" className="whitespace-nowrap">{s.workPhone}</bdi>
                      {s.whatsapp && <span className="ms-2 text-xs text-muted">{t("backoffice.supervisors.whatsapp")}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {names.length ? (
                        <>
                          {names.slice(0, SCOPE_PREVIEW).join(locale === "ar" ? "، " : ", ")}
                          {extra > 0 && <span className="ms-1 text-xs text-muted">{t("backoffice.supervisors.moreAreas", { count: extra })}</span>}
                        </>
                      ) : (
                        <span className="text-muted">{t("backoffice.supervisors.noScope")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">{s.openListings.toLocaleString("en")}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.isActive ? "bg-success/15 text-foreground" : "bg-muted/20 text-muted"}`}
                      >
                        {t(s.isActive ? "backoffice.supervisors.active" : "backoffice.supervisors.inactive")}
                      </span>
                      {s.mustChangePassword && <div className="mt-1 text-xs text-muted">{t("backoffice.supervisors.mustChange")}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
